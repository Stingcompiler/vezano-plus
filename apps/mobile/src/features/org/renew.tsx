import { hhmm } from "@sting/app-core";
import { tx } from "@sting/texts";
import { AppText, Button, Screen, SPACE, StateView, TextField } from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import {
  Actions,
  Heading,
  Lead,
  Mono,
  money,
  N,
  Note,
  RichChip,
  Strong,
  Word,
} from "@/components/org/ui";
import { useSession } from "@/lib/session";

import { shareText } from "./share";
import { ORG_TEXTS } from "./texts";
import { fetched, useReport } from "./use-report";

const T = "ORG-07";
type State = "ready" | "validation_error" | "saving" | "success" | "server_error";

export interface Proof {
  id: string;
  reference: string;
  plan_code: string;
  amount_minor: string;
  period_label: string;
  image_name: string;
  image_size: number;
  has_image: boolean;
  status: "pending" | "approved" | "rejected";
  submitted_at: string;
  reviewed_at: string;
  reviewed_by_name: string;
  rejection_reason: string;
  extension_days: number;
  cycle_label?: string;
  receipt?: { id: string; number: string } | null;
}
type Cycle = "monthly" | "quarterly" | "yearly";

export interface RenewPayload {
  due: {
    plan_code: string;
    plan_name: string;
    amount_minor: string;
    currency: string;
    period_label: string;
    review_sla: string;
    covers_until?: string;
    pay_to?: { bank: string; account: string; holder: string } | null;
    addons_amount_minor?: string;
    addons?: { kind: string; label: string; qty: number; monthly_minor: string }[];
    cycle?: Cycle;
    cycles?: {
      cycle: Cycle;
      label: string;
      days: number;
      amount_minor: string;
      available: boolean;
    }[];
  };
  proofs: Proof[];
  plans?: { code: string; name: string; price_minor: string; max_branches: number }[];
  can_submit: boolean;
  review_sla: string;
}
interface UpgradeQuote {
  to: { code: string; name: string };
  amount_minor: string;
  remaining_days: number;
  note: string;
}
interface AddonQuote {
  kind: string;
  label: string;
  qty: number;
  plan_code: string;
  amount_minor: string;
  remaining_days: number;
  renewal_monthly_minor: string;
  note: string;
}

const STATUS_WORD = {
  approved: tx(T, "معتمد"),
  rejected: tx(T, "مرفوض"),
  pending: tx(T, "معلّق للمراجعة"),
} as const;

/** نوع الإثبات وحمولته كما يبنيها الويب (`proofKind`): إضافة، أو ترقية، أو تجديد. */
export function proofKind(
  addonQuote: AddonQuote | null,
  upgradeQuote: UpgradeQuote | null,
  duePlan: string,
) {
  return addonQuote
    ? {
        plan_code: addonQuote.plan_code,
        kind: "addon" as const,
        addon_kind: addonQuote.kind as "devices" | "users" | "branches",
        addon_qty: addonQuote.qty,
      }
    : {
        plan_code: upgradeQuote ? upgradeQuote.to.code : duePlan,
        kind: upgradeQuote ? ("upgrade" as const) : ("renewal" as const),
        addon_kind: "" as const,
        addon_qty: 0,
      };
}

/**
 * ORG-07 — إثبات تحويل الاشتراك (نظير `renew-client.tsx`): الرفع لا يُفعِّل والمراجعة بشرية معلَنة؛
 * رقم العملية إلزامي (بلا رقم لا يُمنع الاعتماد المزدوج). انحراف: منتقي الصور غير مثبَّت في التطبيق،
 * فيُرسل الرقم نصاً بلا صورة (المسار البديل نفسه في الويب: «بلا صورة بعد — الرقم والتاريخ نصاً»).
 */
export function Renew() {
  const router = useRouter();
  const { api } = useSession();
  const params = useLocalSearchParams<{
    upgrade?: string;
    addon?: string;
    qty?: string;
    plan?: string;
  }>();
  const upgradeTo = params.upgrade ?? "";
  const addonKind = params.addon ?? "";
  const addonQty = Number(params.qty ?? "1") || 1;
  const [plan, setPlan] = useState(params.plan ?? "");
  const [upgradeQuote, setUpgradeQuote] = useState<UpgradeQuote | null>(null);
  const [addonQuote, setAddonQuote] = useState<AddonQuote | null>(null);
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [reference, setReference] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failedSend, setFailedSend] = useState(false);
  const [just, setJust] = useState<Proof | null>(null);
  const [dup, setDup] = useState<Proof | null>(null);
  const [override, setOverride] = useState<RenewPayload | null>(null);

  const load = useCallback(
    async () =>
      fetched<RenewPayload>(
        await api.GET("/api/org/subscription/proofs", {
          params: { query: plan ? { plan_code: plan } : {} },
        }),
      ),
    [api, plan],
  );
  const { data, reload } = useReport<RenewPayload>({ load });
  const p = override ?? data;

  useEffect(() => {
    if (!upgradeTo) return;
    void (async () => {
      const { data: d, response } = await api.GET("/api/org/subscription/change", {
        params: { query: { plan_code: upgradeTo } },
      });
      const b = d as unknown as { quote?: UpgradeQuote } | undefined;
      if (response.ok && b?.quote) setUpgradeQuote(b.quote);
    })().catch(() => undefined);
  }, [api, upgradeTo]);

  useEffect(() => {
    if (!addonKind) return;
    void (async () => {
      const { data: d, response } = await api.GET("/api/org/subscription/addon", {
        params: { query: { kind: addonKind as "devices", qty: addonQty } },
      });
      const b = d as unknown as { quote?: AddonQuote } | undefined;
      if (response.ok && b?.quote) setAddonQuote(b.quote);
    })().catch(() => undefined);
  }, [api, addonKind, addonQty]);

  const submit = async () => {
    setTouched(true);
    if (!reference.trim() || busy || !p) return;
    setBusy(true);
    setDup(null);
    setFailedSend(false);
    try {
      const {
        data: d,
        error,
        response,
      } = await api.POST("/api/org/subscription/proofs", {
        body: {
          reference: reference.trim(),
          cycle,
          ...proofKind(addonQuote, upgradeQuote, p.due.plan_code),
          image_name: "",
          image_size: 0,
          image_data: "",
        } as never,
      });
      if (response.status === 409) {
        const e = error as unknown as { existing?: Proof } | undefined;
        setDup(e?.existing ?? null);
        return;
      }
      if (!response.ok || !d) {
        setFailedSend(true);
        return;
      }
      const out = d as unknown as { proof: Proof } & RenewPayload;
      setJust(out.proof);
      setOverride(out);
      setReference("");
      setTouched(false);
    } catch {
      setFailedSend(true);
    } finally {
      setBusy(false);
    }
  };

  const pending = p?.proofs.find((x) => x.status === "pending") ?? null;
  // آخر قرار خلال أسبوع يبقى ظاهراً قبل العودة إلى نموذج الرفع
  const latest = p?.proofs[0] ?? null;
  const recent =
    latest && latest.status !== "pending" && latest.reviewed_at
      ? Date.now() - new Date(latest.reviewed_at).getTime() < 7 * 86400_000
      : false;
  const shown = just ?? pending ?? (recent ? latest : null);
  const state: State = busy
    ? "saving"
    : failedSend
      ? "server_error"
      : shown
        ? "success"
        : touched && !reference.trim()
          ? "validation_error"
          : dup
            ? "validation_error"
            : "ready";

  const dueCycle = p?.due.cycles?.find((c) => c.cycle === cycle);
  const showPlans = !upgradeQuote && !addonQuote && (p?.plans ?? []).length > 1;
  const availableCycles = (p?.due.cycles ?? []).filter((c) => c.available);

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "تجديد الاشتراك")}
      onRefresh={() => {
        setOverride(null);
        void reload();
      }}
    >
      <AppText variant="section">
        {tx(T, "إثبات تحويل الاشتراك — الرفع لا يُفعِّل، والمراجعة بشرية معلَنة")}
      </AppText>
      <View style={{ height: SPACE["3"] }} />

      {state === "server_error" ? (
        <StateView state="server_error" title={tx(T, "فشل رفع الإثبات")} />
      ) : null}

      {state === "saving" ? <StateView state="saving" title={tx(T, "يُرفع الإثبات")} /> : null}

      {shown && state !== "server_error" ? (
        <StateView
          state={shown.status === "rejected" ? "validation_error" : "success"}
          title={
            shown.status === "approved"
              ? tx(T, "اعتُمد — مُدّد الاشتراك شهراً واحداً")
              : shown.status === "rejected"
                ? tx(T, "رُفض بسبب")
                : tx(T, "معلّق للمراجعة")
          }
        >
          {shown.status === "approved" ? (
            <Lead>
              {tx(
                T,
                "التمديد كُتب مرة واحدة بمرجع رقم العملية. لو رُفع الإيصال نفسه ثانية تُرفض المحاولة بعرض الاعتماد الأول وتاريخه — لا شهر إضافي بالخطأ.",
              )}
            </Lead>
          ) : shown.status === "rejected" ? (
            <Lead>{shown.rejection_reason}</Lead>
          ) : null}
          <Note>
            <Strong>{tx(T, "رُفع الإثبات")}</Strong> {tx(T, "· اليوم")}{" "}
            <N>{hhmm(shown.submitted_at)}</N> {tx(T, "· يظهر لك فوراً في سجل الاشتراك — تم")}
          </Note>
          <Note>
            <Strong>{tx(T, "بانتظار مراجعة بشرية")}</Strong> {tx(T, "· متوسط المراجعة")}{" "}
            {p?.review_sla ?? tx(T, "يوم عمل واحد")}
            {tx(T, ". لا تفعيل آلي بمجرد الرفع. —")}{" "}
            {shown.status === "pending" ? tx(T, "الآن") : tx(T, "تم")}
          </Note>
          <Note>
            <Strong>{tx(T, "الاعتماد أو الرفض بسبب")}</Strong>{" "}
            {tx(
              T,
              "· لو رُفض تُذكر العلّة بالرقم (فرق مبلغ، صورة غير مقروءة) ولك مهلة تصحيح معلَنة —",
            )}{" "}
            {shown.status === "pending" ? tx(T, "لاحقاً") : tx(T, "تم")}
          </Note>
          <Note>
            <Strong>{tx(T, "خلال المراجعة كلها")}</Strong>{" "}
            {tx(T, "· الخدمة تعمل كما هي. لا تعطيل استباقي ولا تحذير مفاجئ. — ثابت")}
          </Note>
          <Note>
            {tx(T, "رقم العملية")} <N>{shown.reference}</N> ·{" "}
            {shown.has_image ? (
              <>
                {tx(T, "صورة الإيصال — مرفوعة ·")} <N>{shown.image_name}</N>
              </>
            ) : (
              tx(T, "بلا صورة بعد — الرقم والتاريخ نصاً")
            )}
          </Note>
        </StateView>
      ) : null}

      {p && !shown ? (
        <>
          <Heading>{tx(T, "رفع إثبات التحويل")}</Heading>
          {upgradeQuote ? (
            <StateView
              state="ready"
              title={`${tx(T, "ترقية إلى «")}${upgradeQuote.to.name}${tx(T, "» — فرق السعر")}`}
            >
              <Lead>{upgradeQuote.note}</Lead>
              <Note>
                {tx(T, "الفرق على")} <N>{upgradeQuote.remaining_days}</N> {tx(T, "يوماً متبقية:")}{" "}
                <N>{`${money(upgradeQuote.amount_minor)} SDG`}</N>
              </Note>
            </StateView>
          ) : null}
          {addonQuote ? (
            <StateView state="ready" title={tx(T, "إضافة")}>
              <Lead>
                <N>{addonQuote.qty}</N> {addonQuote.label}
              </Lead>
              <Lead>{addonQuote.note}</Lead>
              <Note>
                {tx(T, "عن")} <N>{addonQuote.remaining_days}</N> {tx(T, "يوماً متبقية:")}{" "}
                <N>{`${money(addonQuote.amount_minor)} SDG`}</N> {tx(T, "· ثم")}{" "}
                <N>{money(addonQuote.renewal_monthly_minor)}</N> {tx(T, "/ شهر مع التجديد")}
              </Note>
            </StateView>
          ) : null}

          {showPlans ? (
            <>
              <AppText variant="section" muted>
                {tx(T, "الباقات")}
              </AppText>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: SPACE["2"],
                  marginBottom: SPACE["3"],
                }}
              >
                {(p.plans ?? []).map((pl) => (
                  <RichChip
                    key={pl.code}
                    on={p.due.plan_code === pl.code}
                    onPress={() => {
                      setCycle("monthly");
                      setPlan(pl.code);
                    }}
                  >
                    {pl.name} · <N>{money(pl.price_minor)}</N>
                  </RichChip>
                ))}
              </View>
            </>
          ) : null}
          {!upgradeQuote && !addonQuote && availableCycles.length > 1 ? (
            <>
              <AppText variant="section" muted>
                {tx(T, "دورة الفوترة")}
              </AppText>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: SPACE["2"],
                  marginBottom: SPACE["3"],
                }}
              >
                {availableCycles.map((c) => (
                  <RichChip key={c.cycle} on={cycle === c.cycle} onPress={() => setCycle(c.cycle)}>
                    {c.label} · <N>{money(c.amount_minor)}</N>
                  </RichChip>
                ))}
              </View>
            </>
          ) : null}

          {p.due.pay_to ? (
            <StateView state="ready" title={ORG_TEXTS.payTo}>
              <Lead>
                <Mono text={p.due.pay_to.bank} /> · <N>{p.due.pay_to.account}</N> ·{" "}
                {p.due.pay_to.holder}
              </Lead>
              <Button
                variant="quiet"
                label={ORG_TEXTS.copyAccount}
                onPress={() => void shareText(p.due.pay_to?.account ?? "", ORG_TEXTS.payTo)}
              />
            </StateView>
          ) : null}

          <Lead>
            {tx(T, "المستحق:")}{" "}
            <N>
              {`${money(
                addonQuote?.amount_minor ??
                  upgradeQuote?.amount_minor ??
                  dueCycle?.amount_minor ??
                  p.due.amount_minor,
              )} ${p.due.currency}`}
            </N>{" "}
            {tx(T, "· الفترة:")}{" "}
            {addonQuote ? tx(T, "إضافة") : upgradeQuote ? tx(T, "فرق ترقية") : p.due.period_label}
            {!addonQuote && !upgradeQuote && p.due.covers_until ? (
              <>
                {" "}
                · {ORG_TEXTS.coversUntil} <N>{p.due.covers_until.slice(0, 10)}</N>
              </>
            ) : null}
            {cycle !== "monthly" && !addonQuote ? (
              <>
                {" "}
                · {dueCycle?.label} — <N>{dueCycle?.days ?? 0}</N> {tx(T, "يوماً")}
              </>
            ) : null}
          </Lead>
          {!addonQuote && !upgradeQuote && (p.due.addons ?? []).some((x) => x.qty > 0) ? (
            <View testID="renew-addons">
              <Note>
                {tx(T, "يشمل الإضافات:")}{" "}
                {(p.due.addons ?? [])
                  .filter((x) => x.qty > 0)
                  .map((x, i) => (
                    <AppText key={x.kind} variant="note" muted>
                      {i > 0 ? " · " : ""}
                      <N>{x.qty}</N> {x.label}
                    </AppText>
                  ))}{" "}
                — <N>{money(p.due.addons_amount_minor ?? "0")}</N> {tx(T, "للدورة الشهرية")}
              </Note>
            </View>
          ) : null}

          <View style={{ height: SPACE["3"] }} />
          <Note>{ORG_TEXTS.noImagePicker}</Note>
          <View style={{ height: SPACE["2"] }} />
          <TextField
            label={tx(T, "رقم العملية البنكية — مطلوب")}
            value={reference}
            onChangeText={setReference}
            onBlur={() => setTouched(true)}
            autoCapitalize="characters"
            autoCorrect={false}
            required
            mono
            error={
              touched && !reference.trim()
                ? tx(
                    T,
                    "لو تُرك رقم العملية فارغاً نمنع الإرسال: بلا رقم لا يستطيع المراجع منع الاعتماد المزدوج.",
                  )
                : undefined
            }
          />
          {dup ? (
            <AppText variant="note" accessibilityLiveRegion="polite">
              {tx(T, "هذا الرقم رُفع من قبل —")}{" "}
              {dup.status === "approved"
                ? tx(T, "اعتُمد")
                : dup.status === "rejected"
                  ? tx(T, "رُفض")
                  : tx(T, "معلّق")}{" "}
              {tx(T, "في")} <N>{dup.submitted_at.slice(0, 10)}</N>
            </AppText>
          ) : null}
          <View style={{ height: SPACE["2"] }} />
          <Button
            financial
            label={tx(T, "إرسال الإثبات")}
            loading={busy}
            disabledReason={p.can_submit ? undefined : tx(T, "للمالك فقط")}
            onPress={() => void submit()}
          />
          <Button
            variant="quiet"
            label={tx(T, "الاشتراك والباقات")}
            onPress={() => router.push("/org/subscription")}
          />
          <Note>
            {tx(
              T,
              "نعرض متوسط زمن المراجعة، ونبقي الخدمة عاملة خلالها، ولا نرسل تنبيه «تم الدفع» قبل الاعتماد.",
            )}
          </Note>
        </>
      ) : null}

      {p && p.proofs.length > 0 ? (
        <>
          <Heading>{tx(T, "سجل الاشتراك")}</Heading>
          {p.proofs.map((x) => (
            <View key={x.id} style={{ marginBottom: SPACE["2"] }}>
              <AppText variant="secondary">
                <N>{x.reference}</N> · <Mono text={x.period_label} /> ·{" "}
                <N>{money(x.amount_minor)}</N> ·{" "}
                <Word
                  tone={
                    x.status === "approved"
                      ? "active"
                      : x.status === "rejected"
                        ? "disabled"
                        : "sent"
                  }
                >
                  {STATUS_WORD[x.status]}
                </Word>
                {x.reviewed_by_name ? ` · ${x.reviewed_by_name}` : ""}
              </AppText>
              {x.receipt ? (
                <Actions>
                  <Button
                    variant="quiet"
                    label={tx(T, "الإيصال")}
                    onPress={() =>
                      router.push({
                        pathname: "/org/subscription/receipts/[id]",
                        params: { id: x.receipt?.id ?? "" },
                      })
                    }
                  />
                  <View style={{ justifyContent: "center" }}>
                    <AppText variant="secondary">
                      <N>{x.receipt.number}</N>
                    </AppText>
                  </View>
                </Actions>
              ) : null}
            </View>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

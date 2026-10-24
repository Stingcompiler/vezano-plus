import { dayMonth } from "@sting/app-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  Screen,
  SPACE,
  StateView,
  TOUCH,
  useColors,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import {
  Actions,
  group,
  Heading,
  Item,
  Lead,
  Mono,
  money,
  N,
  Note,
  Strong,
  thousands,
  Word,
} from "@/components/org/ui";
import { useSession } from "@/lib/session";

import { fetched, useReport } from "./use-report";

const T = "ORG-06";
type State = "ready" | "loading" | "permission_denied" | "expired";

const CHANGE_ERRORS: Record<string, string> = {
  plan_invalid: tx(T, "الباقة غير متاحة للتغيير."),
  same_plan: tx(T, "هذه باقتك الحالية."),
  suspended: tx(T, "الاشتراك موقوف — تواصل مع الدعم أولاً."),
  limits_exceeded: tx(
    T,
    "الاستعمال الحالي يتجاوز حدود الباقة الأصغر — عطّل فرعاً أو جهازاً أولاً.",
  ),
  not_downgrade: tx(T, "هذا ليس تخفيضاً."),
  paid_plan_required: tx(T, "الإضافات لاشتراك مدفوع ساري — جدّد أو رقِّ أولاً."),
  addon_not_offered: tx(T, "هذه الإضافة غير معروضة في باقتك."),
  renew_first: tx(T, "لا أيام متبقية في الفترة — جدّد أولاً."),
  qty_invalid: tx(T, "الكمية غير صالحة."),
  addon_invalid: tx(T, "نوع الإضافة غير معروف."),
};

export interface AddonLine {
  kind: "devices" | "users" | "branches";
  label: string;
  unit_monthly_minor: string | null;
  offered: boolean;
  qty: number;
  monthly_minor: string | null;
}
interface AddonQuote {
  kind: AddonLine["kind"];
  label: string;
  qty: number;
  plan_name: string;
  unit_monthly_minor: string;
  remaining_days: number;
  amount_minor: string;
  renewal_monthly_minor: string;
  currency: string;
  note: string;
}
interface Quote {
  from: { code: string; name: string; price_minor: string };
  to: { code: string; name: string; price_minor: string };
  kind: "upgrade" | "downgrade" | "renewal";
  remaining_days: number;
  expires_at: string;
  amount_minor: string;
  currency: string;
  cycle?: string;
  cycle_label?: string;
  effective: string;
  blocked_reasons: string[];
  pending_downgrade: string;
  note: string;
}
export interface SubscriptionPayload {
  plan: {
    code: string;
    name: string;
    trial: boolean;
    trial_base_name?: string;
    state: "pending_approval" | "trial" | "active" | "grace" | "expired" | "suspended";
    expires_at: string;
    suspended_reason?: string;
    days_since_expiry: number;
    price_minor: string | null;
    addons_monthly_minor?: string | null;
    currency: string;
  };
  limits: {
    branches: { used: number; max: number; extra?: number; addon?: number };
    devices: { used: number; max: number; extra?: number; addon?: number };
    users: { used: number; max: number | null; extra?: number; addon?: number };
    campaign_quota: { used: number; max: number };
  };
  features: {
    code: string;
    label: string;
    note: string;
    status: "open" | "conditional" | "locked";
  }[];
  if_expired: { continues: string[]; stops: string[] };
  next_plan_code?: string;
  next_plan_name?: string;
  plans: {
    code: string;
    name: string;
    price_minor: string;
    period: "month" | "trial";
    trial_days: number | null;
    blurb: string;
    current: boolean;
  }[];
  addons?: AddonLine[];
  can_buy_addons?: boolean;
  can_see_amounts: boolean;
  can_renew: boolean;
}

const STATUS_LABEL = {
  open: tx(T, "مفتوح"),
  conditional: tx(T, "مشروط"),
  locked: tx(T, "مغلق"),
} as const;

/** «ترقية» أم «تخفيض» على زر الباقة (التجريبية تختار باقتها بـ«ترقية» أيضاً). */
export function planAction(p: SubscriptionPayload, pl: { price_minor: string }): string {
  return p.plan.trial || BigInt(pl.price_minor) > BigInt(p.plan.price_minor ?? "0")
    ? tx(T, "ترقية")
    : tx(T, "تخفيض");
}

function Extra({ n, word }: { n?: number | undefined; word: "extra" | "addon" }) {
  if (!n) return null;
  return (
    <>
      {" "}
      {tx(T, "(منها")} <N>{n}</N> {word === "extra" ? tx(T, "إضافية)") : tx(T, "مدفوعة)")}
    </>
  );
}

function Step({ label, glyph, onPress }: { label: string; glyph: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        minWidth: TOUCH.min,
        minHeight: TOUCH.min,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c.border,
      }}
    >
      <AppText variant="bodyStrong">{glyph}</AppText>
    </Pressable>
  );
}

/**
 * ORG-06 — الاشتراك والباقات (نظير `subscription-client.tsx`): ما تفتحه الباقة وما لا تفتحه بلا إخفاء؛
 * الحالة من الخادم دائماً لا كاش؛ المبالغ للمالك ومن فوّضه. الترقية/التخفيض/الإضافة تعرض العرض قبل
 * التنفيذ، والدفع يمرّ بـ ORG-07 (`renew`) بالمعاملات نفسها (`upgrade` · `addon`+`qty` · `plan`).
 */
export function Subscription() {
  const router = useRouter();
  const { api } = useSession();
  const load = useCallback(
    async () => fetched<SubscriptionPayload>(await api.GET("/api/org/subscription", {})),
    [api],
  );
  const { data, denied, failed, reload } = useReport<SubscriptionPayload>({ load });
  const [override, setOverride] = useState<SubscriptionPayload | null>(null);
  const p = override ?? data;
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteErr, setQuoteErr] = useState("");
  const [changing, setChanging] = useState(false);
  const [addonQty, setAddonQty] = useState<Record<string, number>>({});
  const [addonQuote, setAddonQuote] = useState<AddonQuote | null>(null);
  const [addonErr, setAddonErr] = useState("");

  const askQuote = async (code: string) => {
    setQuoteErr("");
    setQuote(null);
    try {
      const {
        data: d,
        error,
        response,
      } = await api.GET("/api/org/subscription/change", {
        params: { query: { plan_code: code } },
      });
      const b = (d ?? error) as unknown as { quote?: Quote; detail?: string } | undefined;
      if (response.ok && b?.quote) setQuote(b.quote);
      else setQuoteErr(CHANGE_ERRORS[b?.detail ?? ""] ?? tx(T, "تعذّر جلب عرض التغيير."));
    } catch {
      setQuoteErr(tx(T, "تعذّر جلب عرض التغيير."));
    }
  };

  const askAddon = async (kind: AddonLine["kind"]) => {
    setAddonErr("");
    setAddonQuote(null);
    const qty = addonQty[kind] ?? 1;
    try {
      const {
        data: d,
        error,
        response,
      } = await api.GET("/api/org/subscription/addon", {
        params: { query: { kind, qty } },
      });
      const b = (d ?? error) as unknown as { quote?: AddonQuote; detail?: string } | undefined;
      if (response.ok && b?.quote) setAddonQuote(b.quote);
      else setAddonErr(CHANGE_ERRORS[b?.detail ?? ""] ?? tx(T, "تعذّر جلب عرض الإضافة."));
    } catch {
      setAddonErr(tx(T, "تعذّر جلب عرض الإضافة."));
    }
  };

  const reduceAddon = async (kind: AddonLine["kind"]) => {
    setAddonErr("");
    setChanging(true);
    try {
      const {
        data: d,
        error,
        response,
      } = await api.POST("/api/org/subscription/addon", {
        body: { kind, qty: 1 } as never,
      });
      const b = (d ?? error) as unknown as (SubscriptionPayload & { detail?: string }) | undefined;
      if (response.ok && b && "plans" in b) setOverride(b);
      else
        setAddonErr(
          b?.detail === "limits_exceeded"
            ? tx(T, "الاستعمال الحالي يحتاج هذه الإضافة — عطّل جهازاً أو مستخدماً أو فرعاً أولاً.")
            : (CHANGE_ERRORS[b?.detail ?? ""] ?? tx(T, "تعذّر تخفيض الإضافة.")),
        );
    } catch {
      setAddonErr(tx(T, "تعذّر تخفيض الإضافة."));
    } finally {
      setChanging(false);
    }
  };

  const applyDowngrade = async (code: string) => {
    setChanging(true);
    try {
      const {
        data: d,
        error,
        response,
      } = await api.POST("/api/org/subscription/change", {
        body: { plan_code: code } as never,
      });
      const b = (d ?? error) as unknown as (SubscriptionPayload & { detail?: string }) | undefined;
      if (response.ok && b && "plans" in b) {
        setOverride(b);
        setQuote(null);
      } else setQuoteErr(CHANGE_ERRORS[b?.detail ?? ""] ?? tx(T, "تعذّر جدولة التخفيض."));
    } catch {
      setQuoteErr(tx(T, "تعذّر جدولة التخفيض."));
    } finally {
      setChanging(false);
    }
  };

  const cancelDowngrade = async () => {
    setChanging(true);
    try {
      const { data: d, response } = await api.POST("/api/org/subscription/change", {
        body: { cancel: true } as never,
      });
      const b = d as unknown as SubscriptionPayload | undefined;
      if (response.ok && b) setOverride(b);
    } catch {
      /* لا تغيير */
    } finally {
      setChanging(false);
    }
  };

  const state: State = !p
    ? "loading"
    : !p.can_see_amounts
      ? "permission_denied"
      : p.plan.state === "grace" || p.plan.state === "expired"
        ? "expired"
        : "ready";

  const renew = p ? dayMonth(p.plan.expires_at) : null;
  const toExpiry = () => router.push("/org/subscription/expiry");
  const toRenew = (params?: Record<string, string | number>) =>
    router.push({ pathname: "/org/subscription/renew", params: params ?? {} });

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "الاشتراك")}
      onRefresh={() => {
        setOverride(null);
        void reload();
      }}
    >
      <AppText variant="section">
        {tx(T, "الاشتراك والباقات — ما تفتحه الباقة وما لا تفتحه، بلا إخفاء")}
      </AppText>
      <View style={{ height: SPACE["3"] }} />

      {state === "loading" ? (
        <StateView state="loading" title={tx(T, "جلب الاشتراك")}>
          <Lead>{tx(T, "حالة الاشتراك من الخادم دائماً.")}</Lead>
          {failed || denied ? (
            <Button
              variant="secondary"
              label={tx(T, "أعد المحاولة")}
              onPress={() => void reload()}
            />
          ) : null}
        </StateView>
      ) : null}

      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "مدير فرع يفتح الاشتراك")}>
          <Lead>
            {tx(
              T,
              "الاشتراك التزام مالي على المنشأة — يراه المالك ومن فوّضه صراحة. مدير الفرع يرى أثر الباقة على عمله (الحدود والميزات) دون المبالغ ولا وسيلة الدفع.",
            )}
          </Lead>
        </StateView>
      ) : null}

      {p?.plan.state === "pending_approval" ? (
        <StateView state="pending_sync" title={tx(T, "منشأتك بانتظار اعتماد المنصة")}>
          <Lead>
            {tx(
              T,
              "لا تبدأ التجربة ولا يُسجَّل جهاز حتى يعتمد مدير المنصة منشأتك. تجربتك تُحسب من لحظة الاعتماد، ونُعلمك في الإشعارات.",
            )}
          </Lead>
        </StateView>
      ) : null}

      {p?.plan.state === "suspended" ? (
        <StateView state="server_error" title={tx(T, "الاشتراك موقوف من مشغّل المنصة")}>
          <Lead>
            {tx(
              T,
              "البيع والطباعة والجرد والقراءة والتصدير مستمرة. المتوقف: الميزات المدفوعة (السوق، الحملات، التقارير المتقدمة) حتى الاستئناف.",
            )}
          </Lead>
          <Note>
            <Strong>{tx(T, "السبب")}</Strong> · {p.plan.suspended_reason || "—"}{" "}
            {tx(T, "— التفاصيل في سجل التدقيق، والتواصل عبر الدعم.")}
          </Note>
        </StateView>
      ) : null}

      {state === "expired" && p ? (
        <StateView state="expired" title={tx(T, "لو انتهى الاشتراك")}>
          <Lead>
            {tx(
              T,
              "البيع والطباعة والجرد تستمر. ما يتوقف: نشر عروض السوق، والحملات، وتقارير الفترات الطويلة. التفصيل الكامل في «ما يحدث عند الانتهاء» — انتهى اشتراكك قبل",
            )}{" "}
            <N>{p.plan.days_since_expiry}</N> {tx(T, "أيام")}.
          </Lead>
          <Button label={tx(T, "ما يحدث عند الانتهاء")} onPress={toExpiry} />
        </StateView>
      ) : null}

      {p ? (
        <>
          <Heading>{tx(T, "استحقاقات")}</Heading>
          <Lead>
            <Strong>
              {tx(T, "باقتك الحالية —")} {p.plan.name}
              {p.plan.trial && p.plan.trial_base_name
                ? ` ${tx(T, "بميزات «")}${p.plan.trial_base_name}»`
                : ""}
            </Strong>
            {p.plan.trial && renew ? (
              <>
                {" "}
                {tx(T, "· تنتهي في")} <N>{renew.day}</N> {renew.month}
              </>
            ) : p.can_see_amounts && renew ? (
              <>
                {" "}
                {tx(T, "· تُجدَّد في")} <N>{renew.day}</N> {renew.month} ·{" "}
                <N>{`${money(p.plan.price_minor ?? "0")} ${p.plan.currency}`}</N> {tx(T, "شهرياً")}
                {Number(p.plan.addons_monthly_minor ?? "0") > 0 ? (
                  <>
                    {" "}
                    {tx(T, "+ الإضافات")} <N>{money(p.plan.addons_monthly_minor ?? "0")}</N>
                  </>
                ) : null}
              </>
            ) : null}{" "}
            <Word tone={p.plan.state === "expired" ? "expired" : "active"}>
              {p.plan.state === "trial"
                ? tx(T, "تجريبية")
                : p.plan.state === "active"
                  ? tx(T, "سارية")
                  : p.plan.state === "grace"
                    ? tx(T, "منتهية — مهلة")
                    : tx(T, "منتهية")}
            </Word>
          </Lead>

          <Heading>{tx(T, "حدود الباقة كأرقام")}</Heading>
          <Note>
            {tx(
              T,
              "عند بلوغ الحدّ لا نمنع البيع. نمنع إضافة جهاز جديد ونشرح البديل: ترقية الباقة أو سحب جهاز قديم.",
            )}
          </Note>
          <View style={{ height: SPACE["2"] }} />
          <GroupedList>
            <Item title={tx(T, "الفروع ·")}>
              <AppText variant="secondary">
                <N>{`${p.limits.branches.used} / ${p.limits.branches.max}`}</N>
                <Extra n={p.limits.branches.extra} word="extra" />
                <Extra n={p.limits.branches.addon} word="addon" />
              </AppText>
            </Item>
            <Item title={tx(T, "الأجهزة ·")}>
              <AppText variant="secondary">
                <N>{`${p.limits.devices.used} / ${p.limits.devices.max}`}</N>
                <Extra n={p.limits.devices.extra} word="extra" />
                <Extra n={p.limits.devices.addon} word="addon" />
              </AppText>
            </Item>
            <Item title={tx(T, "المستخدمون ·")}>
              <AppText variant="secondary">
                <N>{p.limits.users.used}</N> /{" "}
                {p.limits.users.max === null ? tx(T, "غير محدود") : <N>{p.limits.users.max}</N>}
                <Extra n={p.limits.users.extra} word="extra" />
                <Extra n={p.limits.users.addon} word="addon" />
              </AppText>
            </Item>
            <Item title={tx(T, "حصة رسائل الحملات ·")} last>
              <AppText variant="secondary">
                <N>{group(p.limits.campaign_quota.max)}</N> {tx(T, "/ شهر")}
              </AppText>
            </Item>
          </GroupedList>

          {p.can_see_amounts && p.addons?.some((a) => a.offered || a.qty > 0) ? (
            <View testID="org-addons">
              <Heading>{tx(T, "الإضافات")}</Heading>
              <Note>
                {tx(
                  T,
                  "تحتاج جهازاً أو مستخدماً أو فرعاً فوق حدّ الباقة دون ترقيتها؟ أضفه بسعر شهري للوحدة. يُدفع الآن عن الأيام المتبقية فقط، ثم يُجدَّد مع الباقة.",
                )}
              </Note>
              <View style={{ height: SPACE["2"] }} />
              <GroupedList>
                {p.addons
                  .filter((a) => a.offered || a.qty > 0)
                  .map((a, i, arr) => (
                    <Item
                      key={a.kind}
                      title={`${a.label} ${tx(T, "إضافي")}`}
                      last={i === arr.length - 1}
                    >
                      <Note>
                        <N>{thousands(a.unit_monthly_minor ?? "0")}</N>{" "}
                        {tx(T, "/ شهر للوحدة · لديك")} <N>{a.qty}</N>
                      </Note>
                      <Actions>
                        {p.can_buy_addons && a.offered ? (
                          <>
                            <Step
                              glyph="−"
                              label={`${tx(T, "أنقص كمية")} ${a.label}`}
                              onPress={() =>
                                setAddonQty((q) => ({
                                  ...q,
                                  [a.kind]: Math.max(1, (q[a.kind] ?? 1) - 1),
                                }))
                              }
                            />
                            <View style={{ minWidth: 32, justifyContent: "center" }}>
                              <AppText variant="bodyStrong" style={{ textAlign: "center" }}>
                                <N>{addonQty[a.kind] ?? 1}</N>
                              </AppText>
                            </View>
                            <Step
                              glyph="+"
                              label={`${tx(T, "زد كمية")} ${a.label}`}
                              onPress={() =>
                                setAddonQty((q) => ({
                                  ...q,
                                  [a.kind]: Math.min(50, (q[a.kind] ?? 1) + 1),
                                }))
                              }
                            />
                            <Button
                              variant="quiet"
                              label={tx(T, "أضف")}
                              onPress={() => void askAddon(a.kind)}
                            />
                          </>
                        ) : null}
                        {a.qty > 0 ? (
                          <Button
                            variant="quiet"
                            label={tx(T, "أزل واحدة")}
                            loading={changing}
                            onPress={() => void reduceAddon(a.kind)}
                          />
                        ) : null}
                      </Actions>
                    </Item>
                  ))}
              </GroupedList>
              {!p.can_buy_addons ? (
                <Note>
                  {tx(
                    T,
                    "شراء الإضافات لاشتراك مدفوع ساري — من التجريبية أو بعد الانتهاء جدّد أولاً.",
                  )}
                </Note>
              ) : null}
              {addonErr ? <StateView state="validation_error" title={addonErr} /> : null}
              {addonQuote ? (
                <StateView state="ready" title={tx(T, "إضافة")}>
                  <Lead>
                    <N>{addonQuote.qty}</N> {addonQuote.label}
                  </Lead>
                  <Lead>{addonQuote.note}</Lead>
                  <Note>
                    {tx(T, "الآن عن")} <N>{addonQuote.remaining_days}</N> {tx(T, "يوماً متبقية:")}{" "}
                    <N style={{ fontWeight: "bold" }}>
                      {`${thousands(addonQuote.amount_minor)} ${addonQuote.currency}`}
                    </N>{" "}
                    {tx(T, "· ثم")} <N>{thousands(addonQuote.renewal_monthly_minor)}</N>{" "}
                    {tx(T, "/ شهر مع التجديد")}
                  </Note>
                  <Actions>
                    <Button
                      label={tx(T, "ادفع وارفع الإثبات")}
                      onPress={() => toRenew({ addon: addonQuote.kind, qty: addonQuote.qty })}
                    />
                    <Button
                      variant="quiet"
                      label={tx(T, "إلغاء")}
                      onPress={() => setAddonQuote(null)}
                    />
                  </Actions>
                </StateView>
              ) : null}
            </View>
          ) : null}

          <View style={{ height: SPACE["3"] }} />
          <GroupedList>
            {p.features.map((f, i) => (
              <Item
                key={f.code}
                title={f.label}
                last={i === p.features.length - 1}
                status={
                  <Word
                    tone={
                      f.status === "open"
                        ? "active"
                        : f.status === "conditional"
                          ? "sent"
                          : "disabled"
                    }
                  >
                    {STATUS_LABEL[f.status]}
                  </Word>
                }
              >
                <Note>
                  <Mono text={f.note} />
                </Note>
              </Item>
            ))}
          </GroupedList>

          {state !== "expired" ? (
            <StateView state="ready" title={tx(T, "لو انتهى الاشتراك")}>
              <Lead>
                {tx(
                  T,
                  "البيع والطباعة والجرد تستمر. ما يتوقف: نشر عروض السوق، والحملات، وتقارير الفترات الطويلة. التفصيل الكامل في «ما يحدث عند الانتهاء».",
                )}
              </Lead>
              <Button variant="quiet" label={tx(T, "ما يحدث عند الانتهاء")} onPress={toExpiry} />
            </StateView>
          ) : null}

          {p.can_see_amounts ? (
            <>
              <Heading>{tx(T, "الباقات")}</Heading>
              <View style={{ height: SPACE["2"] }} />
              <GroupedList>
                {p.plans.map((pl, i) => (
                  <Item
                    key={pl.code}
                    title={`${pl.name}${pl.current ? ` ${tx(T, "· باقتك الحالية")}` : ""}`}
                    last={i === p.plans.length - 1}
                    status={
                      <AppText variant="secondary">
                        {pl.period === "trial" ? (
                          <>
                            <N>{pl.trial_days ?? 0}</N> {tx(T, "يوماً")}
                          </>
                        ) : (
                          <>
                            <N>{thousands(pl.price_minor)}</N> {tx(T, "/ شهر")}
                          </>
                        )}
                      </AppText>
                    }
                  >
                    <Note>
                      <Mono text={pl.blurb} />
                    </Note>
                    {!pl.current && pl.period !== "trial" ? (
                      <Actions>
                        <Button
                          variant="quiet"
                          label={planAction(p, pl)}
                          onPress={() => void askQuote(pl.code)}
                        />
                      </Actions>
                    ) : null}
                  </Item>
                ))}
              </GroupedList>

              {p.next_plan_code ? (
                <StateView
                  state="pending_sync"
                  title={`${tx(T, "تخفيض مجدول إلى «")}${p.next_plan_name ?? p.next_plan_code}${tx(T, "» عند التجديد")}`}
                >
                  <Note>
                    {tx(
                      T,
                      "باقتك الحالية تبقى حتى تاريخ الانتهاء؛ التجديد القادم يكون على الباقة الأصغر بسعرها.",
                    )}
                  </Note>
                  <Button
                    variant="quiet"
                    label={tx(T, "ألغِ التخفيض")}
                    loading={changing}
                    onPress={() => void cancelDowngrade()}
                  />
                </StateView>
              ) : null}

              {quoteErr ? <StateView state="validation_error" title={quoteErr} /> : null}

              {quote ? (
                <StateView
                  state={quote.blocked_reasons.length ? "validation_error" : "ready"}
                  title={
                    quote.kind === "upgrade"
                      ? `${tx(T, "ترقية إلى «")}${quote.to.name}»`
                      : quote.kind === "downgrade"
                        ? `${tx(T, "تخفيض إلى «")}${quote.to.name}${tx(T, "» عند التجديد")}`
                        : `${tx(T, "الانتقال إلى «")}${quote.to.name}${tx(T, "» عند التجديد")}`
                  }
                >
                  <Lead>{quote.note}</Lead>
                  {quote.kind === "upgrade" ? (
                    <Note>
                      {tx(T, "الفرق على")} <N>{quote.remaining_days}</N> {tx(T, "يوماً متبقية")}
                      {quote.cycle && quote.cycle !== "monthly"
                        ? ` ${tx(T, "بسعر الاشتراك ال")}${quote.cycle_label ?? ""}`
                        : ""}
                      : <N>{`${thousands(quote.amount_minor)} ${quote.currency}`}</N>
                    </Note>
                  ) : null}
                  {quote.blocked_reasons.map((r) => (
                    <Note key={r}>
                      <Strong>{tx(T, "ممنوع")}</Strong> · {r}
                    </Note>
                  ))}
                  <Actions>
                    {quote.kind === "upgrade" && !quote.blocked_reasons.length ? (
                      <Button
                        label={tx(T, "ادفع الفرق وارفع الإثبات")}
                        onPress={() => toRenew({ upgrade: quote.to.code })}
                      />
                    ) : null}
                    {quote.kind === "downgrade" && !quote.blocked_reasons.length ? (
                      <Button
                        label={tx(T, "جدوِل التخفيض")}
                        loading={changing}
                        onPress={() => void applyDowngrade(quote.to.code)}
                      />
                    ) : null}
                    {quote.kind === "renewal" ? (
                      <Button
                        label={tx(T, "جدّد على هذه الباقة")}
                        onPress={() => toRenew({ plan: quote.to.code })}
                      />
                    ) : null}
                    <Button variant="quiet" label={tx(T, "إلغاء")} onPress={() => setQuote(null)} />
                  </Actions>
                </StateView>
              ) : null}

              <View style={{ height: SPACE["3"] }} />
              <Button label={tx(T, "تجديد الاشتراك")} onPress={() => toRenew()} />
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

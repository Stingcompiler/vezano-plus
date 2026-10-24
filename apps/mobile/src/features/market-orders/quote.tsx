import { formatMinor } from "@sting/app-core";
import { AppText, Button, GroupedList, SPACE, StateView, TextField } from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Cells,
  Heading,
  M,
  Note,
  Para,
  Row,
  Shell,
  Stack,
  StatusWord,
} from "@/components/market-orders/parts";
import { dm, num, type Rejection, safeGet, safePost } from "@/features/market-orders/lib";
import { MO_TEXTS, tOf } from "@/features/market-orders/texts";
import type { OrderRow, Version, VersionLine } from "@/features/market-orders/types";
import { useDoc } from "@/features/market-orders/use-doc";
import { useSession } from "@/lib/session";

const T = "ORD-06";
const t = tOf(T);
const t1 = tOf("ORD-01");
type State =
  "ready" | "validation_error" | "saving" | "expired" | "success" | "partial" | "stale" | "offline";

interface Payload {
  order: OrderRow;
  request: Version | null;
  draft: Version | null;
  catalog_expired: string[];
  default_valid_until: string;
  can_quote: boolean;
}

interface EditLine {
  offer_id: string;
  public_name: string;
  pack_label: string;
  unit_name: string;
  requested: number;
  requested_price: string;
  confirmed: string;
  price: string;
  reason: string;
}

const digits = (s: string) => s.replace(/\D/g, "");

/** ORD-06 — إعداد عرض سعر من المورد (41-D33 ready/validation_error/saving/expired/success · 12-D7 partial): الفرق معروض للطرفين. */
export default function Quote() {
  const router = useRouter();
  const { api } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const doc = useDoc<Payload>(
    `market.order.${id}.quote`,
    useCallback(
      () =>
        safeGet<Payload>(() =>
          api.GET("/api/market/orders/{order_id}/quote", { params: { path: { order_id: id } } }),
        ),
      [api, id],
    ),
  );
  const p = doc.shown;
  const [lines, setLines] = useState<EditLine[]>([]);
  const [fee, setFee] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [note, setNote] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState<"" | "draft" | "send" | "decline">("");
  const [sent, setSent] = useState<Version | null>(null);
  const [savedDraft, setSavedDraft] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [declined, setDeclined] = useState(false);
  const [serverError, setServerError] = useState("");
  const seeded = useRef("");

  useEffect(() => {
    if (doc.notFound) router.replace("/market/orders/incoming");
  }, [doc.notFound, router]);

  useEffect(() => {
    if (!p || seeded.current === `${id}:${doc.fromCache}`) return;
    seeded.current = `${id}:${doc.fromCache}`;
    const base = p.draft ?? p.request;
    setLines(
      (p.request?.lines ?? []).map((rl: VersionLine) => {
        const dl = p.draft?.lines.find((x) => x.offer_id === rl.offer_id);
        return {
          offer_id: rl.offer_id,
          public_name: rl.public_name,
          pack_label: rl.pack_label,
          unit_name: rl.unit_name,
          requested: rl.qty_requested,
          requested_price: rl.price_minor,
          confirmed: String(dl?.qty_confirmed ?? rl.qty_requested),
          price: dl?.price_minor || rl.price_minor || "",
          reason: dl?.increase_reason ?? "",
        };
      }),
    );
    setFee(base?.delivery_fee_minor ?? "");
    setValidUntil(p.draft?.valid_until || p.default_valid_until);
    setNote(p.draft?.note ?? "");
  }, [p, id, doc.fromCache]);

  const today = new Date().toISOString().slice(0, 10);
  const validityPast = Boolean(validUntil) && validUntil < today;
  const increases = lines.filter((l) => num(l.confirmed) > l.requested && !l.reason.trim());
  const invalid = validityPast || increases.length > 0 || !validUntil;
  const partial = lines.some((l) => num(l.confirmed) > 0 && num(l.confirmed) < l.requested);
  const catalogExpired = p?.catalog_expired ?? [];
  const lock = doc.fromCache ? MO_TEXTS.needsServer : undefined;

  const setLine = (oid: string, patch: Partial<EditLine>) =>
    setLines((cur) => cur.map((l) => (l.offer_id === oid ? { ...l, ...patch } : l)));

  const submit = async (send: boolean) => {
    setAttempted(true);
    setServerError("");
    if (send && invalid) return;
    if (busy) return;
    setBusy(send ? "send" : "draft");
    try {
      const r = await safePost<{ version?: Version } & Rejection>(() =>
        api.POST("/api/market/orders/{order_id}/quote", {
          params: { path: { order_id: id } },
          body: {
            send,
            delivery_fee_minor: fee || null,
            valid_until: validUntil,
            note,
            lines: lines.map((l) => ({
              offer_id: l.offer_id,
              qty_confirmed: num(l.confirmed),
              price_minor: l.price,
              increase_reason: l.reason,
            })),
          } as never,
        }),
      );
      if (r.kind === "offline") setServerError(MO_TEXTS.needsServer);
      else if (r.ok && r.body?.version) {
        if (send) setSent(r.body.version);
        else setSavedDraft(true);
      } else setServerError(r.body?.detail ?? "server_error");
    } finally {
      setBusy("");
    }
  };

  const decline = async () => {
    if (busy || !declineReason.trim()) return;
    setBusy("decline");
    try {
      const r = await safePost<unknown>(() =>
        api.POST("/api/market/orders/{order_id}/decline", {
          params: { path: { order_id: id } },
          body: { reason: declineReason } as never,
        }),
      );
      if (r.kind === "done" && r.ok) setDeclined(true);
      else if (r.kind === "offline") setServerError(MO_TEXTS.needsServer);
    } finally {
      setBusy("");
    }
  };

  const down = doc.net === "offline" || doc.net === "failed";
  const state: State = sent
    ? "success"
    : busy === "send" || busy === "draft"
      ? "saving"
      : attempted && invalid
        ? "validation_error"
        : !p && down
          ? "offline"
          : doc.fromCache
            ? "stale"
            : catalogExpired.length
              ? "expired"
              : partial
                ? "partial"
                : "ready";

  return (
    <Shell
      id={T}
      state={state}
      title={t("إعداد عرض سعر من المورد")}
      hint={t(
        "هنا يصير الطلب اتفاقاً محتملاً. تحرير الردّ سطراً سطراً: يعدّل الكميات والأسعار، ويضيف رسوم نقل، ويحدّد صلاحية العرض — والفرق عن طلب المشتري معروضٌ في عمودٍ مقابل.",
      )}
      cached={doc.fromCache}
    >
      {state === "offline" ? <StateView state="offline" title={t1("بلا اتصال")} /> : null}

      {state === "success" && sent ? (
        <StateView state="success" title={t("أُرسل العرض")}>
          <Para>
            {t("بإصدارٍ مرقَّم وصلاحية معلنة — والمشتري يقبل إصداراً بعينه لا «العرض». الإصدار")}{" "}
            <M>{sent.number}</M> {t("· صالح حتى")}{" "}
            <M>{sent.valid_until ? dm(sent.valid_until) : "—"}</M>.
          </Para>
          <Button label={t("تفاصيل الطلب")} onPress={() => router.push(`/market/orders/${id}`)} />
        </StateView>
      ) : null}
      {declined ? (
        <StateView state="success" title={t("اعتذرتَ بسبب")}>
          <Para>{t("يظهر السبب للمشتري كما كتبته.")}</Para>
          <Button
            label={t("الطلبات الواردة")}
            onPress={() => router.push("/market/orders/incoming")}
          />
        </StateView>
      ) : null}
      {state === "saving" ? (
        <StateView
          state="saving"
          title={busy === "draft" ? t("حفظ مسودة العرض") : t("إرسال العرض")}
        >
          <Para>
            {busy === "draft"
              ? t("يُحفظ عند المورد ولا يصل المشتري حتى يُرسل صريحاً.")
              : t("إصدارٌ مرقَّم واحد — الزرّ يُقفل حتى يرد الخادم.")}
          </Para>
        </StateView>
      ) : null}
      {state === "validation_error" ? (
        <StateView state="validation_error" title={t("صلاحية في الماضي أو كمية تفوق المطلوب")}>
          <Para>
            {validityPast && increases.length
              ? t("تاريخ صلاحية أمس، وسطرٌ بكمية أكبر من طلب المشتري.")
              : validityPast
                ? t("تاريخ صلاحية في الماضي.")
                : !validUntil
                  ? t("حدّد صلاحية العرض.")
                  : t("سطرٌ بكمية أكبر من طلب المشتري بلا سبب.")}
          </Para>
          <Note>
            {t("الزيادة تحتاج سبباً")}{" "}
            {t(
              "· قد تكون تعبئةً بالكرتونة الكاملة — تُعلَن سبباً لا تُمرّر رقماً. والمشتري يقبل الزيادة أو يرفضها.",
            )}
          </Note>
        </StateView>
      ) : null}
      {state === "expired" ? (
        <StateView state="expired" title={t("انتهت صلاحية سعر الكتالوج أثناء التحرير")}>
          <Para>{t("العرض المنشور الذي بُني عليه الردّ انتهت صلاحيته.")}</Para>
          <Note>
            {t("لا تجديد تلقائي")}{" "}
            {t(
              "· تعديل الوصف أو التحرير لا يجدّد تأكيد السعر. التجديد فعلٌ مستقل في «تجديد التأكيد».",
            )}
          </Note>
          <Button label={t("تجديد التأكيد")} onPress={() => router.push("/market/renewals")} />
        </StateView>
      ) : null}
      {state === "partial" ? (
        <StateView state="partial" title={t("رد المورد — قبول جزئي")}>
          <Para>
            {t("القبول الجزئي ليس رفضاً ولا موافقة كاملة، ويحتاج قرار المشتري على المتبقي.")}
          </Para>
          <Note>
            {t(
              "لا يُنشئ ردك قيداً في دفتره: الذمة تنشأ بالاستلام لا بالتأكيد. المتبقي يبقى «مطلوباً غير مؤكد» حتى يُلغيه أو تؤكده.",
            )}
          </Note>
        </StateView>
      ) : null}
      {serverError ? (
        <StateView state="validation_error" title={t("لم يُحفظ")}>
          <Para>{serverError}</Para>
        </StateView>
      ) : null}

      {p && !sent && !declined ? (
        <>
          <AppText variant="title" style={{ marginBottom: SPACE["3"] }}>
            <M>{p.order.number_label}</M> — {p.order.buyer_name}
          </AppText>
          <GroupedList>
            {lines.map((l, i) => {
              const conf = num(l.confirmed);
              const diff = conf - l.requested;
              const expiredLine = catalogExpired.includes(l.offer_id);
              return (
                <Row
                  key={l.offer_id}
                  title={l.public_name}
                  sub={l.pack_label || l.unit_name}
                  dim={expiredLine}
                  last={i === lines.length - 1}
                  trailing={
                    expiredLine ? (
                      <StatusWord tone="expired" label={t("سعر الكتالوج منتهٍ")} />
                    ) : null
                  }
                >
                  <Cells items={[[t("مطلوب"), <M key="r">{l.requested}</M>]]} />
                  <TextField
                    label={`${t("مؤكد —")} ${l.public_name}`}
                    mono
                    keyboardType="number-pad"
                    value={l.confirmed}
                    onChangeText={(x) => setLine(l.offer_id, { confirmed: digits(x) })}
                  />
                  {conf > l.requested ? (
                    <TextField
                      label={`${t("سبب الزيادة —")} ${l.public_name}`}
                      value={l.reason}
                      onChangeText={(x) => setLine(l.offer_id, { reason: x })}
                      error={attempted && !l.reason.trim() ? t("الزيادة تحتاج سبباً") : undefined}
                    />
                  ) : null}
                  <TextField
                    label={`${t("السعر —")} ${l.public_name}`}
                    mono
                    keyboardType="number-pad"
                    value={l.price}
                    onChangeText={(x) => setLine(l.offer_id, { price: digits(x) })}
                  />
                  {conf === 0 ? (
                    <StatusWord tone="expired" label={t("غير متوفر")} />
                  ) : diff === 0 && l.price === l.requested_price ? (
                    <Note>{t("كما طُلب")}</Note>
                  ) : (
                    <>
                      {diff !== 0 ? (
                        <Note>
                          {t("الكمية")} <M>{diff > 0 ? `+${diff}` : String(diff)}</M>
                        </Note>
                      ) : null}
                      {l.price !== l.requested_price ? (
                        <Note>
                          {t("السعر")}{" "}
                          <M>{l.requested_price ? formatMinor(l.requested_price) : "—"}</M> ←{" "}
                          <M>{l.price ? formatMinor(l.price) : "—"}</M>
                        </Note>
                      ) : null}
                    </>
                  )}
                </Row>
              );
            })}
          </GroupedList>
          <TextField
            label={t("رسوم النقل (بالقرش)")}
            mono
            keyboardType="number-pad"
            value={fee}
            onChangeText={(x) => setFee(digits(x))}
          />
          <TextField
            label={t("صلاحية العرض")}
            mono
            placeholder="YYYY-MM-DD"
            value={validUntil}
            onChangeText={setValidUntil}
            error={
              attempted && validityPast
                ? t("الصلاحية لا تكون ماضياً")
                : attempted && !validUntil
                  ? t("حدّد الصلاحية")
                  : undefined
            }
          />
          <TextField label={t("ملاحظة للمشتري (اختيارية)")} value={note} onChangeText={setNote} />
          <Note>
            {t("الفرق معروض للطرفين")} {t("· المورد يرى ما غيّره قبل الإرسال، والمشتري يراه بعده.")}
          </Note>
          <Stack>
            <Button
              label={t("أرسل العرض")}
              financial
              loading={busy === "send"}
              onPress={() => void submit(true)}
              disabledReason={lock}
            />
            <Button
              label={t("حفظ مسودة العرض")}
              variant="secondary"
              loading={busy === "draft"}
              onPress={() => void submit(false)}
              disabledReason={lock}
            />
            {savedDraft ? (
              <StatusWord
                tone="saved_local"
                label={t("يُحفظ عند المورد ولا يصل المشتري حتى يُرسل صريحاً.")}
              />
            ) : null}
          </Stack>
          <Heading>{t("أو اعتذر بسبب")}</Heading>
          <TextField
            label={t("سبب الاعتذار — يظهر للمشتري")}
            value={declineReason}
            onChangeText={setDeclineReason}
          />
          <Button
            label={t("اعتذر بسبب")}
            variant="secondary"
            loading={busy === "decline"}
            onPress={() => void decline()}
            disabledReason={lock ?? (declineReason.trim() ? undefined : t("الاعتذار يحتاج سبباً"))}
          />
        </>
      ) : null}
    </Shell>
  );
}

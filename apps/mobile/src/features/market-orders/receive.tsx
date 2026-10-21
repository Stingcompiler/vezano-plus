import { formatMinor } from "@sting/app-core";
import { AppText, Button, GroupedList, StateView, TextField } from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Cells,
  M,
  Note,
  Para,
  Row,
  Shell,
  Stack,
  StatusWord,
} from "@/components/market-orders/parts";
import { num, type Rejection, safeGet, safePost } from "@/features/market-orders/lib";
import { MO_TEXTS, tOf } from "@/features/market-orders/texts";
import type { Detail, OrderRow } from "@/features/market-orders/types";
import { useDoc } from "@/features/market-orders/use-doc";
import { useSession } from "@/lib/session";

const T = "ORD-09";
const t = tOf(T);
const t1 = tOf("ORD-01");
type State =
  "ready" | "validation_error" | "partial" | "conflict" | "success" | "stale" | "offline";

interface RLine {
  offer_id: string;
  public_name: string;
  pack_label: string;
  unit_name: string;
  requested: number;
  confirmed: number;
  shipped_in_this: number;
  received_before: number;
  shipped_total: number;
  price_minor: string;
}

interface Payload {
  order: OrderRow;
  shipment: {
    id: string;
    number: number;
    ref_label: string;
    shipped_at: string;
    received_at: string;
    received_lines: unknown[];
    dispute_opened: boolean;
  } | null;
  pending_shipments: string[];
  lines: RLine[];
}

interface Edit {
  received: string;
  rejected: string;
  reason: string;
}

type Done = Detail & { received: string; gap: number; dispute_opened: boolean };

const ordinal = (n: number) =>
  ["", t("الأولى"), t("الثانية"), t("الثالثة"), t("الرابعة"), t("الخامسة")][n] ??
  `${t("رقم")} ${n}`;
const digits = (s: string) => s.replace(/\D/g, "");

/** ORD-09 — استلام جزئي ورفض كمية (08-D4 partial · 41-D33 ready/validation_error/conflict/success): أربعة أرقام لا رقم واحد. */
export default function Receive() {
  const router = useRouter();
  const { api } = useSession();
  const { id, shipment: wanted = "" } = useLocalSearchParams<{ id: string; shipment?: string }>();
  const doc = useDoc<Payload>(
    `market.order.${id}.receive.${wanted}`,
    useCallback(
      () =>
        safeGet<Payload>(() =>
          api.GET("/api/market/orders/{order_id}/receive", {
            params: { path: { order_id: id }, query: wanted ? { shipment: wanted } : {} },
          }),
        ),
      [api, id, wanted],
    ),
  );
  const p = doc.shown;
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<{ code: string; max: number | undefined } | null>(
    null,
  );
  const [done, setDone] = useState<Done | null>(null);
  const seeded = useRef("");

  useEffect(() => {
    if (doc.notFound) router.replace(`/market/orders/${id}`);
  }, [doc.notFound, router, id]);
  useEffect(() => {
    const k = `${id}:${wanted}:${p?.shipment?.id ?? ""}`;
    if (!p || seeded.current === k) return;
    seeded.current = k;
    setEdits(
      Object.fromEntries(
        p.lines.map((l) => [
          l.offer_id,
          { received: String(l.shipped_in_this), rejected: "0", reason: "" },
        ]),
      ),
    );
  }, [p, id, wanted]);

  const lines = p?.lines ?? [];
  const over = lines.filter((l) => {
    const e = edits[l.offer_id];
    return e && num(e.received) + num(e.rejected) > l.shipped_in_this && !e.reason.trim();
  });
  const rejectedNoReason = lines.filter((l) => {
    const e = edits[l.offer_id];
    return e && num(e.rejected) > 0 && !e.reason.trim();
  });
  const anyRejected = lines.some((l) => num(edits[l.offer_id]?.rejected) > 0);
  const gapTotal = lines.reduce((acc, l) => {
    const e = edits[l.offer_id];
    return acc + Math.max(0, l.shipped_in_this - Math.min(num(e?.received), l.shipped_in_this));
  }, 0);
  const invalid = over.length > 0 || rejectedNoReason.length > 0;
  const lock = doc.fromCache ? MO_TEXTS.needsServer : undefined;

  const submit = async (withDispute: boolean) => {
    setAttempted(true);
    setServerError(null);
    if (invalid || busy || !p?.shipment) return;
    setBusy(true);
    try {
      const shipment = p.shipment;
      const r = await safePost<Done & Rejection & { extra?: { max?: number } }>(() =>
        api.POST("/api/market/orders/{order_id}/receive", {
          params: { path: { order_id: id } },
          body: {
            shipment_id: shipment.id,
            open_dispute: withDispute,
            lines: lines.map((l) => ({
              offer_id: l.offer_id,
              qty_received: num(edits[l.offer_id]?.received),
              qty_rejected: num(edits[l.offer_id]?.rejected),
              reason: edits[l.offer_id]?.reason ?? "",
              disposition: num(edits[l.offer_id]?.rejected) ? "return" : "",
            })),
          } as never,
        }),
      );
      if (r.kind === "offline") return;
      if (r.ok && r.body && "order" in r.body) setDone(r.body);
      else
        setServerError({
          code: r.body?.detail ?? "server_error",
          max: r.body?.extra?.max,
        });
    } finally {
      setBusy(false);
    }
  };

  const down = doc.net === "offline" || doc.net === "failed";
  const state: State = done
    ? "success"
    : (attempted && over.length > 0) || serverError?.code === "exceeds_shipped"
      ? "validation_error"
      : !p && down
        ? "offline"
        : doc.fromCache
          ? "stale"
          : anyRejected
            ? "conflict"
            : gapTotal > 0
              ? "partial"
              : "ready";
  const firstOver =
    over[0] ?? lines.find((l) => l.offer_id === (serverError ? lines[0]?.offer_id : "")) ?? null;
  const toDetail = () => router.push(`/market/orders/${id}`);
  const setEdit = (oid: string, e: Edit, patch: Partial<Edit>) =>
    setEdits((c) => ({ ...c, [oid]: { ...e, ...patch } }));

  return (
    <Shell
      id={T}
      state={state}
      title={t("استلام جزئي ورفض كمية — أربعة أرقام لا رقم واحد")}
      hint={t("دفتر المشتري ودفتر البائع مستقلان، والفارق يُسجَّل خلافاً لا يُسوّى تلقائياً.")}
      cached={doc.fromCache}
    >
      {state === "offline" ? <StateView state="offline" title={t1("بلا اتصال")} /> : null}

      {state === "success" && done ? (
        <StateView state="success" title={t("سُجّل الاستلام")}>
          <Para>
            {t("ما دخل المخزون، وما رُفض ومصيره: مرتجعٌ للمورد أو حجرٌ حتى القرار.")}{" "}
            <M>{done.received}</M>
            {done.gap ? (
              <>
                {" "}
                {t("· الفارق")} <M>{done.gap}</M>{" "}
                {done.dispute_opened ? t("— فُتح خلاف الفارق") : t("— محجوز حتى يُغلق")}
              </>
            ) : (
              ` ${t("· مطابقة")}`
            )}
          </Para>
          <Note>
            {t("الذمّة من المستلم")}{" "}
            {t(
              "· تُقيَّد قيمة ما استُلم فقط. والمرفوض لا يُقيَّد ولا يُحذف — يبقى بندَ مطالبة. قيمة المستلم",
            )}{" "}
            <M>{formatMinor(done.received_value_minor)}</M>.
          </Note>
          <Button label={t("تفاصيل الطلب")} onPress={toDetail} />
        </StateView>
      ) : null}
      {state === "validation_error" ? (
        <StateView state="validation_error" title={t("استلام يتجاوز المتبقّي")}>
          <Para>
            {firstOver ? (
              <>
                {t("المتبقّي")} <M>{firstOver.shipped_in_this}</M> {t("والعدّ")}{" "}
                <M>
                  {num(edits[firstOver.offer_id]?.received) +
                    num(edits[firstOver.offer_id]?.rejected)}
                </M>
                .
              </>
            ) : rejectedNoReason.length ? (
              t("رفض كمية يحتاج سبباً مكتوباً.")
            ) : serverError ? (
              <>
                {t("الخادم رفض العدّ: الأقصى")} <M>{serverError.max ?? ""}</M>.
              </>
            ) : null}
          </Para>
          <Note>
            {t("رفض خادمي لا تحذير")}{" "}
            {t(
              "· الاستلام التراكمي لا يتجاوز المشحون. الزيادة تُسجَّل بسبب مكتوب وتُحال إلى مراجعة الفرق.",
            )}
          </Note>
        </StateView>
      ) : null}
      {state === "conflict" ? (
        <StateView state="conflict" title={t("رفض كمية يدّعي البائع تسليمها")}>
          <Para>{t("رفضتَ كميةً، والمورد يقول سلّمها سليمة.")}</Para>
          <Note>
            {t("دفتران مستقلان")}{" "}
            {t("· لا تسوية تلقائية ولا ترجيح. كلٌّ يقيّد ما يقرّ به، والفرق محجوز حتى يُغلق.")}
          </Note>
        </StateView>
      ) : null}
      {state === "ready" && p?.shipment ? (
        <StateView state="ready" title={t("أربعة أعمدة وعمود تعدّه")}>
          <Para>{t("مطلوب ومؤكَّد ومشحون — والخامس ما تعدّه أنت. والمشحون معروضٌ صراحةً.")}</Para>
          <Note>
            {t("لماذا يُعرض المشحون")}{" "}
            {t(
              "· لأنه دعوى الطرف الآخر لا رقمُ النظام (كما في استلام التحويل الداخلي). أنت تُقرّ بما وصلك مقابل ما يدّعي أنه أرسله.",
            )}
          </Note>
        </StateView>
      ) : null}

      {p && !p.shipment && !done ? (
        <StateView state="empty" title={t("لا شحنة بانتظار الاستلام")}>
          <Button label={t("تفاصيل الطلب")} onPress={toDetail} />
        </StateView>
      ) : null}

      {p?.shipment && !done ? (
        <>
          <Stack>
            <StatusWord
              tone={state === "partial" || state === "conflict" ? "partial" : "stale"}
              label={
                state === "partial"
                  ? t("تنفيذ جزئي")
                  : state === "conflict"
                    ? t("خلاف")
                    : t("استلام")
              }
            />
          </Stack>
          <AppText variant="title">
            {t("استلام الشحنة")} <M>{p.shipment.ref_label}</M> {t("من الطلب")}{" "}
            <M>{p.order.number_label}</M>
          </AppText>
          <Note>
            {t("الشحنة")} {ordinal(p.shipment.number)} · {p.order.supplier_name}
          </Note>
          <GroupedList>
            {lines.map((l, i) => {
              const e = edits[l.offer_id] ?? { received: "0", rejected: "0", reason: "" };
              const gap = l.shipped_in_this - Math.min(num(e.received), l.shipped_in_this);
              return (
                <Row
                  key={l.offer_id}
                  title={l.public_name}
                  sub={l.pack_label || l.unit_name}
                  dim={gap > 0}
                  last={i === lines.length - 1}
                >
                  <Cells
                    items={[
                      [t("مطلوب"), <M key="a">{l.requested}</M>],
                      [t("مؤكد"), <M key="b">{l.confirmed}</M>],
                      [t("مشحون"), <M key="c">{l.shipped_in_this}</M>],
                    ]}
                  />
                  <TextField
                    label={`${t("مستلم فعلاً —")} ${l.public_name}`}
                    mono
                    keyboardType="number-pad"
                    value={e.received}
                    onChangeText={(x) => setEdit(l.offer_id, e, { received: digits(x) })}
                  />
                  <TextField
                    label={`${t("مرفوض —")} ${l.public_name}`}
                    mono
                    keyboardType="number-pad"
                    value={e.rejected}
                    onChangeText={(x) => setEdit(l.offer_id, e, { rejected: digits(x) })}
                  />
                  {gap > 0 || num(e.rejected) > 0 ? (
                    <>
                      <Note>
                        {t("الفارق وسببه")}: {t("فارق")} <M>{gap}</M>
                        {num(e.rejected) ? (
                          <>
                            {" "}
                            {t("· مرفوض")} <M>{num(e.rejected)}</M>
                          </>
                        ) : null}
                      </Note>
                      <TextField
                        label={`${t("سبب الفارق —")} ${l.public_name}`}
                        value={e.reason}
                        onChangeText={(x) => setEdit(l.offer_id, e, { reason: x })}
                        error={
                          attempted &&
                          !e.reason.trim() &&
                          (num(e.rejected) > 0 ||
                            num(e.received) + num(e.rejected) > l.shipped_in_this)
                            ? t("سبب مكتوب مطلوب")
                            : undefined
                        }
                      />
                    </>
                  ) : (
                    <StatusWord tone="success" label={t("مطابق")} />
                  )}
                </Row>
              );
            })}
          </GroupedList>
          <AppText variant="bodyStrong">{t("ما يكتبه هذا الإجراء في دفترك:")}</AppText>
          <Note>
            {t(
              "إدخال مخزون بالكميات المستلمة فعلاً، وذمة للمورد بقيمة المستلم وحده. المشحون غير المستلم لا يُخصم من مخزونك ولا يُحتسب عليك.",
            )}
          </Note>
          <AppText variant="bodyStrong">{t("ما لا يكتبه:")}</AppText>
          <Note>
            {t(
              "لا يُعدّل دفتر المورد ولا يُلغي مطالبته. هو يقول «شحنت 8»، وأنت تقول «استلمت 7». الرقمان يبقيان، ويُفتح خلاف في «الخلافات» يحمله موظف من الطرفين لا خوارزمية.",
            )}
          </Note>
          <Stack>
            {gapTotal > 0 ? (
              <>
                <Button
                  label={t("تسجيل الاستلام وفتح خلاف الفارق")}
                  financial
                  loading={busy}
                  onPress={() => void submit(true)}
                  disabledReason={lock}
                />
                <Button
                  label={t("تسجيل الاستلام دون خلاف")}
                  variant="secondary"
                  loading={busy}
                  onPress={() => void submit(false)}
                  disabledReason={lock}
                />
              </>
            ) : (
              <Button
                label={t("تسجيل الاستلام")}
                financial
                loading={busy}
                onPress={() => void submit(false)}
                disabledReason={lock}
              />
            )}
            <Button
              label={t("إلغاء المتبقي")}
              variant="quiet"
              onPress={() => router.push(`/market/orders/${id}/cancel-remaining`)}
            />
            <Button
              label={t("تحويل الاستلام إلى مستند مخزني")}
              variant="quiet"
              onPress={() => router.push("/market/link/receipts")}
            />
          </Stack>
        </>
      ) : null}
    </Shell>
  );
}

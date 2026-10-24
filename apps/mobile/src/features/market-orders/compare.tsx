import { formatMinor } from "@sting/app-core";
import { AppText, Button, GroupedList, SPACE, StateView, TextField } from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import {
  Ago,
  Cells,
  M,
  Note,
  Para,
  Row,
  Shell,
  Stack,
  StatusWord,
} from "@/components/market-orders/parts";
import { dm, hms, type Rejection, safeGet, safePost } from "@/features/market-orders/lib";
import { MO_TEXTS, tOf } from "@/features/market-orders/texts";
import type { Detail, OrderRow, Version } from "@/features/market-orders/types";
import { useDoc } from "@/features/market-orders/use-doc";
import { useSession } from "@/lib/session";

const T = "ORD-07";
const t = tOf(T);
const t1 = tOf("ORD-01");
type State =
  "ready" | "validation_error" | "expired" | "conflict" | "success" | "stale" | "offline";

interface Row0 {
  offer_id: string;
  public_name: string;
  pack_label: string;
  unit_name: string;
  requested_qty: number;
  requested_price_minor: string;
  shown_qty: number | null;
  shown_price_minor: string;
  current_qty: number | null;
  current_price_minor: string;
  diff_label: string;
  increase_reason: string;
  version_diff_label: string;
}

interface Compare {
  order: OrderRow;
  request: Version | null;
  shown: Version | null;
  latest: Version | null;
  rows: Row0[];
  conflict: boolean;
  expired: boolean;
  seconds_left: number;
  shown_total_minor: string;
  latest_total_minor: string;
  request_total_minor: string;
  accepted: number | null;
}

const money = (v: string): ReactNode => (v ? <M>{formatMinor(v)}</M> : "—");

const Days = ({ n }: { n: number }) =>
  n === 1 ? (
    <>{t("يوم واحد")}</>
  ) : n === 2 ? (
    <>{t("يومان")}</>
  ) : n <= 10 ? (
    <>
      <M>{n}</M> {t("أيام")}
    </>
  ) : (
    <>
      <M>{n}</M> {t("يوماً")}
    </>
  );

const DaysDiff = ({ n }: { n: number }) =>
  n === 1 ? (
    <>{t("+يوم")}</>
  ) : n === 2 ? (
    <>{t("+يومان")}</>
  ) : (
    <>
      +<M>{n}</M> {n <= 10 ? t("أيام") : t("يوماً")}
    </>
  );

/** فرق سطر بين طلبه وعرض: السعر للوحدة وللبند والكمية — الأرقام mono. */
function LineDiff({
  qty,
  qtyRef,
  price,
  priceRef,
  unit,
}: {
  qty: number;
  qtyRef: number;
  price: string;
  priceRef: string;
  unit: string;
}) {
  const dp = Number(price || 0) - Number(priceRef || 0);
  if (!dp && qty === qtyRef) return <>{t("بلا تغيير")}</>;
  const sign = dp > 0 ? "+" : "−";
  return (
    <>
      {dp ? (
        <>
          <M>{`${sign}${formatMinor(String(Math.abs(dp)))}`}</M> {t("لل")}
          {unit}
        </>
      ) : null}
      {dp && qty ? (
        <>
          {" · "}
          <M>{`${sign}${formatMinor(String(Math.abs(dp) * qty))}`}</M> {t("للبند")}
        </>
      ) : null}
      {qty !== qtyRef ? (
        <>
          {" · "}
          {t("الكمية")} <M>{`${qty - qtyRef > 0 ? "+" : ""}${qty - qtyRef}`}</M>
        </>
      ) : null}
    </>
  );
}

/** ORD-07 — مقارنة العرض وقبوله أو رفضه (41-D33 ready/validation_error/expired/success · 08-D4 conflict): لا زرّ قبول قبل عرض الفرق. */
export default function ComparePage() {
  const router = useRouter();
  const { api } = useSession();
  const { id, version = "" } = useLocalSearchParams<{ id: string; version?: string }>();
  const [ver, setVer] = useState(version);
  const doc = useDoc<Compare>(
    `market.order.${id}.compare.${ver}`,
    useCallback(
      () =>
        safeGet<Compare>(() =>
          api.GET("/api/market/orders/{order_id}/compare", {
            params: { path: { order_id: id }, query: ver ? { version: Number(ver) } : {} },
          }),
        ),
      [api, id, ver],
    ),
  );
  const cmp = doc.shown;
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState("");
  const [superseded, setSuperseded] = useState<number | null>(null);
  const [accepted, setAccepted] = useState<Detail | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejected, setRejected] = useState(false);
  const [requoted, setRequoted] = useState(false);

  useEffect(() => {
    if (doc.notFound) router.replace(`/market/orders/${id}`);
  }, [doc.notFound, router, id]);
  useEffect(() => {
    if (cmp && !doc.fromCache) setLeft(cmp.seconds_left);
  }, [cmp, doc.fromCache]);
  useEffect(() => {
    if (!left) return;
    const timer = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [left]);

  const accept = async (n: number) => {
    if (busy) return;
    setBusy("accept");
    try {
      const r = await safePost<Detail & Rejection>(() =>
        api.POST("/api/market/orders/{order_id}/accept", {
          params: { path: { order_id: id } },
          body: { version: n } as never,
        }),
      );
      if (r.kind === "offline") return;
      if (r.ok && r.body && "order" in r.body) {
        setAccepted(r.body);
        return;
      }
      if (r.body?.detail === "version_superseded") {
        setSuperseded((r.body.extra?.latest as number | undefined) ?? null);
        setVer("");
        await doc.reload();
      } else if (r.body?.detail === "version_expired") {
        await doc.reload();
      }
    } finally {
      setBusy("");
    }
  };

  const reject = async () => {
    if (busy || !cmp?.shown || !rejectReason.trim()) return;
    setBusy("reject");
    try {
      const r = await safePost<unknown>(() =>
        api.POST("/api/market/orders/{order_id}/reject", {
          params: { path: { order_id: id } },
          body: { version: cmp.latest?.number ?? cmp.shown?.number, reason: rejectReason } as never,
        }),
      );
      if (r.kind === "done" && r.ok) setRejected(true);
    } finally {
      setBusy("");
    }
  };

  const requote = async () => {
    if (busy) return;
    setBusy("requote");
    try {
      const r = await safePost<unknown>(() =>
        api.POST("/api/market/orders/{order_id}/requote", {
          params: { path: { order_id: id } },
          body: {} as never,
        }),
      );
      if (r.kind === "done" && r.ok) setRequoted(true);
    } finally {
      setBusy("");
    }
  };

  const down = doc.net === "offline" || doc.net === "failed";
  const state: State = accepted
    ? "success"
    : superseded !== null
      ? "validation_error"
      : !cmp && down
        ? "offline"
        : doc.fromCache
          ? "stale"
          : cmp?.expired
            ? "expired"
            : cmp?.conflict
              ? "conflict"
              : "ready";
  const conflict = state === "conflict";
  const shown = cmp?.shown ?? null;
  const latest = cmp?.latest ?? null;
  const request = cmp?.request ?? null;
  const targetVersion = conflict ? latest : shown;
  const cur: Version | null = latest ?? shown;
  const lock = doc.fromCache ? MO_TEXTS.needsServer : undefined;
  const toDetail = () => router.push(`/market/orders/${id}`);
  const dd = (() => {
    if (!cmp) return 0;
    const a = Number(conflict ? cmp.shown_total_minor || 0 : cmp.request_total_minor || 0);
    const b = Number(conflict ? cmp.latest_total_minor || 0 : cmp.shown_total_minor || 0);
    return b - a;
  })();

  return (
    <Shell
      id={T}
      state={state}
      title={t("قبول عرض سعر — لا موافقة على نسخة قديمة")}
      hint={t("فرق النسخة معروض سطراً بسطر، والقبول يخص النسخة المعروضة وحدها.")}
      cached={doc.fromCache}
    >
      {state === "offline" ? <StateView state="offline" title={t1("بلا اتصال")} /> : null}

      {state === "success" && accepted ? (
        <StateView state="success" title={t("قُبل العرض")}>
          <Para>
            {t(
              "الإصدار المقبول يُثبَّت نسخةً من الاتفاق: كمياته وأسعاره ورسومه ومدته كما كانت لحظة القبول. الاتفاق: الإصدار",
            )}{" "}
            <M>{accepted.agreed_version ?? ""}</M>.
          </Para>
          <Note>
            {t("نسخة لا مرجع")} {t("· انتهاء الكتالوج بعد القبول لا يمسّ الاتفاق.")}
          </Note>
          <Button label={t("تفاصيل الطلب")} onPress={toDetail} />
        </StateView>
      ) : null}
      {rejected ? (
        <StateView state="success" title={t("رُفض العرض وطُلب تعديل")}>
          <Para>{t("عاد الطلب إلى «بانتظار رد المورد» وسببك يظهر له.")}</Para>
          <Button label={t("تفاصيل الطلب")} onPress={toDetail} />
        </StateView>
      ) : null}
      {requoted ? (
        <StateView state="success" title={t("طُلب تأكيد جديد")}>
          <Para>{t("عاد الطلب إلى «بانتظار رد المورد» — لا قبول صامت لسعر انتهت صلاحيته.")}</Para>
          <Button label={t("تفاصيل الطلب")} onPress={toDetail} />
        </StateView>
      ) : null}

      {state === "validation_error" ? (
        <StateView state="validation_error" title={t("قبول إصدار ليس الأحدث")}>
          <Para>
            {t("الرابط المفتوح للإصدار")} <M>{shown?.number ?? ""}</M> {t("والمورد أرسل الإصدار")}{" "}
            <M>{superseded ?? ""}</M>.
          </Para>
          <Button
            label={t("اعرض الإصدار الجديد وفرقه")}
            onPress={() => {
              setSuperseded(null);
            }}
          />
        </StateView>
      ) : null}

      {state === "expired" && shown ? (
        <StateView state="expired" title={t("انتهت صلاحية العرض أثناء المراجعة")}>
          <Para>
            {t("صلاحية الإصدار")} <M>{shown.number}</M> {t("كانت حتى")}{" "}
            <M>{dm(shown.valid_until)}</M>.
          </Para>
          <Stack>
            <Button
              label={t("اطلب تأكيداً جديداً")}
              financial
              loading={busy === "requote"}
              onPress={() => void requote()}
            />
            <Button
              label={t("قبول — مغلق")}
              variant="secondary"
              onPress={() => undefined}
              disabledReason={t("انتهت صلاحية العرض — لا قبول لسعر منتهٍ")}
            />
          </Stack>
        </StateView>
      ) : null}

      {conflict && shown && latest ? (
        <StateView state="conflict" title={t("نسخة أحدث متاحة")}>
          <Para>
            {t("فتحتَ النسخة")} <M>{shown.number}</M> {t("· المورد أصدر النسخة")}{" "}
            <M>{latest.number}</M> <Ago iso={latest.sent_at} />
            {t(". لم نقبل نيابة عنك ولم نستبدل الشاشة من تحتك.")}
          </Para>
          <Note>
            {t("ما يلي فرق النسختين. القبول ينشئ اتفاقاً على النسخة")} <M>{latest.number}</M>{" "}
            {t("بعد قراءتك للفرق؛ النسخة")} <M>{shown.number}</M> {t("لم تعد قابلة للقبول.")}
          </Note>
        </StateView>
      ) : null}

      {cmp && shown && request && !accepted && !rejected && !requoted ? (
        <>
          <Stack>
            <StatusWord
              tone={conflict ? "conflict" : state === "expired" ? "expired" : "stale"}
              label={conflict ? t("تعارض") : t("عرض سعر")}
            />
          </Stack>
          <AppText variant="title" style={{ marginBottom: SPACE["3"] }}>
            <M>{`Q-${cmp.order.number}`}</M> — {cmp.order.supplier_name}
          </AppText>
          <GroupedList title={t("البند")}>
            {cmp.rows.map((r, i) => (
              <Row
                key={r.offer_id}
                title={`${r.public_name}${r.pack_label ? ` — ${r.pack_label}` : ""}`}
                last={i === cmp.rows.length - 1}
              >
                <Cells
                  items={[
                    [
                      t("طلبك"),
                      <>
                        <M>{r.requested_qty}</M> × {money(r.requested_price_minor)}
                      </>,
                    ],
                    [
                      conflict
                        ? `${t("النسخة")} ${shown.number} ${t("— التي فتحتها")}`
                        : `${t("عرض المورد — النسخة")} ${shown.number}`,
                      <>
                        <M>{r.shown_qty ?? "—"}</M> × {money(r.shown_price_minor)}
                      </>,
                    ],
                    ...(conflict
                      ? ([
                          [
                            `${t("النسخة")} ${latest?.number ?? ""} ${t("— الحالية")}`,
                            <>
                              <M>{r.current_qty ?? "—"}</M> × {money(r.current_price_minor)}
                            </>,
                          ],
                        ] as [string, ReactNode][])
                      : []),
                  ]}
                />
                {r.increase_reason ? (
                  <Note>
                    {t("سبب الزيادة:")} {r.increase_reason}
                  </Note>
                ) : null}
                <Note>
                  {t("الفرق")}:{" "}
                  {conflict ? (
                    r.version_diff_label === "بلا تغيير" ? (
                      t("بلا تغيير")
                    ) : (
                      <LineDiff
                        qty={r.current_qty ?? 0}
                        qtyRef={r.shown_qty ?? r.requested_qty}
                        price={r.current_price_minor}
                        priceRef={r.shown_price_minor}
                        unit={r.unit_name}
                      />
                    )
                  ) : (
                    <>
                      {r.diff_label}
                      {r.diff_label !== "بلا تغيير" ? (
                        <>
                          {" · "}
                          <LineDiff
                            qty={r.shown_qty ?? r.requested_qty}
                            qtyRef={r.requested_qty}
                            price={r.shown_price_minor}
                            priceRef={r.requested_price_minor}
                            unit={r.unit_name}
                          />
                        </>
                      ) : null}
                    </>
                  )}
                </Note>
              </Row>
            ))}
          </GroupedList>
          <GroupedList>
            <Row
              title={t("رسوم التوصيل")}
              sub={
                conflict && cur
                  ? cur.delivery_fee_minor && !shown.delivery_fee_minor
                    ? `${t("بند جديد لم يكن في النسخة")} ${shown.number}`
                    : t("بلا تغيير")
                  : shown.delivery_fee_minor
                    ? t("رسمٌ مضاف")
                    : t("بلا تغيير")
              }
              trailing={
                shown.delivery_fee_minor ? (
                  <M>{formatMinor(shown.delivery_fee_minor)}</M>
                ) : (
                  t("مشمول")
                )
              }
            />
            <Row
              title={t("مهلة التسليم")}
              sub={
                conflict &&
                cur?.delivery_days &&
                shown.delivery_days &&
                cur.delivery_days > shown.delivery_days ? (
                  <DaysDiff n={cur.delivery_days - shown.delivery_days} />
                ) : !conflict && shown.delivery_days ? (
                  t("مدةٌ معلنة")
                ) : (
                  t("بلا تغيير")
                )
              }
              trailing={
                (conflict ? cur?.delivery_days : shown.delivery_days) ? (
                  <Days n={(conflict ? cur?.delivery_days : shown.delivery_days) ?? 0} />
                ) : (
                  "—"
                )
              }
            />
            <Row
              title={t("الإجمالي")}
              sub={
                dd ? (
                  <M>{`${dd > 0 ? "+" : "−"}${formatMinor(String(Math.abs(dd)))}`}</M>
                ) : (
                  t("بلا تغيير")
                )
              }
              trailing={money(conflict ? cmp.latest_total_minor : cmp.shown_total_minor)}
              last
            />
          </GroupedList>
          {targetVersion?.valid_until && state !== "expired" ? (
            <Note>
              {t("صلاحية النسخة")} <M>{targetVersion.number}</M> {t("تنتهي بعد")} <M>{hms(left)}</M>
              {t(
                ". عند انتهائها لا يصبح القبول تلقائياً ولا ملغى تلقائياً — يعود الطلب إلى «بانتظار تأكيد جديد».",
              )}
            </Note>
          ) : null}
          {state !== "expired" ? (
            <Stack>
              <Button
                label={`${t("قبول النسخة")} ${targetVersion?.number ?? shown.number} ${t("كما هي")}`}
                financial
                loading={busy === "accept"}
                onPress={() => void accept(targetVersion?.number ?? shown.number)}
                disabledReason={lock}
              />
              {conflict ? (
                <Button
                  label={`${t("قبول النسخة")} ${shown.number} ${t("— مغلق")}`}
                  variant="secondary"
                  onPress={() => undefined}
                  disabledReason={`${t("النسخة")} ${shown.number} ${t("لم تعد قابلة للقبول — الأحدث")} ${cur?.number ?? ""}`}
                />
              ) : null}
            </Stack>
          ) : null}
          <TextField
            label={t("سبب الرفض أو التعديل المطلوب — يظهر للمورد")}
            value={rejectReason}
            onChangeText={setRejectReason}
          />
          <Button
            label={t("رفض وطلب تعديل")}
            variant="secondary"
            loading={busy === "reject"}
            onPress={() => void reject()}
            disabledReason={
              lock ?? (rejectReason.trim() ? undefined : t("الرفض يحتاج سبباً يظهر للمورد"))
            }
          />
        </>
      ) : null}
      {cmp && !shown && !accepted ? (
        <StateView state="empty" title={t("لا عرض من المورد بعد")}>
          <Button label={t("تفاصيل الطلب")} onPress={toDetail} />
        </StateView>
      ) : null}
    </Shell>
  );
}

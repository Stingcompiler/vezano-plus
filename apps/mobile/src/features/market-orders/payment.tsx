import { dayMonth, formatMinor, hhmm } from "@sting/app-core";
import { AppText, Button, GroupedList, StateView, TextField } from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import {
  Heading,
  M,
  Note,
  Para,
  Row,
  Shell,
  Stack,
  StatusWord,
} from "@/components/market-orders/parts";
import { dm, safeGet, safePost } from "@/features/market-orders/lib";
import { MO_TEXTS, tOf } from "@/features/market-orders/texts";
import type { OrderRow } from "@/features/market-orders/types";
import { useDoc } from "@/features/market-orders/use-doc";
import { useSession } from "@/lib/session";

const T = "ORD-13";
const t = tOf(T);
const t1 = tOf("ORD-01");
type State = "ready" | "validation_error" | "partial" | "stale" | "success" | "offline";

interface Payment {
  id: string;
  number: number;
  ref_label: string;
  amount_minor: string;
  transfer_ref: string;
  transferred_on: string;
  allocations: { order_id: string; number_label: string; amount_minor: string }[];
  evidence_name: string;
  note: string;
  status: "recorded" | "matched" | "rejected";
  status_label: string;
  uploaded_at: string;
  matched_at: string;
  matched_by_name: string;
  decision_note: string;
  reminded_at: string;
  hours_since_upload: number;
  stale: boolean;
}

interface Payload {
  order: OrderRow;
  side: "buyer" | "supplier";
  payments: Payment[];
  due_minor: string;
  paid_minor: string;
  open_orders: { id: string; number_label: string; due_minor: string }[];
  stale_hours: number;
  created?: Payment;
  payment?: Payment;
}

function WhenDay({ iso }: { iso: string }) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const yest = new Date(Date.now() - 86_400_000).toDateString() === d.toDateString();
  const { day, month } = dayMonth(iso);
  return (
    <>
      {sameDay ? (
        t("اليوم")
      ) : yest ? (
        t("أمس")
      ) : (
        <>
          <M>{day}</M> {month}
        </>
      )}{" "}
      <M>{hhmm(iso)}</M>
    </>
  );
}

const digits = (s: string) => s.replace(/\D/g, "");

/** ORD-13 — إثبات دفع ومتابعة المطابقة (10-D6 stale · 41-D33 ready/validation_error/partial/success): الإيصال ليس تحصيلاً. */
export default function PaymentPage() {
  const router = useRouter();
  const { api } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const doc = useDoc<Payload>(
    `market.order.${id}.payments`,
    useCallback(
      () =>
        safeGet<Payload>(() =>
          api.GET("/api/market/orders/{order_id}/payments", { params: { path: { order_id: id } } }),
        ),
      [api, id],
    ),
  );
  const p = doc.shown;
  const [amount, setAmount] = useState("");
  const [ref, setRef] = useState("");
  const [on, setOn] = useState(new Date().toISOString().slice(0, 10));
  const [split, setSplit] = useState(false);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<{ code: string; extra: Record<string, string> } | null>(null);
  const [created, setCreated] = useState<Payment | null>(null);
  const [matched, setMatched] = useState<Payment | null>(null);
  const [calm, setCalm] = useState(false);

  useEffect(() => {
    if (doc.notFound) router.replace(`/market/orders/${id}`);
  }, [doc.notFound, router, id]);
  useEffect(() => {
    if (p) setAmount((cur) => cur || p.due_minor);
  }, [p]);

  const submit = async () => {
    if (busy) return;
    setBusy("record");
    setErr(null);
    try {
      const allocations = split
        ? Object.entries(alloc)
            .filter(([, v]) => Number(v || 0) > 0)
            .map(([order_id, v]) => ({ order_id, amount_minor: v }))
        : [];
      const r = await safePost<Payload | { detail?: string; extra?: Record<string, unknown> }>(() =>
        api.POST("/api/market/orders/{order_id}/payments", {
          params: { path: { order_id: id } },
          body: {
            amount_minor: amount,
            transfer_ref: ref,
            transferred_on: on,
            allocations,
          } as never,
        }),
      );
      if (r.kind === "offline") {
        setErr({ code: "offline", extra: {} });
        return;
      }
      const b = r.body;
      if (r.ok && b && "payments" in b) {
        doc.replace(b);
        setCreated(b.created ?? null);
      } else {
        const e = b as { detail?: string; extra?: Record<string, unknown> } | undefined;
        const extra: Record<string, string> = {};
        for (const [k, v] of Object.entries(e?.extra ?? {}))
          extra[k] = typeof v === "string" ? v : "";
        setErr({ code: e?.detail ?? "server_error", extra });
      }
    } finally {
      setBusy("");
    }
  };

  const act = async (pay: Payment, action: "match" | "reject" | "remind") => {
    if (busy) return;
    setBusy(`${action}:${pay.id}`);
    try {
      const r = await safePost<Payload>(() =>
        api.POST("/api/market/orders/{order_id}/payments/{payment_id}/{action}", {
          params: { path: { order_id: id, payment_id: pay.id, action } },
          body: {} as never,
        }),
      );
      if (r.kind === "done" && r.ok && r.body) {
        doc.replace(r.body);
        if (action === "match" && r.body.payment) setMatched(r.body.payment);
      }
    } finally {
      setBusy("");
    }
  };

  const stalePay = (p?.payments ?? []).find((x) => x.stale) ?? null;
  const splitPay = (p?.payments ?? []).find((x) => x.allocations.length > 1) ?? null;
  const down = doc.net === "offline" || doc.net === "failed";
  const state: State = matched
    ? "success"
    : err
      ? "validation_error"
      : !p && down
        ? "offline"
        : created && created.allocations.length > 1
          ? "partial"
          : stalePay && !created && p?.side === "buyer" && !calm
            ? "stale"
            : splitPay && !created
              ? "partial"
              : "ready";
  const openAlloc = p?.open_orders ?? [];
  const allocTotal = Object.values(alloc).reduce((a, v) => a + Number(v || 0), 0);
  const lock = doc.fromCache ? MO_TEXTS.needsServer : undefined;
  const toDetail = () => router.push(`/market/orders/${id}`);

  return (
    <Shell
      id={T}
      state={state}
      title={t("إثبات الدفع — الإيصال ليس تحصيلاً")}
      hint={t("رفع صورة الحوالة لا يُسدِّد ذمة. الذمة تُخفض عند تأكيد المورد وصول المبلغ.")}
      cached={doc.fromCache}
    >
      {state === "offline" ? <StateView state="offline" title={t1("بلا اتصال")} /> : null}

      {state === "success" && matched ? (
        <StateView state="success" title={t("طابَق المورد الدفعة")}>
          <Para>
            {t(
              "الذمّة نقصت عند المطابقة، والكشف يُظهر التاريخين: تاريخ التحويل وتاريخ المطابقة. التحويل",
            )}{" "}
            <M>{dm(matched.transferred_on)}</M> {t("· المطابقة")} <M>{dm(matched.matched_at)}</M>.
          </Para>
          <Button label={t("تفاصيل الطلب")} onPress={toDetail} />
        </StateView>
      ) : null}
      {state === "validation_error" && err ? (
        <StateView state="validation_error" title={t("مبلغ مخالف أو تحويل مستهلك")}>
          <Para>
            {err.code === "reference_used" ? (
              <>
                {t("الإيصال نفسه استُخدم في طلب سابق (")}
                {err.extra.order_number_label ?? ""} · {err.extra.payment ?? ""})
              </>
            ) : err.code === "amount_mismatch" ? (
              <>
                {t("المبلغ")} <M>{formatMinor(err.extra.amount_minor ?? "0")}</M>{" "}
                {t("يخالف المستحقّ")} <M>{formatMinor(err.extra.due_minor ?? "0")}</M>{" "}
                {t("بلا بيان.")}
              </>
            ) : err.code === "allocation_mismatch" ? (
              <>
                {t("مجموع التوزيع")} <M>{formatMinor(err.extra.allocated_minor ?? "0")}</M>{" "}
                {t("لا يساوي المبلغ")} <M>{formatMinor(err.extra.amount_minor ?? "0")}</M>.
              </>
            ) : (
              t("تعذّر تسجيل الإيصال.")
            )}
          </Para>
          <Note>
            {t("لا استخدام مكرر")}{" "}
            {t(
              "· مرجع التحويل يُطابَق مرة واحدة. والفرق عن المستحقّ يُقبل بتوزيعٍ مشروع لا بالسكوت.",
            )}
          </Note>
        </StateView>
      ) : null}
      {state === "partial" ? (
        <StateView state="partial" title={t("دفعة على طلبين")}>
          <Para>{t("تحويلٌ واحد يغطي طلبين — والتوزيع صريح يُدخله المستخدم.")}</Para>
        </StateView>
      ) : null}

      {state === "stale" && stalePay && p ? (
        <>
          <Stack>
            <StatusWord tone="stale" label={t("بيانات قديمة")} />
          </Stack>
          <AppText variant="title">
            {t("تحويل بنكي إلى")} {p.order.supplier_name}
          </AppText>
          <Note>
            {t("مرفوع")} <WhenDay iso={stalePay.uploaded_at} /> {t("· على الطلب")}{" "}
            <M>{p.order.number_label}</M>
          </Note>
          <StateView state="stale" title={t("أثر هذا الإيصال على دفترك — الآن")}>
            <Para>
              {t("لم يؤكد المورد بعد، ومضت")} <M>{stalePay.hours_since_upload}</M> {t("ساعة.")}
            </Para>
            <Note>
              {t(
                "لن نخفض ذمتك من طرف واحد لأن الرقم حينها يصبح رأيك في وضعك المالي لا حقيقته، فتجد نفسك تطلب بضاعة على رصيد لم يصل. الإيصال محفوظ ومؤرَّخ وهو دليلك عند المطالبة.",
              )}
            </Note>
            {p.side === "buyer" ? (
              <Stack>
                <Button
                  label={t("تذكير المورد بالمطابقة")}
                  financial
                  loading={busy === `remind:${stalePay.id}`}
                  onPress={() => void act(stalePay, "remind")}
                  disabledReason={lock}
                />
                <Button
                  label={t("رفع إيصال أوضح")}
                  variant="secondary"
                  onPress={() => setCalm(true)}
                />
              </Stack>
            ) : null}
          </StateView>
          <GroupedList>
            <Row
              title={t("رفعتَ إيصال التحويل")}
              sub={t("الصورة محفوظة ومؤرَّخة ومربوطة بالطلب. هذا فعلك ودليلك.")}
              trailing={<StatusWord tone="success" label={t("تم")} />}
            >
              <Note>
                <WhenDay iso={stalePay.uploaded_at} />
              </Note>
            </Row>
            <Row
              title={t("مطابقة المورد")}
              sub={t("يؤكد وصول المبلغ إلى حسابه. هو وحده يراه في بنكه.")}
              trailing={<StatusWord tone="stale" label={t("بانتظار")} />}
            >
              <Note>
                {t("مضت")} <M>{stalePay.hours_since_upload}</M> {t("ساعة")}
              </Note>
            </Row>
            <Row
              title={t("خفض الذمة")}
              sub={t("يقع عند المطابقة لا عند الرفع. حتى ذلك الحين رصيدك كما هو.")}
              trailing={<StatusWord tone="saved_local" label={t("لم يحدث")} />}
              last
            />
          </GroupedList>
          <GroupedList>
            <Row
              title={t("ذمتك للمورد")}
              sub={t("لم تتغيّر بالرفع")}
              trailing={<M>{formatMinor(p.due_minor)}</M>}
            />
            <Row
              title={t("قيمة الإيصال المرفوع")}
              sub={t("مسجَّل كإثبات لا كسداد")}
              trailing={<M>{formatMinor(stalePay.amount_minor)}</M>}
            />
            <Row
              title={t("الرصيد بعد المطابقة — متوقع")}
              sub={t("يُطبَّق عند تأكيد المورد لا قبله")}
              trailing={
                <M>
                  {formatMinor(
                    String(Math.max(0, Number(p.due_minor) - Number(stalePay.amount_minor))),
                  )}
                </M>
              }
              last
            />
          </GroupedList>
        </>
      ) : null}

      {p && state !== "stale" && !matched ? (
        <>
          <GroupedList>
            <Row
              title={t("المستحقّ الآن — من المستلَم وحده")}
              trailing={<M>{formatMinor(p.due_minor)}</M>}
            />
            <Row title={t("مطابَق حتى الآن")} trailing={<M>{formatMinor(p.paid_minor)}</M>} last />
          </GroupedList>
          {p.payments.length ? (
            <GroupedList>
              {p.payments.map((pay, i) => (
                <Row
                  key={pay.id}
                  title={<M>{pay.ref_label}</M>}
                  sub={
                    <>
                      <M>{formatMinor(pay.amount_minor)}</M> {t("· مرجع")} <M>{pay.transfer_ref}</M>{" "}
                      {t("· تاريخ التحويل")} <M>{dm(pay.transferred_on)}</M>
                      {pay.matched_at ? (
                        <>
                          {" "}
                          {t("· تاريخ المطابقة")} <M>{dm(pay.matched_at)}</M>
                        </>
                      ) : null}
                      {pay.allocations.length > 1
                        ? ` ${t("· موزَّع:")} ${pay.allocations.map((a) => `${a.number_label} ${formatMinor(a.amount_minor)}`).join(" · ")}`
                        : ""}
                    </>
                  }
                  last={i === p.payments.length - 1}
                  trailing={
                    <StatusWord
                      tone={
                        pay.status === "matched"
                          ? "success"
                          : pay.status === "rejected"
                            ? "expired"
                            : "stale"
                      }
                      label={pay.status_label}
                    />
                  }
                >
                  {p.side === "supplier" && pay.status === "recorded" ? (
                    <Stack>
                      <Button
                        label={t("طابِق — وصل المبلغ")}
                        financial
                        loading={busy === `match:${pay.id}`}
                        onPress={() => void act(pay, "match")}
                        disabledReason={lock}
                      />
                      <Button
                        label={t("لم يصل")}
                        variant="secondary"
                        loading={busy === `reject:${pay.id}`}
                        onPress={() => void act(pay, "reject")}
                        disabledReason={lock}
                      />
                    </Stack>
                  ) : null}
                </Row>
              ))}
            </GroupedList>
          ) : null}
          {p.side === "buyer" ? (
            <>
              <Heading>{t("إيصال مرفوع بحالته")}</Heading>
              <Note>
                {t("صورة التحويل ومبلغه وتاريخه، وشارة «مسجَّل — غير مطابق» حتى يُقرّ المورد.")}{" "}
                {t("الرفع لا يُسدّد")} {t("· الذمّة لا تنقص برفع إيصال.")}
              </Note>
              <TextField
                label={t("المبلغ (بالقرش)")}
                mono
                keyboardType="number-pad"
                value={amount}
                onChangeText={(x) => setAmount(digits(x))}
              />
              <TextField label={t("مرجع التحويل")} mono value={ref} onChangeText={setRef} />
              <TextField
                label={t("تاريخ التحويل")}
                mono
                placeholder="YYYY-MM-DD"
                value={on}
                onChangeText={setOn}
              />
              {openAlloc.length ? (
                <Button
                  label={split ? t("توزيع صريح — مفعَّل") : t("تحويل واحد على طلبين؟ وزّعه صراحةً")}
                  variant={split ? "secondary" : "quiet"}
                  onPress={() => setSplit((v) => !v)}
                />
              ) : null}
              {split ? (
                <>
                  <TextField
                    label={`${t("على هذا الطلب")} ${p.order.number_label}`}
                    mono
                    keyboardType="number-pad"
                    value={alloc[id] ?? ""}
                    onChangeText={(x) => setAlloc((c) => ({ ...c, [id]: digits(x) }))}
                  />
                  {openAlloc.map((o) => (
                    <TextField
                      key={o.id}
                      label={`${t("على")} ${o.number_label} ${t("(مستحقّه")} ${formatMinor(o.due_minor)})`}
                      mono
                      keyboardType="number-pad"
                      value={alloc[o.id] ?? ""}
                      onChangeText={(x) => setAlloc((c) => ({ ...c, [o.id]: digits(x) }))}
                    />
                  ))}
                  <Note>
                    {t("مجموع التوزيع")} <M>{formatMinor(String(allocTotal))}</M> {t("من")}{" "}
                    <M>{formatMinor(amount || "0")}</M>
                  </Note>
                </>
              ) : null}
              <Button
                label={t("ارفع الإيصال — مسجَّل لا مسدَّد")}
                financial
                loading={busy === "record"}
                onPress={() => void submit()}
                disabledReason={
                  lock ??
                  (!ref.trim() ? t("مرجع التحويل مطلوب") : !amount ? t("المبلغ مطلوب") : undefined)
                }
              />
              {created ? (
                <StatusWord tone="stale" label={`${created.ref_label} · ${created.status_label}`} />
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </Shell>
  );
}

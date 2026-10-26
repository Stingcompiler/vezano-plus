import { dayMonth, formatMinor, hhmm } from "@sting/app-core";
import type { StateCode } from "@sting/design";
import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, Screen, StateView } from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { FetchFail } from "@/components/market-seller/fetch-fail";
import { PhaseScreen } from "@/components/market-seller/phase";
import { Fact, Heading, M, Note, Row, Stack, StateWord } from "@/components/market-seller/parts";
import { netState, qtyOfMilli, safeGet, send, useServerGet } from "@/features/market-seller/lib";
import { MS_TEXTS } from "@/features/market-seller/texts";
import { useSession } from "@/lib/session";

const T = "LINK-03";

interface ShipmentRow {
  shipment_id: string;
  ref_label: string;
  order_id: string;
  order_label: string;
  supplier_name: string;
  received_at: string;
  received_by_name: string;
  converted: boolean;
  local_number: string;
  mode: string;
}
interface PreviewLine {
  offer_id: string;
  offer_name: string;
  supplier_unit: string;
  received: number;
  shipped: number;
  price_minor: number;
  item_name: string;
  unit_name: string;
  factor_milli: number;
  my_qty_milli: number;
  value_minor: number;
}
interface Duplicate {
  receipt_id: string;
  receipt_number: string;
  occurred_at: string;
  user_name: string;
  lines: { item_name: string; qty_milli: string; unit_code: string }[];
}
interface Unmapped {
  offer_id: string;
  name: string;
  unit_name: string;
  qty: number;
}
interface Preview {
  shipment: ShipmentRow;
  party_linked: boolean;
  party_name: string;
  branch_id: string;
  branch_name: string;
  lines: PreviewLine[];
  unmapped: Unmapped[];
  payable_minor: string;
  state: "ready" | "unmapped" | "duplicate" | "converted";
  duplicates: Duplicate[];
  link: { local_number: string; mode: string } | null;
}
interface Payload {
  state: "ready" | "phase_locked";
  can_convert: boolean;
  shipments: ShipmentRow[];
  pending_count: number;
}

/** «صنف واحد / صنفان / ثلاثة أصناف / N أصناف / N صنفاً». */
function ItemsWord({ n }: { n: number }) {
  if (n === 1) return <>{tx(T, "صنف واحد")}</>;
  if (n === 2) return <>{tx(T, "صنفان")}</>;
  if (n === 3) return <>{tx(T, "ثلاثة أصناف")}</>;
  return (
    <>
      <M>{n}</M> {n <= 10 ? tx(T, "أصناف") : tx(T, "صنفاً")}
    </>
  );
}

/** «09 سبتمبر 14:30» — الأرقام mono والشهر نص. */
function When({ iso }: { iso: string }) {
  const { day, month } = dayMonth(iso);
  return (
    <>
      <M>{day}</M> {month} <M>{hhmm(iso)}</M>
    </>
  );
}

/** LINK-03 — تحويل استلام إلى مستند (29-D22 ready/conflict · 38-D30 validation_error/success · phase_locked): معاينة الأثر ومصدر واحد لا تكرار (ACC-130). */
export default function LinkReceiptsScreen() {
  const router = useRouter();
  const { api } = useSession();
  const { shipment: wanted = "" } = useLocalSearchParams<{ shipment?: string }>();
  const srv = useServerGet<Payload>("cache.market.link.receipts", () =>
    safeGet(() => api.GET("/api/market/link/receipts")),
  );
  const [pv, setPv] = useState<Preview | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<{ code: string; extra: Record<string, unknown> } | null>(null);
  const [done, setDone] = useState<{ local_number: string; mode: string } | null>(null);
  const [offlineTry, setOfflineTry] = useState(false);
  const data = srv.shown;

  const preview = async (shipmentId: string, reset: boolean) => {
    if (reset) {
      setErr(null);
      setDone(null);
    }
    const r = await send<Preview>(() =>
      api.GET("/api/market/link/receipts/{shipment_id}/{action}", {
        params: { path: { shipment_id: shipmentId, action: "preview" } },
      }),
    );
    if (r.kind === "offline") setOfflineTry(true);
    else if (r.kind === "ok" && r.body.shipment) setPv(r.body);
  };

  useEffect(() => {
    if (wanted) void preview(wanted, true);
  }, [wanted]);

  const convert = async (body: Record<string, unknown> = {}) => {
    if (busy || !pv) return;
    setBusy("convert");
    setErr(null);
    setOfflineTry(false);
    try {
      const r = await send<{
        link?: { local_number: string; mode: string };
        detail?: string;
        extra?: Record<string, unknown>;
      }>(() =>
        api.POST("/api/market/link/receipts/{shipment_id}/{action}", {
          params: { path: { shipment_id: pv.shipment.shipment_id, action: "convert" } },
          body: body as never,
        }),
      );
      if (r.kind === "offline") return setOfflineTry(true);
      if (r.kind === "ok" && r.body.link) {
        setDone(r.body.link);
        await srv.reload();
        await preview(pv.shipment.shipment_id, false);
        return;
      }
      setErr({ code: r.body?.detail ?? "server_error", extra: r.body?.extra ?? {} });
    } finally {
      setBusy("");
    }
  };

  if (data && data.state === "phase_locked") return <PhaseScreen id={T} />;

  const net = netState(srv.net, srv.fromCache, srv.status);
  const state: StateCode = done
    ? "success"
    : err?.code === "unmapped_items" || pv?.state === "unmapped"
      ? "validation_error"
      : err?.code === "duplicate_receipt" || pv?.state === "duplicate"
        ? "conflict"
        : (net ?? (data ? "ready" : "loading"));
  const dup = pv?.duplicates[0] ?? null;
  const unmapped = pv
    ? pv.unmapped.length
      ? pv.unmapped
      : ((err?.extra.unmapped as Unmapped[] | undefined) ?? [])
    : [];

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "تحويل استلام إلى مستند — معاينة الأثر ومصدر واحد لا تكرار")}
      onRefresh={() => void srv.reload()}
    >
      <Note>
        {tx(
          T,
          "شحنة وصلت عبر طلب سوق تصبح مستند استلام في دفترك. الخطر: أن تُسجّلها يدوياً أيضاً فيصير المخزون ضعف الحقيقة. لذلك المصدر واحد ومعلَن.",
        )}
      </Note>
      <FetchFail net={net} hasData={Boolean(data)} onRetry={() => void srv.reload()} />
      {net && data ? <Note>{MS_TEXTS.cached}</Note> : null}
      {offlineTry ? <Note tone="danger">{MS_TEXTS.needsServer}</Note> : null}

      {state === "validation_error" && pv ? (
        <StateView state="validation_error" title={tx(T, "صنف بلا مطابقة")}>
          <AppText variant="secondary">
            {tx(T, "الاستلام فيه صنف لم يُطابَق بعد، فلا يُعرف أيّ مخزون يدخل.")}
          </AppText>
          {unmapped.map((u) => (
            <AppText key={u.offer_id} variant="secondary">
              <AppText variant="bodyStrong">{u.name}</AppText> <M>{u.qty}</M> {u.unit_name}{" "}
              {tx(T, "— بلا مطابقة")}
            </AppText>
          ))}
          <Button
            label={tx(T, "طابق الأصناف")}
            variant="secondary"
            onPress={() => router.push("/market/link/items")}
          />
        </StateView>
      ) : null}

      {state === "conflict" && pv && dup ? (
        <StateView state="conflict" title={tx(T, "هذه الشحنة سُجِّلت يدوياً بالفعل")}>
          <AppText variant="secondary">
            <AppText variant="bodyStrong">{tx(T, "وجدنا مستند استلام")}</AppText>{" "}
            <M>{dup.receipt_number}</M>{" "}
            {tx(
              T,
              "بنفس الكميات وتاريخ قريب. نوقف التحويل ونعرض المستندين جنباً إلى جنب: إمّا تربط هذا بذاك فيبقى مستند واحد، أو تؤكّد أنهما شحنتان مختلفتان. لا نُضيف ولا نحذف تلقائياً — الرقم المزدوج في المخزون لا يظهر إلا في الجرد بعد شهر.",
            )}
          </AppText>
          <Fact
            label={
              <>
                {tx(T, "شحنة السوق")} <M>{pv.shipment.ref_label}</M>
              </>
            }
          >
            {pv.lines.map((l) => (
              <AppText key={l.offer_id}>
                {l.item_name} · <M>{qtyOfMilli(l.my_qty_milli)}</M> {l.unit_name}
                {"\n"}
              </AppText>
            ))}
            <AppText variant="note" muted>
              {tx(T, "استلمها")} {pv.shipment.received_by_name} ·{" "}
              <When iso={pv.shipment.received_at} />
            </AppText>
          </Fact>
          <Fact
            label={
              <>
                {tx(T, "مستند الاستلام اليدوي")} <M>{dup.receipt_number}</M>
              </>
            }
          >
            {dup.lines.map((l, i) => (
              <AppText key={i}>
                {l.item_name} · <M>{qtyOfMilli(l.qty_milli)}</M> {l.unit_code}
                {"\n"}
              </AppText>
            ))}
            <AppText variant="note" muted>
              {tx(T, "سجّله")} {dup.user_name} · <When iso={dup.occurred_at} />
            </AppText>
          </Fact>
          <Button
            label={`${tx(T, "اربط الشحنة بـ")}${dup.receipt_number} ${tx(T, "— مستند واحد")}`}
            financial
            loading={busy === "convert"}
            onPress={() => void convert({ attach_receipt_id: dup.receipt_id })}
          />
          <Button
            label={tx(T, "شحنتان مختلفتان — حوّل مستنداً جديداً")}
            variant="secondary"
            loading={busy === "convert"}
            onPress={() => void convert({ distinct_receipt_ids: [dup.receipt_id] })}
          />
        </StateView>
      ) : null}

      {state === "success" && done ? (
        <StateView
          state="success"
          title={
            done.mode === "attached"
              ? tx(T, "رُبطت الشحنة بمستند قائم — مستند واحد")
              : tx(T, "أُنشئ المستند")
          }
        >
          <AppText variant="secondary">
            {done.mode === "attached"
              ? tx(T, "لا مستند ثانٍ: الشحنة تشير إلى مستند الاستلام اليدوي كمصدرها.")
              : tx(
                  T,
                  "مستند شراء في دفترك مرتبطٌ بطلب السوق. الأثر مُعلن: المخزون والذمّة والتكلفة.",
                )}
          </AppText>
          <AppText variant="note" muted>
            <AppText variant="bodyStrong">{tx(T, "لا أثر مزدوج")}</AppText>{" "}
            {tx(T, "· المستند يُنشأ مرة واحدة ولو أُعيد التحويل — والرابط بينهما هو الحارس.")}
          </AppText>
          <AppText variant="note" muted>
            <M>{done.local_number}</M>
          </AppText>
          <Button
            label={tx(T, "التالي")}
            variant="secondary"
            onPress={() => {
              setDone(null);
              setPv(null);
            }}
          />
        </StateView>
      ) : null}

      {err && !["unmapped_items", "duplicate_receipt"].includes(err.code) ? (
        <StateView state="partial" title={tx(T, "لم يُحوَّل")}>
          <AppText variant="secondary">
            {err.code === "party_not_linked"
              ? tx(T, "اربط الطرف أولاً.")
              : err.code === "permission_denied"
                ? tx(T, "التحويل للمالك ومدير الفرع — التزام مالي.")
                : err.code}
          </AppText>
        </StateView>
      ) : null}

      {data && !pv ? (
        <>
          <Heading>
            {tx(T, "شحنات مستلَمة بانتظار التحويل —")} <M>{data.pending_count}</M>
          </Heading>
          {data.shipments.length === 0 ? (
            <Note>{tx(T, "لا شحنات مستلَمة من منشآت مربوطة بعد.")}</Note>
          ) : null}
          <GroupedList>
            {data.shipments.map((s, i) => (
              <Row
                key={s.shipment_id}
                title={
                  <>
                    <M>{s.ref_label}</M> {tx(T, "من")} <M>{s.order_label}</M> · {s.supplier_name}
                  </>
                }
                sub={
                  <>
                    {tx(T, "استُلمت")} <When iso={s.received_at} />
                  </>
                }
                trailing={
                  s.converted ? (
                    <StateWord state="success" label={`${tx(T, "حُوِّلت —")} ${s.local_number}`} />
                  ) : (
                    <StateWord state="stale" label={tx(T, "بانتظار التحويل")} />
                  )
                }
                onPress={() => void preview(s.shipment_id, true)}
                last={i === data.shipments.length - 1}
              />
            ))}
          </GroupedList>
        </>
      ) : null}

      {pv ? (
        <>
          <Heading>{tx(T, "معاينة الأثر قبل التحويل")}</Heading>
          <Note>
            {tx(T, "شحنة")} <M>{pv.shipment.ref_label}</M> {tx(T, "من الطلب")}{" "}
            <M>{pv.shipment.order_label}</M> · {pv.shipment.supplier_name}{" "}
            {pv.party_linked
              ? `${tx(T, "· الطرف في دفترك:")} ${pv.party_name}`
              : tx(T, "· الطرف غير مربوط")}
          </Note>
          <Fact label={tx(T, "مستند استلام جديد في دفترك")}>
            {pv.link ? <M>{pv.link.local_number}</M> : "PD-…"}
            {"\n"}
            <AppText variant="note" muted>
              {tx(T, "يشير إلى شحنة السوق")} {pv.shipment.ref_label}{" "}
              {tx(T, "كمصدر — مصدر واحد معلَن")}
            </AppText>
          </Fact>
          <Fact label={`${tx(T, "المخزون —")} ${pv.branch_name}`}>
            {pv.lines.map((l) => (
              <AppText key={l.offer_id}>
                {l.item_name} · <M>{qtyOfMilli(l.my_qty_milli)}</M> {l.unit_name} (
                <M>{l.received}</M> {l.supplier_unit} × <M>{qtyOfMilli(l.factor_milli)}</M>){"\n"}
              </AppText>
            ))}
            <AppText variant="note" muted>
              <ItemsWord n={pv.lines.length} /> {tx(T, "بوحداتك بعد التحويل المؤكَّد")}
            </AppText>
          </Fact>
          <Fact label={tx(T, "ذمّة المورد")}>
            <M>{formatMinor(pv.payable_minor)}</M>
            {"\n"}
            <AppText variant="note" muted>
              {tx(T, "تُسجَّل كما في الطلب المؤكَّد، لا كما في أي سعر حالي")}
            </AppText>
          </Fact>
          <Fact label={tx(T, "ما لا يحدث")}>
            <AppText variant="bodyStrong">{tx(T, "لا سداد")}</AppText>
            {"\n"}
            <AppText variant="note" muted>
              {tx(T, "التحويل يسجّل الالتزام ولا يدفع شيئاً")}
            </AppText>
          </Fact>
          <Note>
            {tx(T, "لا شيء من هذا يحدث قبل ضغطك. المعاينة هي العقد: تقرأ الأثر كاملاً ثم تُقرّه.")}
          </Note>
          <Stack>
            {pv.state === "ready" && data?.can_convert ? (
              <Button
                label={tx(T, "أقرّ الأثر وحوّل إلى مستند")}
                financial
                loading={busy === "convert"}
                onPress={() => void convert()}
              />
            ) : null}
            {pv.state === "ready" && data && !data.can_convert ? (
              <Button
                label={tx(T, "أقرّ الأثر وحوّل إلى مستند")}
                financial
                onPress={() => undefined}
                disabledReason={tx(T, "التحويل للمالك ومدير الفرع — التزام مالي.")}
              />
            ) : null}
            {pv.state === "converted" ? (
              <StateWord
                state="success"
                label={`${tx(T, "حُوِّلت —")} ${pv.link?.local_number ?? ""}`}
              />
            ) : null}
            <Button
              label={tx(T, "رجوع")}
              variant="quiet"
              onPress={() => {
                setPv(null);
                setErr(null);
                setDone(null);
              }}
            />
          </Stack>
        </>
      ) : null}
    </Screen>
  );
}

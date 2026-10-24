import { formatMinor } from "@sting/app-core";
import { AppText, Button, Chip, GroupedList, StateView, TextField } from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import {
  ChipRow,
  Heading,
  M,
  Note,
  Para,
  Row,
  Shell,
  Stack,
  StatusWord,
  Units,
  When,
} from "@/components/market-orders/parts";
import { type Rejection, safeGet, safePost } from "@/features/market-orders/lib";
import { MO_TEXTS, tOf } from "@/features/market-orders/texts";
import type { OrderRow } from "@/features/market-orders/types";
import { useDoc } from "@/features/market-orders/use-doc";
import { useSession } from "@/lib/session";

const T = "ORD-12";
const t = tOf(T);
const t1 = tOf("ORD-01");
type State = "ready" | "empty" | "partial" | "permission_denied" | "success" | "stale" | "offline";

interface DLine {
  offer_id: string;
  public_name: string;
  unit_name: string;
  shipped: number;
  received: number;
  rejected: number;
  gap: number;
  reason: string;
  price_minor: string;
  buyer_value_minor: string;
  supplier_value_minor: string;
  gap_value_minor: string;
}

interface Evidence {
  side: "buyer" | "supplier";
  title: string;
  note?: string;
  at: string;
  kind: string;
  by?: string;
}

interface Dispute {
  id: string;
  number: number;
  ref_label: string;
  title: string;
  shipment_ref: string;
  status: "open" | "closed";
  status_label: string;
  turn: "buyer" | "supplier";
  turn_label: string;
  turn_deadline: string;
  days_open: number;
  lines: DLine[];
  evidence: Evidence[];
  outcome: string;
  outcome_label: string;
  outcome_ref: string;
  mediator_requested_at: string;
  opened_at: string;
  closed_at: string;
  buyer_name: string;
  supplier_name: string;
  order_number_label: string;
  order_id: string;
}

interface Payload {
  order: OrderRow;
  side: "buyer" | "supplier";
  disputes: Dispute[];
  can_settle: boolean;
  turn_hours: number;
  dispute?: Dispute;
}

const DaysOpen = ({ n }: { n: number }) =>
  n === 0 ? (
    <>{t("اليوم")}</>
  ) : n === 1 ? (
    <>{t("يوم")}</>
  ) : n === 2 ? (
    <>{t("يومين")}</>
  ) : (
    <>
      <M>{n}</M> {n <= 10 ? t("أيام") : t("يوماً")}
    </>
  );

/** ORD-12 — خلاف وأدلته وتطور حالته (10-D6 partial · 41-D33 ready/empty/permission_denied/success): دفتران مستقلان وموظف مسؤول. */
export default function Disputes() {
  const router = useRouter();
  const { api } = useSession();
  const { id, d: wantedParam = "" } = useLocalSearchParams<{ id: string; d?: string }>();
  const doc = useDoc<Payload>(
    `market.order.${id}.disputes`,
    useCallback(
      () =>
        safeGet<Payload>(() =>
          api.GET("/api/market/orders/{order_id}/disputes", { params: { path: { order_id: id } } }),
        ),
      [api, id],
    ),
  );
  const p = doc.shown;
  const [wanted, setWanted] = useState(wantedParam);
  const [evTitle, setEvTitle] = useState("");
  const [evNote, setEvNote] = useState("");
  const [closeRef, setCloseRef] = useState("");
  const [closeOutcome, setCloseOutcome] = useState<"return" | "credit" | "accept">("credit");
  const [busy, setBusy] = useState("");
  const [denied, setDenied] = useState(false);
  const [closed, setClosed] = useState<Dispute | null>(null);

  useEffect(() => {
    if (doc.notFound) router.replace(`/market/orders/${id}`);
  }, [doc.notFound, router, id]);

  const act = async (
    d: Dispute,
    action: "evidence" | "accept-supplier" | "close" | "mediator",
    body: Record<string, unknown> = {},
  ) => {
    if (busy) return;
    setBusy(action);
    setDenied(false);
    try {
      const r = await safePost<Payload & Rejection>(() =>
        api.POST("/api/market/orders/{order_id}/disputes/{dispute_id}/{action}", {
          params: { path: { order_id: id, dispute_id: d.id, action } },
          body: body as never,
        }),
      );
      if (r.kind === "offline") return;
      if (r.status === 403) {
        setDenied(true);
        return;
      }
      if (r.ok && r.body) {
        doc.replace(r.body);
        if (r.body.dispute?.status === "closed") setClosed(r.body.dispute);
        if (action === "evidence") {
          setEvTitle("");
          setEvNote("");
        }
      }
    } finally {
      setBusy("");
    }
  };

  const open = (p?.disputes ?? []).filter((x) => x.status === "open");
  const current = (p?.disputes ?? []).find((x) => x.id === wanted) ?? open[0] ?? null;
  const lock = doc.fromCache ? MO_TEXTS.needsServer : undefined;
  const down = doc.net === "offline" || doc.net === "failed";
  const state: State = closed
    ? "success"
    : denied
      ? "permission_denied"
      : !p && down
        ? "offline"
        : doc.fromCache
          ? "stale"
          : p && p.disputes.length === 0
            ? "empty"
            : current && current.status === "open"
              ? "partial"
              : "ready";
  const toDetail = () => router.push(`/market/orders/${id}`);

  return (
    <Shell
      id={T}
      state={state}
      title={t("الخلاف — دفتران مستقلان وموظف مسؤول")}
      hint={t(
        "إغلاق تذكرة الدعم لا يسوّي دفتراً. ما يُغلق هو التذكرة، وما يسوّي هو إجراء مخوَّل من الطرف نفسه.",
      )}
      cached={doc.fromCache}
    >
      {state === "offline" ? <StateView state="offline" title={t1("بلا اتصال")} /> : null}

      {state === "success" && closed ? (
        <StateView state="success" title={t("أُغلق الخلاف")}>
          <Para>
            {t("بالنتيجة المتفَق عليها ومرجعها: مرتجعٌ أو خصمٌ أو قبولٌ بالحالة.")}{" "}
            <M>{closed.ref_label}</M> — {closed.outcome_label}
            {closed.outcome_ref ? " · " : ""}
            {closed.outcome_ref ? <M>{closed.outcome_ref}</M> : null}.
          </Para>
          <Note>
            {t("الإغلاق لا يُحرّك دفتراً")}{" "}
            {t("· ما يُسوّى يُسوّى بمستند مستقل يُرى في كشف الطرف. إغلاقُ تذكرةٍ ليس قيداً.")}
          </Note>
          <Button label={t("تفاصيل الطلب")} onPress={toDetail} />
        </StateView>
      ) : null}
      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={t("مسؤول الاستلام يرفع الدليل ولا يسوّي")}>
          <Para>{t("يصوّر التالف ويكتب الواقعة، ولا يقبل تسويةً مالية.")}</Para>
          <Note>
            {t("حدّ الدور")}{" "}
            {t(
              "· التسوية إقرارٌ مالي يخضع لحدّ الدور في «الأدوار والصلاحيات». والشهادة على ما رآه ليست تنازلاً عن مال.",
            )}
          </Note>
        </StateView>
      ) : null}
      {state === "empty" ? (
        <StateView state="empty" title={t("لا خلافات")}>
          <Para>{t("حالةٌ سويّة بل مرغوبة.")}</Para>
          <Button label={t("تفاصيل الطلب")} onPress={toDetail} />
        </StateView>
      ) : null}
      {state === "ready" && p && p.disputes.length ? (
        <StateView state="ready" title={t("الخلاف ومن عليه الدور")}>
          <Para>
            {t(
              "الخط الزمني وأدلة الطرفين وآخر إجراء ومهلة الرد — ومن عليه الدور معلَنٌ في الترويسة.",
            )}
          </Para>
        </StateView>
      ) : null}

      {p && p.disputes.length && !closed ? (
        <GroupedList>
          {p.disputes.map((x, i) => (
            <Row
              key={x.id}
              title={
                <>
                  <M>{x.ref_label}</M> — {x.title}
                </>
              }
              last={i === p.disputes.length - 1}
              onPress={() => setWanted(x.id)}
              trailing={
                <StatusWord
                  tone={x.status === "open" ? "conflict" : "success"}
                  label={
                    x.status === "open" ? x.turn_label : `${x.status_label} · ${x.outcome_label}`
                  }
                />
              }
            />
          ))}
        </GroupedList>
      ) : null}

      {current && !closed && current.status === "open" && p ? (
        <>
          <Stack>
            <StatusWord tone="partial" label={t("جزئي")} />
            <StatusWord tone="conflict" label={t("خلاف")} />
          </Stack>
          <AppText variant="title">
            <M>{current.ref_label}</M> — {current.title}
          </AppText>
          <Note>
            {t("على الشحنة")} <M>{current.shipment_ref}</M> {t("· مفتوح")}{" "}
            <DaysOpen n={current.days_open} /> {t("· مسؤول من كل طرف")}
          </Note>
          <Stack>
            <StatusWord tone="stale" label={current.turn_label} />
            {current.turn_deadline ? (
              <Note>
                {t("المهلة حتى")} <When iso={current.turn_deadline} />
              </Note>
            ) : null}
          </Stack>

          <GroupedList
            title={`${t("دفترك —")} ${p.side === "buyer" ? current.buyer_name : current.supplier_name}`}
          >
            {current.lines.map((l, i) => (
              <Row key={l.offer_id} title={l.public_name} last={i === current.lines.length - 1}>
                <Note>
                  {p.side === "buyer" ? t("المستلم من الشحنة") : t("المشحون من الشحنة")}:{" "}
                  <Units
                    n={p.side === "buyer" ? l.received : l.shipped}
                    unit={l.unit_name || t("وحدة")}
                  />
                </Note>
                <Note>
                  {p.side === "buyer" ? t("الذمة المسجَّلة") : t("المطالبة المسجَّلة")}:{" "}
                  <M>
                    {formatMinor(p.side === "buyer" ? l.buyer_value_minor : l.supplier_value_minor)}
                  </M>
                </Note>
                <Note>
                  {t("إدخال المخزون")}:{" "}
                  {p.side === "buyer"
                    ? t("بعدّك عند الاستلام — لا حركة حتى «تحويل الاستلام»")
                    : "—"}
                </Note>
              </Row>
            ))}
          </GroupedList>
          <GroupedList
            title={
              p.side === "buyer"
                ? t("دفتر المورد — كما يعرضه هو")
                : t("دفتر المشتري — كما يعرضه هو")
            }
          >
            {current.lines.map((l, i) => (
              <Row key={l.offer_id} title={l.public_name} last={i === current.lines.length - 1}>
                <Note>
                  {p.side === "buyer" ? t("المشحون من الشحنة") : t("المستلم من الشحنة")}:{" "}
                  <Units
                    n={p.side === "buyer" ? l.shipped : l.received}
                    unit={l.unit_name || t("وحدة")}
                  />
                </Note>
                <Note>
                  {p.side === "buyer" ? t("المطالبة المسجَّلة") : t("الذمة المسجَّلة")}:{" "}
                  <M>
                    {formatMinor(p.side === "buyer" ? l.supplier_value_minor : l.buyer_value_minor)}
                  </M>
                </Note>
                <Note>
                  {t("الفارق المتنازع")}: <Units n={l.gap} unit={l.unit_name || t("وحدة")} /> ·{" "}
                  <M>{formatMinor(l.gap_value_minor)}</M>
                </Note>
              </Row>
            ))}
          </GroupedList>
          <Note>
            {t(
              "نعرض رقمه كما هو ولا نعدّله ولا نضعه في دفترك. الاختلاف حقيقة قائمة لا خطأ يُصحّح تلقائياً.",
            )}
          </Note>

          <Heading>{t("الأدلة وآخر إجراء")}</Heading>
          {(["buyer", "supplier"] as const).map((side) => (
            <GroupedList
              key={side}
              title={side === p.side ? t("أنت") : side === "supplier" ? t("المورد") : t("المشتري")}
            >
              {current.evidence
                .filter((e) => e.side === side)
                .map((e, i, arr) => (
                  <Row
                    key={`${side}-${i}`}
                    title={e.title}
                    sub={
                      <>
                        <When iso={e.at} />
                        {e.note ? ` · ${e.note}` : ""}
                      </>
                    }
                    last={i === arr.length - 1}
                  />
                ))}
            </GroupedList>
          ))}
          <Note>
            {t("لا تسوية تلقائية")}{" "}
            {t(
              "· حين يتفق الطرفان، يسجّل كل طرف إجراءه في دفتره بصلاحيته: أنت تقبل الكرتونة كمستلمة، أو هو يصدر إشعاراً دائناً.",
            )}
          </Note>

          <TextField
            label={t("عنوان الدليل أو التعليق")}
            value={evTitle}
            onChangeText={setEvTitle}
          />
          <TextField label={t("الواقعة (اختياري)")} value={evNote} onChangeText={setEvNote} />
          <Stack>
            <Button
              label={t("إضافة دليل أو تعليق")}
              variant="secondary"
              loading={busy === "evidence"}
              onPress={() => void act(current, "evidence", { title: evTitle, note: evNote })}
              disabledReason={lock ?? (evTitle.trim() ? undefined : t("اكتب عنواناً للدليل"))}
            />
            {p.side === "buyer" ? (
              <Button
                label={t("قبول رقم المورد وتعديل دفتري")}
                financial
                loading={busy === "accept-supplier"}
                onPress={() => void act(current, "accept-supplier")}
                disabledReason={lock}
              />
            ) : null}
            <Button
              label={t("طلب وسيط من فيزانو بلص")}
              variant="secondary"
              loading={busy === "mediator"}
              onPress={() => void act(current, "mediator")}
              disabledReason={
                lock ?? (current.mediator_requested_at ? t("طُلب الوسيط من قبل") : undefined)
              }
            />
          </Stack>
          <Heading>{t("الإغلاق بالنتيجة المتفَق عليها")}</Heading>
          <ChipRow>
            {(
              [
                ["return", t("مرتجع")],
                ["credit", t("خصم/إشعار دائن")],
                ["accept", t("قبول بالحالة")],
              ] as const
            ).map(([k, label]) => (
              <Chip
                key={k}
                label={label}
                on={closeOutcome === k}
                onPress={() => setCloseOutcome(k)}
              />
            ))}
          </ChipRow>
          <TextField
            label={t("مرجع المستند المستقل (مرتجع/إشعار دائن/إقرار)")}
            value={closeRef}
            onChangeText={setCloseRef}
          />
          <Button
            label={t("أغلق الخلاف بمرجعه")}
            variant="secondary"
            loading={busy === "close"}
            onPress={() => void act(current, "close", { outcome: closeOutcome, ref: closeRef })}
            disabledReason={
              lock ?? (closeRef.trim() ? undefined : t("الإغلاق يحتاج مرجع المستند المستقل"))
            }
          />
        </>
      ) : null}
    </Shell>
  );
}

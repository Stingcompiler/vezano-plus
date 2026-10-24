import { hhmm } from "@sting/app-core";
import { AppText, Button, GroupedList, StateView, TextField } from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import {
  Cells,
  DM,
  Heading,
  M,
  Note,
  Para,
  Row,
  Shell,
  Stack,
  StatusWord,
} from "@/components/market-orders/parts";
import { num, safeGet, safePost } from "@/features/market-orders/lib";
import { MO_TEXTS, tOf } from "@/features/market-orders/texts";
import type { OrderRow } from "@/features/market-orders/types";
import { useDoc } from "@/features/market-orders/use-doc";
import { useSession } from "@/lib/session";

const T = "ORD-08";
const t = tOf(T);
const t1 = tOf("ORD-01");
type State = "ready" | "validation_error" | "partial" | "success" | "stale" | "offline";

interface ShipLine {
  offer_id: string;
  public_name: string;
  pack_label: string;
  unit_name: string;
  confirmed: number;
  shipped: number;
  remaining: number;
}

interface Shipment {
  id: string;
  number: number;
  ref_label: string;
  lines: { offer_id: string; public_name: string; qty: number }[];
  carrier_ref: string;
  eta_note: string;
  note: string;
  shipped_at: string;
  received_at: string;
}

interface Shipments {
  order: OrderRow;
  lines: ShipLine[];
  shipments: Shipment[];
  next_ref: string;
  percent: number;
  can_ship: boolean;
  side: "buyer" | "supplier";
  shipped?: string;
}

const ordinal = (n: number) =>
  ["", t("الأولى"), t("الثانية"), t("الثالثة"), t("الرابعة"), t("الخامسة"), t("السادسة")][n] ??
  `${t("رقم")} ${n}`;
const ordinalIndef = (n: number) =>
  ["", t("أولى"), t("ثانية"), t("ثالثة"), t("رابعة"), t("خامسة"), t("سادسة")][n] ??
  `${t("رقم")} ${n}`;

/** ORD-08 — تجهيز وتسليم جزئي (27-D20 validation_error/partial/success · 12-D7 ready): التراكم لا يتجاوز المؤكَّد أبداً. */
export default function Ship() {
  const router = useRouter();
  const { api } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const doc = useDoc<Shipments>(
    `market.order.${id}.shipments`,
    useCallback(
      () =>
        safeGet<Shipments>(() =>
          api.GET("/api/market/orders/{order_id}/shipments", {
            params: { path: { order_id: id } },
          }),
        ),
      [api, id],
    ),
  );
  const d = doc.shown;
  const [qty, setQty] = useState<Record<string, string>>({});
  const [carrier, setCarrier] = useState("");
  const [eta, setEta] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Shipments | null>(null);
  const seeded = useRef("");

  useEffect(() => {
    if (doc.notFound) router.replace(`/market/orders/${id}`);
  }, [doc.notFound, router, id]);
  useEffect(() => {
    if (!d || seeded.current === id) return;
    seeded.current = id;
    setQty(Object.fromEntries(d.lines.map((l) => [l.offer_id, "0"])));
  }, [d, id]);

  const over = (d?.lines ?? []).filter((l) => num(qty[l.offer_id]) > l.remaining);
  const any = (d?.lines ?? []).some((l) => num(qty[l.offer_id]) > 0);
  const lock = doc.fromCache ? MO_TEXTS.needsServer : undefined;

  const submit = async () => {
    setAttempted(true);
    if (over.length || !any || busy || !d) return;
    setBusy(true);
    try {
      const r = await safePost<Shipments>(() =>
        api.POST("/api/market/orders/{order_id}/shipments", {
          params: { path: { order_id: id } },
          body: {
            lines: d.lines.map((l) => ({ offer_id: l.offer_id, qty: num(qty[l.offer_id]) })),
            carrier_ref: carrier,
            eta_note: eta,
          } as never,
        }),
      );
      if (r.kind === "done" && r.ok && r.body) setDone(r.body);
    } finally {
      setBusy(false);
    }
  };

  const down = doc.net === "offline" || doc.net === "failed";
  const state: State = done
    ? "success"
    : attempted && over.length
      ? "validation_error"
      : !d && down
        ? "offline"
        : doc.fromCache
          ? "stale"
          : d && d.shipments.length
            ? "partial"
            : "ready";
  const toDetail = () => router.push(`/market/orders/${id}`);

  return (
    <Shell
      id={T}
      state={state}
      title={t("تجهيز وتسليم جزئي — التراكم لا يتجاوز المؤكَّد أبداً")}
      hint={t(
        "شحنة بعد شحنة على الطلب نفسه. الحدّ الصلب: مجموع المشحون ≤ المؤكَّد لكل صنف، وكل شحنة لها مرجع مستقل يُطابق عند الاستلام.",
      )}
      cached={doc.fromCache}
    >
      {state === "offline" ? <StateView state="offline" title={t1("بلا اتصال")} /> : null}

      {state === "success" && done ? (
        <StateView state="success" title={`${t("شُحنت")} ${done.shipped ?? ""}`}>
          <Para>
            {done.percent >= 100 ? (
              t("اكتمل المشحون — بانتظار الاستلام والعدّ عند المشتري.")
            ) : (
              <>
                {t("حالة الطلب صارت «مشحون جزئياً —")} <M>{done.percent}</M>
                {t("%». المتبقّي معلَن للطرفين، وللمشتري أن يلغيه أو ينتظر شحنة")}{" "}
                {ordinalIndef(done.shipments.length + 1)}.
              </>
            )}
          </Para>
          <Button label={t("تفاصيل الطلب")} onPress={toDetail} />
        </StateView>
      ) : null}
      {state === "validation_error" ? (
        <StateView
          state="validation_error"
          title={`${t("validation_error على")} ${over.length === 1 ? t("صف") : t("صفوف")} ${t("— يتجاوز المؤكَّد")}`}
        >
          <Para>
            {t("أُدخل")} <M>{qty[over[0]?.offer_id ?? ""] ?? ""}</M> {over[0]?.unit_name ?? ""}{" "}
            {t("والمتبقّي")} <M>{over[0]?.remaining ?? 0}</M>{" "}
            {t(
              "فقط. لا نقبل الشحنة ولا نقتطع الفائض صامتين — نوقف الحفظ ونعرض الرقم الأقصى المسموح. لو أراد المورد شحن أكثر فذلك",
            )}{" "}
            {t("تعديل على الطلب")} {t("يحتاج موافقة المشتري، لا شحنة زائدة.")}
          </Para>
        </StateView>
      ) : null}
      {state === "ready" && d ? (
        <StateView state="ready" title={t("الشحنة — بيان المورد كما هو")}>
          <Para>
            {t(
              "بيان التحميل معروض بلا تعديل. وصول الشحنة لا يكتب مخزوناً — المخزون يُكتب بعدّك عند الاستلام.",
            )}
          </Para>
          <Note>
            {t(
              "رقم الناقل ووقت الوصول حقول اختيارية للاستدلال لاحقاً عند الخلاف، لا شروطاً لتسجيل الاستلام.",
            )}
          </Note>
        </StateView>
      ) : null}

      {d && !done ? (
        <>
          <Stack>
            <StatusWord
              tone={state === "partial" ? "partial" : "stale"}
              label={state === "partial" ? t("جزئي") : t("تجهيز")}
            />
          </Stack>
          <AppText variant="title">
            {t("تجهيز شحنة —")} <M>{d.order.number_label}</M>
          </AppText>
          <Note>
            {t("المشتري:")} {d.order.buyer_name} {t("· الشحنة")} {ordinal(d.shipments.length + 1)}{" "}
            {t("على هذا الطلب · مرجع الشحنة")} <M>{d.next_ref}</M>
          </Note>
          {d.side === "supplier" && d.can_ship ? (
            <>
              <GroupedList>
                {d.lines.map((l, i) => {
                  const q = num(qty[l.offer_id]);
                  const isOver = q > l.remaining;
                  return (
                    <Row
                      key={l.offer_id}
                      title={l.public_name}
                      sub={l.pack_label || l.unit_name}
                      dim={isOver}
                      last={i === d.lines.length - 1}
                    >
                      <Cells
                        items={[
                          [t("مؤكَّد"), <M key="c">{l.confirmed}</M>],
                          [t("شُحن سابقاً"), <M key="s">{l.shipped}</M>],
                          [t("المتبقّي"), <M key="r">{l.remaining}</M>],
                        ]}
                      />
                      <TextField
                        label={`${t("هذه الشحنة —")} ${l.public_name}`}
                        mono
                        keyboardType="number-pad"
                        editable={l.remaining !== 0}
                        value={qty[l.offer_id] ?? "0"}
                        onChangeText={(x) =>
                          setQty((c) => ({ ...c, [l.offer_id]: x.replace(/\D/g, "") }))
                        }
                        error={
                          attempted && isOver ? `${t("الأقصى المسموح")} ${l.remaining}` : undefined
                        }
                      />
                      <Note>
                        {t("الحدّ")}:{" "}
                        {l.remaining === 0 ? (
                          t("اكتمل الصنف. الحقل مغلق لا معطَّل بلا تفسير.")
                        ) : isOver ? (
                          <>
                            {t("يتجاوز المؤكَّد بـ")}
                            <M>{q - l.remaining}</M>
                            {t(". الأقصى المسموح")} <M>{l.remaining}</M> {t("— الحفظ موقوف.")}
                          </>
                        ) : q === l.remaining && q > 0 ? (
                          t("يُكمل الصنف بهذه الشحنة.")
                        ) : (
                          <>
                            {t("الحدّ الأقصى لهذه الشحنة")} <M>{l.remaining}</M> {t("— ضمن الحدّ.")}
                          </>
                        )}
                      </Note>
                    </Row>
                  );
                })}
              </GroupedList>
              <TextField
                label={t("رقم الناقل (اختياري)")}
                value={carrier}
                onChangeText={setCarrier}
              />
              <TextField
                label={t("وقت الوصول المتوقع (اختياري)")}
                value={eta}
                onChangeText={setEta}
              />
              <Button
                label={`${t("احفظ الشحنة")} ${d.next_ref}`}
                financial
                loading={busy}
                onPress={() => void submit()}
                disabledReason={
                  lock ?? (!any && attempted ? t("أدخل كمية في سطر واحد على الأقل") : undefined)
                }
              />
            </>
          ) : (
            <Note>
              {d.side === "buyer"
                ? t("بيان المورد كما هو — المخزون يُكتب بعدّك عند الاستلام.")
                : t("لا شحن قبل اتفاق مثبَّت أو بعد اكتمال الطلب.")}
            </Note>
          )}
          <Heading>{t("مرجع الشحنة — لماذا مستقلّ")}</Heading>
          <Note>
            {t("كل شحنة تحمل مرجعاً خاصاً")} <M>SH-01/02/03</M>{" "}
            {t(
              "ومستند تسليم منفصلاً. المشتري يستلم بمرجع الشحنة لا بالطلب كله، فيكون واضحاً أيّ شحنة نقصت وأيّها وصلت سليمة.",
            )}
          </Note>
          {d.shipments.length ? (
            <GroupedList>
              {d.shipments.map((sh, i) => (
                <Row
                  key={sh.id}
                  title={<M>{sh.ref_label}</M>}
                  sub={
                    <>
                      <DM iso={sh.shipped_at} /> <M>{hhmm(sh.shipped_at)}</M> ·{" "}
                      {sh.lines.map((x, k) => (
                        <Fragment key={x.offer_id}>
                          {k ? " · " : ""}
                          {x.public_name} ×<M>{x.qty}</M>
                        </Fragment>
                      ))}
                      {sh.carrier_ref ? ` · ${sh.carrier_ref}` : ""}
                    </>
                  }
                  last={i === d.shipments.length - 1}
                  trailing={
                    <StatusWord
                      tone={sh.received_at ? "success" : "stale"}
                      label={sh.received_at ? t("استُلمت") : t("بانتظار الاستلام")}
                    />
                  }
                />
              ))}
            </GroupedList>
          ) : null}
        </>
      ) : null}
    </Shell>
  );
}

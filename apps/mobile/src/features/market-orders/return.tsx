import { AppText, Button, GroupedList, StateView, TextField } from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

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
  type ToneName,
} from "@/components/market-orders/parts";
import { num, safeGet, safePost } from "@/features/market-orders/lib";
import { MO_TEXTS, tOf } from "@/features/market-orders/texts";
import type { OrderRow } from "@/features/market-orders/types";
import { useDoc } from "@/features/market-orders/use-doc";
import { useSession } from "@/lib/session";

const T = "ORD-11";
const t = tOf(T);
const t1 = tOf("ORD-01");
type State = "ready" | "validation_error" | "partial" | "success" | "stale" | "offline";

interface RLine {
  offer_id: string;
  public_name: string;
  pack_label: string;
  unit_name: string;
  received: number;
  returned_before: number;
  returnable: number;
  rejected_at_receipt: number;
}

interface ReturnDoc {
  id: string;
  number: number;
  ref_label: string;
  lines: {
    offer_id: string;
    public_name: string;
    qty: number;
    approved_qty: number | null;
    reason: string;
  }[];
  status: "requested" | "approved" | "partial" | "rejected" | "executed";
  status_label: string;
  decision_note: string;
  requested_at: string;
  decided_at: string;
}

interface Payload {
  order: OrderRow;
  side: "buyer" | "supplier";
  lines: RLine[];
  returns: ReturnDoc[];
  steps: { title: string; detail: string }[];
  next_ref: string;
  created?: ReturnDoc;
}

const digits = (s: string) => s.replace(/\D/g, "");

/** ORD-11 — طلب مرتجع تجاري (27-D20 ready/validation_error/partial/success): موافقة ثم تنفيذ، ومستند مستقلّ لكل خطوة. */
export default function Return() {
  const router = useRouter();
  const { api } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const doc = useDoc<Payload>(
    `market.order.${id}.returns`,
    useCallback(
      () =>
        safeGet<Payload>(() =>
          api.GET("/api/market/orders/{order_id}/returns", { params: { path: { order_id: id } } }),
        ),
      [api, id],
    ),
  );
  const p = doc.shown;
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState("");
  const [created, setCreated] = useState<ReturnDoc | null>(null);
  const [approved, setApproved] = useState<Record<string, string>>({});
  const seeded = useRef("");

  useEffect(() => {
    if (doc.notFound) router.replace(`/market/orders/${id}`);
  }, [doc.notFound, router, id]);
  useEffect(() => {
    if (!p || seeded.current === id) return;
    seeded.current = id;
    setQty(Object.fromEntries(p.lines.map((l) => [l.offer_id, "0"])));
    setReason(Object.fromEntries(p.lines.map((l) => [l.offer_id, ""])));
  }, [p, id]);

  const lines = p?.lines ?? [];
  const over = lines.filter((l) => num(qty[l.offer_id]) > l.returnable);
  const missingReason = lines.filter(
    (l) => num(qty[l.offer_id]) > 0 && !(reason[l.offer_id] ?? "").trim(),
  );
  const any = lines.some((l) => num(qty[l.offer_id]) > 0);
  const lock = doc.fromCache ? MO_TEXTS.needsServer : undefined;

  const submit = async () => {
    setAttempted(true);
    if (over.length || missingReason.length || !any || busy) return;
    setBusy("request");
    try {
      const r = await safePost<Payload>(() =>
        api.POST("/api/market/orders/{order_id}/returns", {
          params: { path: { order_id: id } },
          body: {
            lines: lines
              .filter((l) => num(qty[l.offer_id]) > 0)
              .map((l) => ({
                offer_id: l.offer_id,
                qty: num(qty[l.offer_id]),
                reason: reason[l.offer_id] ?? "",
              })),
          } as never,
        }),
      );
      if (r.kind === "done" && r.ok && r.body?.created) {
        setCreated(r.body.created);
        doc.replace(r.body);
      }
    } finally {
      setBusy("");
    }
  };

  const decide = async (d: ReturnDoc) => {
    if (busy) return;
    setBusy(d.id);
    try {
      const r = await safePost<unknown>(() =>
        api.POST("/api/market/orders/{order_id}/returns/{return_id}/decide", {
          params: { path: { order_id: id, return_id: d.id } },
          body: {
            lines: d.lines.map((l) => ({
              offer_id: l.offer_id,
              approved_qty: num(approved[`${d.id}:${l.offer_id}`] ?? String(l.qty)),
            })),
          } as never,
        }),
      );
      if (r.kind === "done" && r.ok) await doc.reload();
    } finally {
      setBusy("");
    }
  };

  const pending = (p?.returns ?? []).find((r) => r.status === "requested") ?? null;
  const partialDoc = (p?.returns ?? []).find((r) => r.status === "partial") ?? null;
  const down = doc.net === "offline" || doc.net === "failed";
  const state: State = created
    ? "success"
    : attempted && (over.length || missingReason.length)
      ? "validation_error"
      : !p && down
        ? "offline"
        : doc.fromCache
          ? "stale"
          : partialDoc
            ? "partial"
            : "ready";
  const toDetail = () => router.push(`/market/orders/${id}`);

  return (
    <Shell
      id={T}
      state={state}
      title={t("طلب مرتجع تجاري — موافقة ثم تنفيذ، ومستند مستقلّ لكل خطوة")}
      hint={t(
        "المرتجع ثلاث خطوات لا خطوة: طلب، موافقة مورد، ثم تنفيذ مادّي بمستند عكسي. لا خصم من الذمّة قبل التنفيذ، ولا تجاوز للمستلَم غير المُعاد.",
      )}
      cached={doc.fromCache}
    >
      {state === "offline" ? <StateView state="offline" title={t1("بلا اتصال")} /> : null}

      {state === "success" && created ? (
        <StateView state="success" title={`${t("أُرسل طلب المرتجع")} ${created.ref_label}`}>
          <Para>{t("بانتظار موافقة المورد. مرتجع قيد الموافقة — لم يُخصم بعد.")}</Para>
          <Note>
            {t("لا خصم من الذمّة قبل التنفيذ")} {t("· طلب المرتجع وحده لا يغيّر رصيداً.")}
          </Note>
          <Button label={t("تفاصيل الطلب")} onPress={toDetail} />
        </StateView>
      ) : null}
      {state === "validation_error" && (over[0] || missingReason[0]) ? (
        <StateView state="validation_error" title={t("validation_error: يتجاوز القابل للإرجاع")}>
          <Para>
            {over[0] ? (
              <>
                {t("طُلب إرجاع")} <M>{num(qty[over[0].offer_id])}</M> {t("والقابل للإرجاع")}{" "}
                <M>{over[0].returnable}</M>
                {over[0].returned_before ? (
                  <>
                    {" "}
                    {t("— لأن")} <M>{over[0].returned_before}</M> {t("أُرجعت في مرتجع سابق")}
                  </>
                ) : null}
                {t(
                  ". المجموع لا يتجاوز المستلَم بأي حال، وحتى لو أُدخل الطلب من جهازين في وقت واحد فالفحص على الخادم لا على الشاشة.",
                )}
              </>
            ) : (
              t("كل سطر يُرجَع يحتاج سبباً مكتوباً.")
            )}
          </Para>
        </StateView>
      ) : null}
      {state === "partial" && partialDoc ? (
        <StateView state="partial" title={`${t("موافقة جزئية —")} ${partialDoc.ref_label}`}>
          <Para>
            {partialDoc.lines.map((l, k) => (
              <Fragment key={l.offer_id}>
                {k ? " · " : ""}
                {l.public_name}: <M>{l.approved_qty ?? 0}</M> {t("من")} <M>{l.qty}</M>
              </Fragment>
            ))}
            {partialDoc.decision_note ? ` — ${partialDoc.decision_note}` : ""}
          </Para>
          <Note>
            {t(
              "الموافقة الجزئية حالة معلَنة. ما لم يوافَق عليه يبقى في مخزونك وذمّتك، وبابه خلاف.",
            )}
          </Note>
        </StateView>
      ) : null}

      {p && !created ? (
        <>
          <Stack>
            <StatusWord
              tone={pending ? "stale" : partialDoc ? "partial" : "synced"}
              label={pending ? t("بانتظار موافقة") : partialDoc ? t("موافقة جزئية") : t("مرتجع")}
            />
          </Stack>
          <AppText variant="title">
            {t("مرتجع على الطلب")} <M>{p.order.number_label}</M> {t("— الكميات القابلة للإرجاع")}
          </AppText>
          <GroupedList>
            {lines.map((l, i) => {
              const q = num(qty[l.offer_id]);
              const isOver = q > l.returnable;
              return (
                <Row
                  key={l.offer_id}
                  title={l.public_name}
                  sub={l.pack_label || l.unit_name}
                  dim={isOver}
                  last={i === lines.length - 1}
                >
                  <Cells
                    items={[
                      [t("مستلَم"), <M key="a">{l.received}</M>],
                      [t("أُرجع سابقاً"), <M key="b">{l.returned_before}</M>],
                      [t("القابل للإرجاع"), <M key="c">{l.returnable}</M>],
                    ]}
                  />
                  {p.side === "buyer" ? (
                    <TextField
                      label={`${t("هذا الطلب —")} ${l.public_name}`}
                      mono
                      keyboardType="number-pad"
                      editable={l.returnable !== 0}
                      value={qty[l.offer_id] ?? "0"}
                      onChangeText={(x) => setQty((c) => ({ ...c, [l.offer_id]: digits(x) }))}
                      error={
                        attempted && isOver
                          ? `${t("يتجاوز القابل للإرجاع — الأقصى")} ${l.returnable}${t(". الفحص على الخادم لا على الشاشة.")}`
                          : undefined
                      }
                    />
                  ) : null}
                  {l.returnable === 0 && p.side === "buyer" ? (
                    <Note>{t("لا مستلَم غير مُعاد")}</Note>
                  ) : null}
                  {p.side === "buyer" && q > 0 ? (
                    <TextField
                      label={`${t("السبب —")} ${l.public_name}`}
                      value={reason[l.offer_id] ?? ""}
                      onChangeText={(x) => setReason((c) => ({ ...c, [l.offer_id]: x }))}
                      error={
                        attempted && !(reason[l.offer_id] ?? "").trim()
                          ? t("السبب مطلوب")
                          : undefined
                      }
                    />
                  ) : q === 0 && l.returnable > 0 ? (
                    <Note>{t("سليم — لا إرجاع")}</Note>
                  ) : null}
                </Row>
              );
            })}
          </GroupedList>
          {p.side === "buyer" ? (
            <Button
              label={`${t("أرسل طلب المرتجع")} ${p.next_ref}`}
              financial
              loading={busy === "request"}
              onPress={() => void submit()}
              disabledReason={
                lock ?? (pending ? t("مرتجع قيد الموافقة — انتظر قرار المورد") : undefined)
              }
            />
          ) : null}

          {p.returns.length ? (
            <>
              <Heading>{t("المرتجعات")}</Heading>
              <GroupedList>
                {p.returns.map((d, i) => {
                  const tone: ToneName =
                    d.status === "requested"
                      ? "stale"
                      : d.status === "rejected"
                        ? "expired"
                        : d.status === "partial"
                          ? "partial"
                          : "success";
                  return (
                    <Row
                      key={d.id}
                      title={<M>{d.ref_label}</M>}
                      sub={d.lines.map((l, k) => (
                        <Fragment key={l.offer_id}>
                          {k ? " · " : ""}
                          {l.public_name} ×<M>{l.qty}</M>
                          {l.approved_qty != null ? (
                            <>
                              {" "}
                              {t("(موافَق")} <M>{l.approved_qty}</M>)
                            </>
                          ) : null}{" "}
                          — {l.reason}
                        </Fragment>
                      ))}
                      last={i === p.returns.length - 1}
                      trailing={<StatusWord tone={tone} label={d.status_label} />}
                    >
                      {p.side === "supplier" && d.status === "requested" ? (
                        <Stack>
                          {d.lines.map((l) => (
                            <TextField
                              key={l.offer_id}
                              label={`${t("موافَق عليه —")} ${l.public_name} ${t("(من")} ${l.qty})`}
                              mono
                              keyboardType="number-pad"
                              value={approved[`${d.id}:${l.offer_id}`] ?? String(l.qty)}
                              onChangeText={(x) =>
                                setApproved((c) => ({ ...c, [`${d.id}:${l.offer_id}`]: digits(x) }))
                              }
                            />
                          ))}
                          <Button
                            label={t("سجّل قرارك")}
                            financial
                            loading={busy === d.id}
                            onPress={() => void decide(d)}
                            disabledReason={lock}
                          />
                        </Stack>
                      ) : null}
                    </Row>
                  );
                })}
              </GroupedList>
            </>
          ) : null}

          <Heading>{t("الخطوات ومستنداتها")}</Heading>
          <GroupedList>
            {p.steps.map((s, i) => {
              const tone: ToneName =
                i === 0 && p.returns.length
                  ? "success"
                  : i === 1 && pending
                    ? "stale"
                    : i === 1 && partialDoc
                      ? "partial"
                      : "saved_local";
              const label =
                i === 0 && p.returns.length
                  ? t("تم")
                  : i === 1 && (pending || partialDoc)
                    ? t("الآن")
                    : i === 2
                      ? t("لاحقاً")
                      : i === 0
                        ? t("الآن")
                        : t("لاحقاً");
              return (
                <Row
                  key={s.title}
                  title={s.title}
                  sub={s.detail}
                  last={i === p.steps.length - 1}
                  trailing={<StatusWord tone={tone} label={label} />}
                />
              );
            })}
          </GroupedList>
          <Note>
            {t("لا خصم من الذمّة قبل التنفيذ")}{" "}
            {t("· طلب المرتجع وحده لا يغيّر رصيداً. الذمّة تتعدّل عند")} {t("تنفيذ")}{" "}
            {t("المرتجع بمستند عكسي موقَّع من الطرفين. قبل ذلك تبقى القيمة قائمة.")}
          </Note>
        </>
      ) : null}
    </Shell>
  );
}

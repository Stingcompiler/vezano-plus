import { formatMinor } from "@sting/app-core";
import type { StateCode } from "@sting/design";
import { tx } from "@sting/texts";
import { AppText, Button, ROW_RTL, Screen, SPACE, TextField } from "@sting/ui-native";
import { useRouter } from "expo-router";
import { Fragment, type ReactNode, useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import {
  Block,
  Head,
  Lead,
  M,
  Note,
  Notice,
  StatusWord,
  StickyBar,
  Strong,
} from "@/components/purchasing/parts";
import { useSession } from "@/lib/session";

import { qty, toMilli, toMinor, useServerView, wholeMinor } from "./lib";
import { PUR_TEXTS } from "./texts";

const T = "PUR-03";
type State = Extract<
  StateCode,
  "ready" | "loading" | "validation_error" | "permission_denied" | "success" | "stale" | "offline"
>;

export interface DocLine {
  id: string;
  item_name: string;
  unit_name: string;
  ordered_qty_milli: string;
  received_qty_milli: string;
  unit_price_minor: string;
  est_unit_price_minor: string;
  line_total_minor: string;
  excess_reason: string;
  returned_qty_milli: string;
  diff: "" | "qty" | "price";
}

interface Blocker {
  code: "invoice_number_required" | "excess_reason_required";
  line_id?: string;
  item_name?: string;
  received_qty_milli?: string;
  ordered_qty_milli?: string;
}

export interface Doc {
  id: string;
  number: string;
  order_id: string;
  order_number: string;
  supplier_name: string;
  branch_name: string;
  supplier_invoice_number: string;
  status: "draft" | "referred" | "approved";
  status_label: string;
  total_minor: string;
  order_estimated_minor: string;
  diff_count: number;
  due_days: number;
  lines: DocLine[];
  approved_by_name: string;
  approved_at: string;
  referred_to_name: string;
  effects: {
    stock?: { item_name: string; qty_milli: string; unit_name: string }[];
    cost?: { item_name: string; before_minor: string; after_minor: string; unit_name: string }[];
    branch_name?: string;
    payable_minor?: string;
  };
  blockers: Blocker[];
  approval: { viewer_name: string; limit_minor: string; over_limit: boolean; can_approve: boolean };
}

type Edits = Record<string, { qty?: string; price?: string; reason?: string }>;
type DocBody = { document: Doc };

/** «+8 كراتين سكر و+6 أرز في المخزن الرئيسي.» — الأرقام mono. */
function stockSentence(fx: Doc["effects"]): ReactNode {
  const stock = fx.stock ?? [];
  return (
    <>
      {stock.map((s, i) => (
        <Fragment key={`${s.item_name}-${i}`}>
          {i > 0 ? ` ${tx(T, "و")}` : ""}
          <M>{`+${qty(s.qty_milli)}`}</M> {i === 0 ? `${s.unit_name} ` : ""}
          {s.item_name}
        </Fragment>
      ))}{" "}
      {tx(T, "في")} {fx.branch_name ?? ""}.
    </>
  );
}

/**
 * PUR-03 — مستند الشراء واعتماده: الاعتماد توقيع على مبلغ — زرّ مثبّت أسفل الشاشة مع المبلغ. فوق حدّ
 * الصلاحية يُحال لا يُعتمد؛ بلا رقم فاتورة أو بزيادة بلا سبب يُمنع الاعتماد ويبقى الحفظ كمسوّدة.
 * خادمي: النسخة المحفوظة تُعرض «قديمة» بلا شبكة ولا يُنفَّذ اعتماد ولا حفظ حتى تعود.
 */
export function DocumentScreen({
  documentId,
  orderId,
}: {
  documentId?: string | undefined;
  orderId?: string | undefined;
}) {
  const router = useRouter();
  const { api } = useSession();
  const { data, setData, source, denied } = useServerView<DocBody>(
    orderId ? `docorder.${orderId}` : `doc.${documentId ?? ""}`,
    () =>
      orderId
        ? api.POST("/api/inventory/purchasing/orders/{order_id}/document", {
            params: { path: { order_id: orderId } },
          })
        : api.GET("/api/inventory/purchasing/documents/{document_id}", {
            params: { path: { document_id: documentId ?? "" } },
          }),
  );
  const doc = data?.document ?? null;
  const [invoice, setInvoice] = useState("");
  const [edits, setEdits] = useState<Edits>({});
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [netFail, setNetFail] = useState(false);

  const docId = doc?.id;
  useEffect(() => {
    if (doc) setInvoice(doc.supplier_invoice_number);
    // التهيئة مرة لكل مستند محمَّل
  }, [docId]);

  const applyDoc = useCallback(
    (d: Doc) => {
      setData({ document: d });
      setInvoice(d.supplier_invoice_number);
      setEdits({});
    },
    [setData],
  );

  const lineBody = () =>
    (doc?.lines ?? []).map((l) => {
      const e = edits[l.id] ?? {};
      return {
        id: l.id,
        received_qty_milli: e.qty !== undefined ? String(toMilli(e.qty)) : l.received_qty_milli,
        unit_price_minor: e.price !== undefined ? String(toMinor(e.price)) : l.unit_price_minor,
        excess_reason: e.reason ?? l.excess_reason,
      };
    });

  const save = async (): Promise<Doc | null> => {
    if (!doc) return null;
    const { data: d, response } = await api.PATCH(
      "/api/inventory/purchasing/documents/{document_id}",
      {
        params: { path: { document_id: doc.id } },
        body: { supplier_invoice_number: invoice, lines: lineBody() } as never,
      },
    );
    const body = d as unknown as DocBody | undefined;
    if (response.ok && body) {
      applyDoc(body.document);
      return body.document;
    }
    return null;
  };

  const act = async (action: "approve" | "refer") => {
    if (!doc) return;
    const { data: d, response } = await api.POST(
      "/api/inventory/purchasing/documents/{document_id}/{action}",
      { params: { path: { document_id: doc.id, action } }, body: {} as never },
    );
    const body = d as unknown as DocBody | undefined;
    if (response.ok && body) applyDoc(body.document);
  };

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setNetFail(false);
    try {
      await fn();
    } catch {
      setNetFail(true);
    } finally {
      setBusy(false);
    }
  };

  const approve = () =>
    run(async () => {
      setAttempted(true);
      const saved = await save();
      if (!saved || saved.blockers.length || saved.approval.over_limit) return;
      await act("approve");
    });
  const refer = () =>
    run(async () => {
      await save();
      await act("refer");
    });
  const saveDraft = () =>
    run(async () => {
      await save();
    });

  const overLimit = doc?.approval.over_limit ?? false;
  const stale = source === "cache";
  const state: State =
    denied !== null
      ? "permission_denied"
      : source === "loading"
        ? "loading"
        : !doc
          ? "offline"
          : netFail
            ? "offline"
            : doc.status === "approved"
              ? "success"
              : overLimit
                ? "permission_denied"
                : attempted && doc.blockers.length
                  ? "validation_error"
                  : stale
                    ? "stale"
                    : "ready";

  const myName = doc?.approval.viewer_name ?? "";
  const invoiceMissing = doc?.blockers.some((b) => b.code === "invoice_number_required");
  const excessOf = (lineId: string) =>
    doc?.blockers.find((b) => b.code === "excess_reason_required" && b.line_id === lineId);
  const lineNote = (l: DocLine): ReactNode =>
    l.diff === "qty" ? (
      <>
        <M>{qty(l.ordered_qty_milli)}</M> {l.unit_name}
      </>
    ) : l.diff === "price" ? (
      `${tx(T, "سعر")} ${l.unit_name}`
    ) : (
      tx(T, "كما في الأمر")
    );
  const offlineReason = stale || netFail ? PUR_TEXTS.needsServer : undefined;

  return (
    <View style={{ flex: 1 }}>
      <Screen screenId={T} state={state} title={tx(T, "المشتريات")}>
        <Head
          title={tx(T, "مستند الشراء واعتماده — الاعتماد توقيع على مبلغ")}
          hint={tx(T, "هنا يتحرّك المخزون وتتحرّك الذمّة.")}
        />
        {denied !== null ? (
          <Notice state="permission_denied" title={tx(T, "الاعتماد للمالك والمحاسب")}>
            <Lead>{tx(T, "الاعتماد توقيع على مبلغ — أمين المخزن يستلم ولا يعتمد.")}</Lead>
          </Notice>
        ) : null}
        {state === "loading" ? <Notice state="loading" title={tx(T, "المشتريات")} /> : null}
        {state === "offline" ? (
          <Notice state="offline" title={doc ? PUR_TEXTS.needsServer : PUR_TEXTS.offlineEmpty} />
        ) : null}
        {state === "stale" ? <Note>{PUR_TEXTS.stale}</Note> : null}

        {doc ? (
          <Block>
            <View style={{ flexDirection: ROW_RTL, justifyContent: "space-between" }}>
              <AppText variant="bodyStrong">
                {tx(T, "مستند شراء")} <M>{doc.number}</M>
              </AppText>
              <StatusWord
                state={
                  doc.status === "approved"
                    ? "success"
                    : doc.status === "referred"
                      ? "pending_sync"
                      : "ready"
                }
                label={doc.status_label}
              />
            </View>
            <Note>
              {doc.supplier_name} · {doc.branch_name}
              {doc.order_number ? (
                <>
                  {" · "}
                  {doc.diff_count ? tx(T, "فروق عن الأمر") : tx(T, "على الأمر")}{" "}
                  <M>{doc.order_number}</M>
                </>
              ) : null}
            </Note>
            {doc.diff_count && doc.status !== "approved" ? (
              <Lead>
                {tx(T, "من يعتمد يوقّع على")} <M>{formatMinor(doc.total_minor)}</M>{" "}
                {tx(T, "لا على")} <M>{formatMinor(doc.order_estimated_minor)}</M>.
              </Lead>
            ) : null}
          </Block>
        ) : null}

        {doc && state === "permission_denied" && denied === null ? (
          <Notice
            state="permission_denied"
            title={tx(T, "الاعتماد فوق حدّ الصلاحية")}
            action={
              <Button
                label={
                  doc.status === "referred"
                    ? `${tx(T, "أُحيل إلى")} ${doc.referred_to_name}`
                    : `${tx(T, "أحِل إلى")} ${doc.referred_to_name || tx(T, "المالك")}`
                }
                financial
                loading={busy}
                onPress={() => void refer()}
                disabledReason={
                  doc.status === "referred"
                    ? tx(T, "أُحيل بالفعل — ينتظر توقيع المالك")
                    : offlineReason
                }
              />
            }
          >
            <Lead>
              {tx(T, "حدّك")} <M>{wholeMinor(doc.approval.limit_minor)}</M> {tx(T, "وهذا")}{" "}
              <M>{wholeMinor(doc.total_minor)}</M>.
            </Lead>
            <Lead>
              <Strong>{tx(T, "الإحالة")}</Strong> {tx(T, "· «أحِل إلى")}{" "}
              {doc.referred_to_name || tx(T, "المالك")}
              {tx(
                T,
                "» ترسل المستند كما هو، وتُبقيه مسوّدة لا معتمداً — والاعتماد يُنسب لمن وقّع.",
              )}
            </Lead>
            <Note>{tx(T, "ما أدخله المحاسب من أرقام يبقى؛ الإحالة لا تعيد العمل من الصفر.")}</Note>
          </Notice>
        ) : null}

        {doc && state === "validation_error" ? (
          <Notice state="validation_error" title={tx(T, "مستند بلا رقم فاتورة المورد")}>
            <Lead>
              {tx(
                T,
                "الاستلام مكتمل والاعتماد ممنوع: رقم فاتورة المورد فارغ، وصنفٌ استُلم بكمية تفوق الأمر بلا سبب مكتوب.",
              )}
            </Lead>
            {invoiceMissing ? (
              <Lead>
                <Strong>{tx(T, "رقم الفاتورة")}</Strong>{" "}
                {tx(
                  T,
                  "· هو ما يُطابَق به الدفتران عند المراجعة. بدونه يصير المستند داخلياً لا يُحاجَج به المورد.",
                )}
              </Lead>
            ) : null}
            {doc.blockers
              .filter((b) => b.code === "excess_reason_required")
              .map((b) => (
                <Lead key={b.line_id}>
                  <Strong>{tx(T, "الزيادة")}</Strong> {tx(T, "· استلام")}{" "}
                  <M>{qty(b.received_qty_milli ?? "0")}</M> {tx(T, "مقابل")}{" "}
                  <M>{qty(b.ordered_qty_milli ?? "0")}</M>{" "}
                  {tx(T, "مطلوبة يحتاج سطراً: هديّة، أم خطأ المورد، أم تعديل متّفق عليه هاتفياً.")}
                </Lead>
              ))}
            <Note>
              {tx(T, "الاعتماد معطّل والحفظ كمسوّدة متاح — العمل لا يضيع لأن ورقةً ناقصة.")}
            </Note>
          </Notice>
        ) : null}

        {doc && doc.status === "approved" ? (
          <Notice
            state="success"
            title={
              <>
                {tx(T, "اعتُمد المستند")} <M>{doc.number}</M>
              </>
            }
            action={
              <Button
                label={tx(T, "أنشئ مرتجعاً")}
                financial
                onPress={() =>
                  router.push({
                    pathname: "/purchasing/documents/[id]/return",
                    params: { id: doc.id },
                  })
                }
              />
            }
          >
            <Lead>{tx(T, "تحرّك المخزون وتحرّكت الذمّة الآن.")}</Lead>
            <Lead>
              <Strong>{tx(T, "المخزون")}</Strong> · {stockSentence(doc.effects)}
            </Lead>
            {(doc.effects.cost ?? [])
              .filter((c) => c.before_minor !== c.after_minor && c.before_minor !== "0")
              .map((c) => (
                <Lead key={c.item_name}>
                  <Strong>{tx(T, "التكلفة")}</Strong> {tx(T, "· متوسط تكلفة")} {c.item_name}{" "}
                  {BigInt(c.after_minor) > BigInt(c.before_minor) ? tx(T, "ارتفع") : tx(T, "انخفض")}{" "}
                  {tx(T, "من")} <M>{formatMinor(c.before_minor)}</M> {tx(T, "إلى")}{" "}
                  <M>{formatMinor(c.after_minor)}</M>{" "}
                  {tx(T, "— والهامش تبعه في «التكلفة والهامش».")}
                </Lead>
              ))}
            <Lead>
              <Strong>{tx(T, "الذمّة")}</Strong> ·{" "}
              <M>{formatMinor(doc.effects.payable_minor ?? doc.total_minor)}</M>{" "}
              {tx(T, "على المنشأة ل")}
              {doc.supplier_name}
              {tx(T, "، تستحق بعد")} <M>{doc.due_days}</M> {tx(T, "يوماً.")}
            </Lead>
            <Note>
              {tx(T, "اعتمده")} {doc.approved_by_name}
              {tx(T, ". الاعتماد لا يُلغى — يُعكس بمستند مضادّ.")}
            </Note>
          </Notice>
        ) : null}

        {doc ? (
          <>
            {doc.status !== "approved" ? (
              <TextField
                label={tx(T, "رقم فاتورة المورد")}
                mono
                value={invoice}
                onChangeText={setInvoice}
                error={
                  attempted && invoiceMissing && !invoice.trim()
                    ? tx(T, "رقم الفاتورة مطلوب للاعتماد — هو ما يُطابَق به الدفتران عند المراجعة.")
                    : undefined
                }
              />
            ) : (
              <Note>
                {tx(T, "فاتورة المورد")} <M>{doc.supplier_invoice_number}</M>
              </Note>
            )}
            {doc.lines.map((l) => {
              const e = edits[l.id] ?? {};
              const ex = excessOf(l.id);
              const setEdit = (patch: Edits[string]) =>
                setEdits((p) => ({ ...p, [l.id]: { ...p[l.id], ...patch } }));
              return (
                <Block key={l.id}>
                  <AppText variant="bodyStrong">
                    {l.item_name} — {lineNote(l)}
                  </AppText>
                  {doc.status === "approved" ? (
                    <>
                      <AppText variant="secondary" muted>
                        {tx(T, "استُلم")} <M>{qty(l.received_qty_milli)}</M> {l.unit_name}
                      </AppText>
                      <AppText variant="secondary" muted>
                        {tx(T, "سعر الوحدة")} <M>{formatMinor(l.unit_price_minor)}</M>
                      </AppText>
                    </>
                  ) : (
                    <>
                      <TextField
                        label={`${tx(T, "الكمية المستلمة —")} ${l.item_name}`}
                        mono
                        keyboardType="decimal-pad"
                        value={e.qty ?? qty(l.received_qty_milli).replace(/,/g, "")}
                        onChangeText={(v) => setEdit({ qty: v })}
                      />
                      <Note>
                        {l.unit_name} {tx(T, "· المطلوب")} <M>{qty(l.ordered_qty_milli)}</M>
                      </Note>
                      {l.diff === "qty" || ex ? (
                        <TextField
                          label={`${tx(T, "سبب الزيادة —")} ${l.item_name}`}
                          value={e.reason ?? l.excess_reason}
                          onChangeText={(v) => setEdit({ reason: v })}
                          error={
                            attempted && ex && !(e.reason ?? l.excess_reason).trim()
                              ? tx(
                                  T,
                                  "الزيادة عن الأمر تحتاج سبباً مكتوباً: هديّة، أم خطأ المورد، أم تعديل متّفق عليه.",
                                )
                              : undefined
                          }
                        />
                      ) : null}
                      <TextField
                        label={`${tx(T, "سعر")} ${l.unit_name} — ${l.item_name}`}
                        mono
                        keyboardType="decimal-pad"
                        value={e.price ?? formatMinor(l.unit_price_minor).replace(/,/g, "")}
                        onChangeText={(v) => setEdit({ price: v })}
                      />
                      {l.est_unit_price_minor ? (
                        <Note>
                          {tx(T, "في الأمر")} <M>{formatMinor(l.est_unit_price_minor)}</M>
                        </Note>
                      ) : null}
                    </>
                  )}
                  <AppText variant="secondary">
                    {tx(T, "الإجمالي")} <M>{formatMinor(l.line_total_minor)}</M>
                  </AppText>
                </Block>
              );
            })}
          </>
        ) : null}
        <View style={{ height: SPACE["4"] }} />
      </Screen>
      {doc ? (
        <StickyBar>
          <View style={{ flexDirection: ROW_RTL, justifyContent: "space-between" }}>
            <AppText variant="bodyStrong">{tx(T, "الإجمالي للاعتماد")}</AppText>
            <AppText variant="bodyStrong">
              <M>{formatMinor(doc.total_minor)}</M>
            </AppText>
          </View>
          {doc.status !== "approved" ? (
            <>
              {state !== "permission_denied" ? (
                <Button
                  label={`${tx(T, "اعتمد باسم")} ${myName}`.trim()}
                  financial
                  loading={busy}
                  disabledReason={offlineReason}
                  onPress={() => void approve()}
                />
              ) : null}
              <Button
                label={tx(T, "احفظ كمسوّدة")}
                variant="secondary"
                loading={busy}
                disabledReason={offlineReason}
                onPress={() => void saveDraft()}
              />
              {doc.order_id ? (
                <Button
                  label={tx(T, "رجوع")}
                  variant="quiet"
                  onPress={() => router.push("/purchasing/orders")}
                />
              ) : null}
            </>
          ) : null}
        </StickyBar>
      ) : null}
    </View>
  );
}

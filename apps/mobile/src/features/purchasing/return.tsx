import { formatMinor } from "@sting/app-core";
import type { StateCode } from "@sting/design";
import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, Screen, SPACE, TextField } from "@sting/ui-native";
import { useRouter } from "expo-router";
import { Fragment, type ReactNode, useEffect, useState } from "react";
import { View } from "react-native";

import {
  Block,
  ErrorText,
  Head,
  Lead,
  M,
  Note,
  Notice,
  PRow,
  StatusWord,
  Strong,
} from "@/components/purchasing/parts";
import { useSession } from "@/lib/session";

import type { Doc } from "./document";
import { qty, toMilli, useServerView } from "./lib";
import { PUR_TEXTS } from "./texts";

const T = "PUR-04";
type State = Extract<
  StateCode,
  | "ready"
  | "loading"
  | "validation_error"
  | "partial"
  | "success"
  | "permission_denied"
  | "stale"
  | "offline"
>;

interface RetLine {
  id: string;
  document_line_id: string;
  item_name: string;
  unit_name: string;
  qty_milli: string;
  unit_price_minor: string;
  line_total_minor: string;
  reason: string;
  accepted_qty_milli: string;
  supplier_note: string;
}

interface Ret {
  id: string;
  number: string;
  document_number: string;
  supplier_name: string;
  status: "recorded" | "partial" | "accepted" | "rejected";
  status_label: string;
  total_minor: string;
  accepted_minor: string;
  rejected_minor: string;
  supplier_note: string;
  lines: RetLine[];
  responded_at: string;
}

interface Detail {
  document: Doc;
  return_limits: Record<string, number>;
  returns: Ret[];
}
interface Payload {
  detail: Detail;
  viewing: (Ret & { document_id?: string }) | null;
}

const joinNodes = (nodes: ReactNode[]): ReactNode =>
  nodes.map((n, i) => (
    <Fragment key={i}>
      {i > 0 ? ` ${tx(T, "و")}` : ""}
      {n}
    </Fragment>
  ));

/** «8 كراتين» — الرقم mono. */
const QtyUnit = ({ milli, unit }: { milli: string; unit: string }) => (
  <>
    <M>{qty(milli)}</M> {unit}
  </>
);

/**
 * PUR-04 — مرتجع المشتريات: يُبنى على مستند معتمد بعينه فيرجع بسعره؛ السبب إلزامي لكل سطر؛ الردّ ممنوع
 * فوق المستلم؛ ردّ المورد يُسجَّل نصاً، والمقبول وحده يُخصم (partial). خادمي: بلا شبكة تُعرض النسخة المحفوظة
 * «قديمة» ويتعطّل التسجيل بسبب ظاهر.
 */
export function ReturnScreen({
  documentId,
  returnId,
}: {
  documentId?: string | undefined;
  returnId?: string | undefined;
}) {
  const router = useRouter();
  const { api } = useSession();
  const { data, source, denied } = useServerView<Payload>(
    returnId ? `return.${returnId}` : `retdoc.${documentId ?? ""}`,
    async () => {
      let docId = documentId ?? "";
      let ret: Payload["viewing"] = null;
      if (returnId) {
        const r = await api.GET("/api/inventory/purchasing/returns/{return_id}", {
          params: { path: { return_id: returnId } },
        });
        const rb = r.data as unknown as { return: NonNullable<Payload["viewing"]> } | undefined;
        if (!r.response.ok || !rb) return r;
        ret = rb.return;
        docId = rb.return.document_id ?? "";
      }
      const d = await api.GET("/api/inventory/purchasing/documents/{document_id}", {
        params: { path: { document_id: docId } },
      });
      if (!d.response.ok) return d;
      return { data: { detail: d.data, viewing: ret }, error: undefined, response: d.response };
    },
  );
  const detail = data?.detail ?? null;
  const doc = detail?.document ?? null;
  const [drafts, setDrafts] = useState<Record<string, { qty: string; reason: string }>>({});
  const [attempted, setAttempted] = useState(false);
  const [saved, setSaved] = useState<Ret | null>(null);
  const [viewing, setViewing] = useState<Ret | null>(null);
  const [resp, setResp] = useState<Record<string, string>>({});
  const [respNote, setRespNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [netFail, setNetFail] = useState(false);

  const loadedFor = data?.viewing?.id;
  useEffect(() => {
    if (data?.viewing) setViewing(data.viewing);
    // يُهيَّأ مرة لكل مرتجع محمَّل
  }, [loadedFor]);

  const limitOf = (lineId: string) => detail?.return_limits[lineId] ?? 0;
  const draftOf = (lineId: string) => drafts[lineId] ?? { qty: "", reason: "" };
  const lineErrors = (l: Doc["lines"][number]) => {
    const d = draftOf(l.id);
    const q = toMilli(d.qty);
    return { exceeds: q > limitOf(l.id), reason: q > 0 && !d.reason.trim() };
  };
  const activeLines = (doc?.lines ?? []).filter((l) => toMilli(draftOf(l.id).qty) > 0);
  const anyError = (doc?.lines ?? []).some((l) => {
    const e = lineErrors(l);
    return e.exceeds || e.reason;
  });
  const total = activeLines.reduce(
    (a, l) => a + (BigInt(l.unit_price_minor) * BigInt(toMilli(draftOf(l.id).qty))) / 1000n,
    0n,
  );

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

  const record = () => {
    if (!doc || busy) return;
    setAttempted(true);
    if (anyError || !activeLines.length) return;
    void run(async () => {
      const { data: d, response } = await api.POST(
        "/api/inventory/purchasing/documents/{document_id}/{action}",
        {
          params: { path: { document_id: doc.id, action: "return" } },
          body: {
            lines: activeLines.map((l) => ({
              document_line_id: l.id,
              qty_milli: String(toMilli(draftOf(l.id).qty)),
              reason: draftOf(l.id).reason.trim(),
            })),
          } as never,
        },
      );
      const body = d as unknown as { return: Ret } | undefined;
      if (response.ok && body) {
        setSaved(body.return);
        setViewing(body.return);
      }
    });
  };

  const respond = () => {
    const r = viewing;
    if (!r || busy) return;
    void run(async () => {
      const { data: d, response } = await api.POST(
        "/api/inventory/purchasing/returns/{return_id}",
        {
          params: { path: { return_id: r.id } },
          body: {
            note: respNote,
            lines: r.lines.map((l) => ({
              id: l.id,
              accepted_qty_milli: String(toMilli(resp[l.id] ?? qty(l.qty_milli).replace(/,/g, ""))),
            })),
          } as never,
        },
      );
      const body = d as unknown as { return: Ret } | undefined;
      if (response.ok && body) {
        setViewing(body.return);
        setSaved(null);
      }
    });
  };

  const stale = source === "cache";
  const state: State =
    denied !== null
      ? "permission_denied"
      : source === "loading"
        ? "loading"
        : !data
          ? "offline"
          : netFail
            ? "offline"
            : saved
              ? "success"
              : viewing && (viewing.status === "partial" || viewing.status === "rejected")
                ? "partial"
                : attempted && anyError
                  ? "validation_error"
                  : stale
                    ? "stale"
                    : "ready";
  const offlineReason = stale || netFail ? PUR_TEXTS.needsServer : undefined;

  const rejectedLines = (viewing?.lines ?? []).filter(
    (l) => l.accepted_qty_milli !== "" && BigInt(l.accepted_qty_milli) < BigInt(l.qty_milli),
  );
  const acceptedLines = (viewing?.lines ?? []).filter(
    (l) => l.accepted_qty_milli !== "" && BigInt(l.accepted_qty_milli) > 0n,
  );
  const goDoc = (id: string) =>
    router.push({ pathname: "/purchasing/documents/[id]", params: { id } });

  return (
    <Screen screenId={T} state={state} title={tx(T, "المشتريات")}>
      <Head
        title={tx(T, "مرتجع المشتريات — يُردّ ما استُلم بالسعر الذي استُلم به")}
        hint={tx(
          T,
          "المرتجع يُبنى على مستند شراء بعينه لا على الصنف مجرّداً، فيرجع بسعر تلك الفاتورة لا بسعر اليوم.",
        )}
      />
      {denied !== null ? (
        <Notice state="permission_denied" title={tx(T, "المرتجع للمالك والمحاسب")}>
          <Lead>{tx(T, "المرتجع يخفّض ذمّة المورد — أمين المخزن يرى ولا يُسجّل.")}</Lead>
        </Notice>
      ) : null}
      {state === "loading" ? <Notice state="loading" title={tx(T, "المشتريات")} /> : null}
      {state === "offline" ? (
        <Notice state="offline" title={data ? PUR_TEXTS.needsServer : PUR_TEXTS.offlineEmpty} />
      ) : null}
      {state === "stale" ? <Note>{PUR_TEXTS.stale}</Note> : null}

      {doc && doc.status !== "approved" ? (
        <Notice state="validation_error" title={tx(T, "مستند غير معتمد")}>
          <Lead>{tx(T, "لا يُردّ ما لم يُستلم — المرتجع يُبنى على مستند معتمد.")}</Lead>
        </Notice>
      ) : null}

      {saved ? (
        <Notice
          state="success"
          title={
            <>
              {tx(T, "سُجّل المرتجع")} <M>{saved.number}</M>
            </>
          }
          action={
            <Button
              label={tx(T, "عد إلى المستند")}
              financial
              onPress={() => goDoc(doc?.id ?? "")}
            />
          }
        >
          <Lead>
            {tx(T, "خرجت الكميات من المخزون وقُيِّد")} <M>{formatMinor(saved.total_minor)}</M>{" "}
            {tx(T, "لصالح المنشأة على المورد — إشعار دائن لا نقد.")}
          </Lead>
          <Lead>
            <Strong>{tx(T, "التكلفة")}</Strong>{" "}
            {tx(T, "· لا تتأثر: الردّ بسعر المستند نفسه، فالمتوسط المرجّح يبقى كما هو.")}
          </Lead>
          <Lead>
            <Strong>{tx(T, "التحليلات")}</Strong> {tx(T, "· يظهر في نسبة المرتجع لـ")}
            {saved.supplier_name} {tx(T, "مع سببه مصنّفاً.")}
          </Lead>
          <Note>{tx(T, "المسار: خصمه من مستحقّ المورد، أو مطالبته باستبدال عينيّ.")}</Note>
        </Notice>
      ) : null}

      {state === "partial" && viewing ? (
        <Notice state="partial" title={tx(T, "رُدَّ بعض ما طُلب ردُّه")}>
          <Lead>
            {tx(T, "المورد قَبِل")}{" "}
            {acceptedLines.length
              ? joinNodes(
                  acceptedLines.map((l) => (
                    <>
                      {l.item_name} (<QtyUnit milli={l.accepted_qty_milli} unit={l.unit_name} />)
                    </>
                  )),
                )
              : tx(T, "لا شيء")}{" "}
            {tx(T, "ورفض")}{" "}
            {joinNodes(
              rejectedLines.map((l) => (
                <>
                  {l.item_name} (
                  <QtyUnit
                    milli={String(BigInt(l.qty_milli) - BigInt(l.accepted_qty_milli))}
                    unit={l.unit_name}
                  />
                  )
                </>
              )),
            )}
            {viewing.supplier_note ? `: «${viewing.supplier_note}»` : ""}
            {tx(T, ". مرتجعٌ")}{" "}
            {viewing.status === "rejected" ? tx(T, "كلُّه مرفوض") : tx(T, "نصفُه مقبول")}.
          </Lead>
          <Lead>
            {tx(
              T,
              "المرتجع يبقى مفتوحاً بالمرفوض، ويُسجَّل ردُّ المورد نصاً كما قاله — هو الذي سيُحتجّ به لاحقاً.",
            )}
          </Lead>
          <Lead>
            <Strong>{tx(T, "الأثر المالي")}</Strong> {tx(T, "· يُخصم المقبول (")}
            <M>{formatMinor(viewing.accepted_minor)}</M>
            {tx(T, ") فقط. المرفوض (")}
            <M>{formatMinor(viewing.rejected_minor)}</M>
            {tx(T, ") لا يُخصم ولا يعود للمخزون قبل قرارك: تحتفظ به أو تتصعّد.")}
          </Lead>
        </Notice>
      ) : null}

      {state === "validation_error" ? (
        <Notice state="validation_error" title={tx(T, "ردٌّ أكثر مما استُلم")}>
          <Lead>
            {(doc?.lines ?? [])
              .filter((l) => lineErrors(l).exceeds)
              .map((l, i) => (
                <Fragment key={l.id}>
                  {i > 0 ? tx(T, "،") + " " : ""}
                  {tx(T, "محاولة ردّ")}{" "}
                  <QtyUnit milli={String(toMilli(draftOf(l.id).qty))} unit={l.unit_name} />{" "}
                  {l.item_name} {tx(T, "من")} <M>{qty(String(limitOf(l.id)))}</M> {tx(T, "مستلمة")}
                </Fragment>
              ))}
            {(doc?.lines ?? []).some((l) => lineErrors(l).reason)
              ? tx(T, "، وسطرٌ بكمية ردّ بلا سبب.")
              : "."}
          </Lead>
          <Lead>
            <Strong>{tx(T, "الكمية")}</Strong>{" "}
            {tx(
              T,
              "· لا يُردّ ما لم يُستلم. الحدّ الأعلى لكل سطر هو المستلم ناقص ما رُدّ سابقاً على نفس المستند.",
            )}
          </Lead>
          <Lead>
            <Strong>{tx(T, "السبب")}</Strong>{" "}
            {tx(
              T,
              "· إلزامي لأنه يُقرأ في «تحليلات المورد»: «تالف» حكمٌ على المورد، و«خطأ في الطلب» حكمٌ علينا.",
            )}
          </Lead>
        </Notice>
      ) : null}

      {viewing ? (
        <>
          <GroupedList>
            <PRow
              last
              trailing={
                <StatusWord
                  state={
                    viewing.status === "accepted"
                      ? "success"
                      : viewing.status === "recorded"
                        ? "pending_sync"
                        : "stale"
                  }
                  label={viewing.status_label}
                />
              }
            >
              <AppText variant="bodyStrong">
                {tx(T, "مرتجع")} <M>{viewing.number}</M> {tx(T, "على مستند")}{" "}
                <M>{viewing.document_number}</M>
              </AppText>
            </PRow>
          </GroupedList>
          {viewing.lines.map((l) => (
            <Block key={l.id}>
              <AppText variant="bodyStrong">{l.item_name}</AppText>
              <AppText variant="secondary" muted>
                {tx(T, "يُردّ")} <QtyUnit milli={l.qty_milli} unit={l.unit_name} />
              </AppText>
              {l.accepted_qty_milli !== "" ? (
                <Note>
                  {tx(T, "قَبِل المورد")} <M>{qty(l.accepted_qty_milli)}</M>
                </Note>
              ) : null}
              <AppText variant="secondary" muted>
                {tx(T, "سعر المستند")} <M>{formatMinor(l.unit_price_minor)}</M>
              </AppText>
              <AppText variant="secondary" muted>
                {tx(T, "السبب")} {l.reason}
              </AppText>
            </Block>
          ))}
          <Block>
            <AppText variant="bodyStrong">
              {tx(T, "قيمة المرتجع")} <M>{`−${formatMinor(viewing.total_minor)}`}</M>
            </AppText>
          </Block>
          {viewing.status === "recorded" ? (
            <>
              <Note>{tx(T, "ردّ المورد — يُسجَّل نصاً كما قاله.")}</Note>
              {viewing.lines.map((l) => (
                <Fragment key={l.id}>
                  <TextField
                    label={`${tx(T, "قَبِل المورد من")} ${l.item_name}`}
                    mono
                    keyboardType="decimal-pad"
                    value={resp[l.id] ?? qty(l.qty_milli).replace(/,/g, "")}
                    onChangeText={(v) => setResp((p) => ({ ...p, [l.id]: v }))}
                  />
                  <Note>
                    {tx(T, "من")} <QtyUnit milli={l.qty_milli} unit={l.unit_name} />
                  </Note>
                </Fragment>
              ))}
              <TextField
                label={tx(T, "ما قاله المورد")}
                value={respNote}
                onChangeText={setRespNote}
                multiline
              />
              <Button
                label={tx(T, "سجّل ردّ المورد")}
                financial
                loading={busy}
                disabledReason={offlineReason}
                onPress={respond}
              />
            </>
          ) : null}
        </>
      ) : null}

      {doc && doc.status === "approved" && !viewing ? (
        <>
          <AppText variant="bodyStrong">
            {tx(T, "مرتجع على مستند")} <M>{doc.number}</M>
          </AppText>
          <Note>{tx(T, "الأسعار مثبّتة من المستند الأصلي")}</Note>
          {doc.lines.map((l) => {
            const d = draftOf(l.id);
            const e = lineErrors(l);
            const max = limitOf(l.id);
            return (
              <Block key={l.id}>
                <AppText variant="bodyStrong">{l.item_name}</AppText>
                <AppText variant="secondary" muted>
                  {tx(T, "استُلم")} <QtyUnit milli={l.received_qty_milli} unit={l.unit_name} />
                </AppText>
                <TextField
                  label={`${tx(T, "يُردّ —")} ${l.item_name}`}
                  mono
                  keyboardType="decimal-pad"
                  value={d.qty}
                  onChangeText={(v) =>
                    setDrafts((p) => ({ ...p, [l.id]: { ...draftOf(l.id), qty: v } }))
                  }
                />
                <Note>
                  {tx(T, "الحدّ")} <QtyUnit milli={String(max)} unit={l.unit_name} />
                </Note>
                {attempted && e.exceeds ? (
                  <ErrorText>
                    {tx(T, "لا يُردّ ما لم يُستلم — الحدّ")}{" "}
                    <QtyUnit milli={String(max)} unit={l.unit_name} />.
                  </ErrorText>
                ) : null}
                <AppText variant="secondary" muted>
                  {tx(T, "سعر المستند")} <M>{formatMinor(l.unit_price_minor)}</M>
                </AppText>
                <TextField
                  label={`${tx(T, "السبب —")} ${l.item_name}`}
                  value={d.reason}
                  onChangeText={(v) =>
                    setDrafts((p) => ({ ...p, [l.id]: { ...draftOf(l.id), reason: v } }))
                  }
                  error={
                    attempted && e.reason
                      ? tx(
                          T,
                          "السبب إلزامي لكل سطر: «تالف» و«خطأ في الطلب» و«قارب الانتهاء» ثلاثة أحكام مختلفة على المورد.",
                        )
                      : undefined
                  }
                />
              </Block>
            );
          })}
          <Note>
            {tx(
              T,
              "السبب إلزامي لكل سطر: المرتجع بلا سبب لا يُقرأ في تحليلات المورد ولا يُحاجَج به. «تالف» و«خطأ في الطلب» و«قارب الانتهاء» ثلاثة أحكام مختلفة على المورد.",
            )}
          </Note>
          <AppText variant="bodyStrong" style={{ marginBottom: SPACE["3"] }}>
            {tx(T, "قيمة المرتجع")} <M>{`−${formatMinor(String(total))}`}</M>
          </AppText>
          <View style={{ gap: SPACE["3"] }}>
            <Button
              label={tx(T, "سجّل المرتجع")}
              financial
              loading={busy}
              disabledReason={offlineReason}
              onPress={record}
            />
            <Button label={tx(T, "رجوع")} variant="quiet" onPress={() => goDoc(doc.id)} />
          </View>
          {detail && detail.returns.length ? (
            <View style={{ marginTop: SPACE["4"] }}>
              <GroupedList title={tx(T, "مرتجعات سابقة على هذا المستند:")}>
                {detail.returns.map((r, i, all) => (
                  <PRow
                    key={r.id}
                    last={i === all.length - 1}
                    onPress={() =>
                      router.push({ pathname: "/purchasing/returns/[id]", params: { id: r.id } })
                    }
                  >
                    <AppText>
                      {tx(T, "مرتجع")} <M>{r.number}</M> — {r.status_label}
                    </AppText>
                  </PRow>
                ))}
              </GroupedList>
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

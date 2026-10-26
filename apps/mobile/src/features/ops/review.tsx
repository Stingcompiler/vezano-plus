import { formatMinor, hhmm } from "@sting/app-core";
import type { StoredOperation } from "@sting/platform";
import { describeOperation } from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  Screen,
  SPACE,
  StateView,
  TextField,
  useColors,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { DayLabel, N, Row, Strong } from "@/components/ops/ui";
import { call, detailOf, useCachedGet } from "@/features/ops/net";
import { OPS } from "@/features/ops/texts";
import { useShiftContext } from "@/lib/pos";
import { useSession } from "@/lib/session";

const T = "SYS-03";
type State = "ready" | "conflict" | "permission_denied" | "success" | "stale" | "offline";

interface MemberView {
  readonly entity: string;
  readonly id: string;
  readonly payload: Record<string, unknown>;
}
interface Item {
  readonly id: string;
  readonly operation_id: string;
  readonly kind: string;
  readonly reason: "conflicted" | "rejected";
  readonly code: string;
  readonly detail: string;
  readonly device_id: string;
  readonly device_name: string;
  readonly received_at: string;
  readonly effect_minor: string;
  readonly members: readonly MemberView[];
  readonly reviewed_at: string;
  readonly decision: string;
  readonly decision_reason: string;
  readonly decided_by_name: string;
}
interface Confirmed {
  readonly kind: string;
  readonly device_name: string;
  readonly actor_name: string;
  readonly received_at: string;
  readonly members: readonly MemberView[];
}
interface Effect {
  readonly party_id?: string;
  readonly party_name?: string;
  readonly balance_now_minor?: string;
  readonly balance_if_accept_minor?: string;
  readonly balance_if_reject_minor?: string;
}
interface Detail {
  readonly item: Item;
  readonly confirmed: Confirmed | null;
  readonly effect: Effect;
  readonly acceptable: boolean;
  readonly is_owner: boolean;
}
interface ListData {
  readonly is_owner: boolean;
  readonly items: readonly Item[];
  readonly as_of: string;
}

export const REVIEW_CACHE = "ops.review_cache";

/** يُشكَّل من أعضاء النسخة ليوصف بلغة المحل كما في SYS-01/02. */
function asStored(kind: string, members: readonly MemberView[], id: string): StoredOperation {
  return {
    operationId: id,
    kind,
    opVersion: 1,
    dependencies: [],
    members: members.map((m) => ({ ...m, schemaVersion: 1, serverSeq: null })),
    state: "conflict",
    createdLocalSeq: 0,
    snapshotRelation: "none",
  };
}
const head = (members: readonly MemberView[], entity: string): Record<string, unknown> =>
  members.find((m) => m.entity === entity)?.payload ?? {};
const str = (v: unknown): string =>
  typeof v === "string" || typeof v === "number" ? String(v) : "";
const METHOD_LABEL: Record<string, string> = {
  cash: tx(T, "نقداً"),
  bank: tx(T, "تحويلاً بنكياً"),
  credit: tx(T, "آجلاً"),
};

/** نسخة (07-D3): «على الخادم — مؤكد» / «على هذا الجهاز — محجوز» بالمبلغ والوقت والمُدخِل. */
function VersionBlock({
  title,
  kind,
  members,
  at,
  actor,
  device,
  reserved,
}: {
  title: string;
  kind: string;
  members: readonly MemberView[];
  at: string;
  actor: string;
  device: string;
  reserved: boolean;
}) {
  const c = useColors();
  const d = describeOperation(asStored(kind, members, "x"));
  const h = head(members, "parties.PaymentReceipt");
  const amount = str(h["amount_minor"]) || str(head(members, "sales.Sale")["total_minor"]);
  const method = str(h["method"]);
  return (
    <View style={{ marginBottom: SPACE["3"] }}>
      <GroupedList title={title}>
        <Row
          title={d.title}
          trailing={<N>{d.number}</N>}
          detail={
            <>
              <AppText
                variant="note"
                style={{ color: reserved ? c.state.conflict.fg : c.state.synced.fg }}
              >
                {reserved ? tx(T, "محجوز") : tx(T, "مؤكد")}
              </AppText>
            </>
          }
        />
        {amount ? (
          <Row
            title={tx(T, "المبلغ")}
            trailing={
              <AppText>
                <N>{formatMinor(amount)}</N>
                {method ? ` ${METHOD_LABEL[method] ?? method}` : ""}
              </AppText>
            }
          />
        ) : null}
        <Row
          title={tx(T, "أُدخلت")}
          detail={
            <>
              {at ? (
                <>
                  <DayLabel iso={at} /> <N>{hhmm(at)}</N>
                </>
              ) : (
                "—"
              )}
              {actor ? ` · ${actor}` : ""}
              {device ? ` · ${device}` : ""}
            </>
          }
          last
        />
      </GroupedList>
      <AppText variant="note" muted>
        {d.effect}
      </AppText>
    </View>
  );
}

/**
 * SYS-03 — تعارض وحجر ومراجعة مالك (نظير `review-client.tsx`): النسختان معروضتان ولا نختار عنك؛ قبول
 * مخوَّل بسبب أو رفض بسبب — دون إعادة كتابة الأصل؛ المرفوض يبقى مقروءاً في السجل؛ لا تراجع؛ الحجز على
 * البند وحده والبيع يستمر؛ الترتيب بالأثر المالي. القائمة تُحفظ للعرض بلا اتصال، والقرار يحتاج الخادم.
 */
export function ReviewScreen({
  selectedId,
  operationId,
}: {
  selectedId: string;
  operationId: string;
}) {
  const router = useRouter();
  const { api } = useSession();
  const ctx = useShiftContext();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [decided, setDecided] = useState<{
    decision: "accept" | "reject";
    balanceAfter: string | null;
    item: Item;
  } | null>(null);

  const loadList = useCallback(
    () => call<ListData>(() => api.GET("/api/sync/quarantine", {})),
    [api],
  );
  const {
    p: list,
    failed: listFailed,
    data: listLive,
    reload,
  } = useCachedGet<ListData>({
    cacheKey: REVIEW_CACHE,
    load: loadList,
  });

  const id =
    selectedId ||
    (operationId ? (list?.items.find((i) => i.operation_id === operationId)?.id ?? "") : "");

  useEffect(() => {
    if (!id) {
      setDetail(null);
      return;
    }
    void (async () => {
      const r = await call<Detail>(() =>
        api.GET("/api/sync/quarantine/{item_id}", { params: { path: { item_id: id } } }),
      );
      setDetail(r.ok && r.data ? r.data : null);
    })();
  }, [api, id]);

  const isOwner = detail?.is_owner ?? list?.is_owner ?? ctx?.roleCode === "owner";
  const state: State = decided
    ? "success"
    : detail
      ? isOwner
        ? "conflict"
        : "permission_denied"
      : !list && listFailed
        ? "offline"
        : listFailed && listLive === null
          ? "stale"
          : "ready";

  const decide = async (decision: "accept" | "reject") => {
    if (!detail || busy) return;
    setAttempted(true);
    if (!reason.trim()) return;
    setBusy(true);
    try {
      const r = await call<{ item: Item; applied: { balance_after_minor?: string } }>(() =>
        api.POST("/api/sync/quarantine/{item_id}/decide", {
          params: { path: { item_id: detail.item.id } },
          body: { decision, reason: reason.trim() },
        }),
      );
      if (!r.ok || !r.data) {
        setFailed(r.offline ? "server_error" : detailOf(r.error) || "server_error");
        return;
      }
      setDecided({
        decision,
        balanceAfter: r.data.applied.balance_after_minor ?? null,
        item: r.data.item,
      });
      void reload();
    } finally {
      setBusy(false);
    }
  };

  const items = list?.items ?? [];
  const e = detail?.effect ?? {};
  const item = detail?.item;
  const confirmedHead = detail?.confirmed
    ? head(detail.confirmed.members, "parties.PaymentReceipt")
    : {};
  const deviceHead = item ? head(item.members, "parties.PaymentReceipt") : {};
  const sameNumber =
    Boolean(str(confirmedHead["receipt_number"])) &&
    str(confirmedHead["receipt_number"]) === str(deviceHead["receipt_number"]);
  const partyFirst = (e.party_name ?? "").split(" ")[0] ?? "";
  const back = () => {
    setDecided(null);
    setDetail(null);
    setReason("");
    setAttempted(false);
    router.replace("/sync/review");
  };

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "مركز الاتصال والمزامنة")}
      onRefresh={() => void reload()}
    >
      <AppText variant="section">{tx(T, "تعارض وحجر ومراجعة المالك")}</AppText>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "قبول مخوَّل أو رفض بسبب — دون إعادة كتابة الأصل.")}
      </AppText>

      {state === "offline" ? (
        <StateView state="offline" title={tx(T, "تعذّر جلب القائمة من الخادم.")}>
          <AppText variant="secondary">{OPS.offlineNone}</AppText>
        </StateView>
      ) : null}
      {state === "stale" ? (
        <StateView state="stale" title={tx(T, "تعذّر جلب القائمة من الخادم.")}>
          <AppText variant="secondary">{OPS.offlineCached}</AppText>
        </StateView>
      ) : null}

      {state === "ready" || state === "stale" ? (
        <>
          <StateView
            state={items.length ? "conflict" : "success"}
            title={
              items.length ? `${items.length} ${tx(T, "بنود محجوزة")}` : tx(T, "لا بنود محجوزة")
            }
          >
            <AppText variant="secondary">
              {tx(
                T,
                "قائمة ما ينتظر قرارك، مرتّبةً بالأثر المالي لا بالتاريخ: تعارض على رصيد صنفٍ ثم على سعر ثم على بيانات طرف.",
              )}
            </AppText>
            <AppText variant="note">
              <Strong>{tx(T, "ما لا يُحجز")}</Strong>{" "}
              {tx(T, "· التعارضات التي يحسمها النظام بأمان (طابعٌ مختلف لنفس القيمة) لا تصل هنا.")}
            </AppText>
          </StateView>
          {items.length ? (
            <GroupedList title={tx(T, "البنود المحجوزة")}>
              {items.map((i, idx) => {
                const d = describeOperation(asStored(i.kind, i.members, i.operation_id));
                return (
                  <Row
                    key={i.id}
                    title={
                      <AppText>
                        {d.title}
                        {d.number ? (
                          <>
                            {" "}
                            <N>{d.number}</N>
                          </>
                        ) : null}
                      </AppText>
                    }
                    detail={
                      <>
                        {i.device_name || tx(T, "جهاز")} · <DayLabel iso={i.received_at} />{" "}
                        <N>{hhmm(i.received_at)}</N>
                        {"\n"}
                        {tx(T, "الأثر المالي")} <N>{formatMinor(i.effect_minor)}</N>
                      </>
                    }
                    trailing={<ReasonWord reason={i.reason} />}
                    onPress={() => router.push({ pathname: "/sync/review", params: { id: i.id } })}
                    last={idx === items.length - 1}
                  />
                );
              })}
            </GroupedList>
          ) : null}
          <AppText variant="note" muted>
            {tx(T, "العمل لا يتوقف على المحجوز: البيع يستمر والحجز على البند وحده.")}
          </AppText>
        </>
      ) : null}

      {(state === "conflict" || state === "permission_denied") && item ? (
        <>
          <StateView state="conflict" title={tx(T, "عملية محجوزة تحتاج قرارك")}>
            <AppText variant="secondary">
              {item.reason === "conflicted" ? (
                <>
                  {tx(T, "رفض الخادم عملية")}{" "}
                  {describeOperation(asStored(item.kind, item.members, item.operation_id)).title}{" "}
                  {tx(T, "بسبب تعارض")}
                  {sameNumber ? ` ${tx(T, "في المبلغ")}` : ""}
                  {tx(T, ". لم يُكتب فوق أي مستند")}
                  {e.party_name ? (
                    <>
                      {tx(T, "، وحساب")} {e.party_name}{" "}
                      {tx(T, "وحده معلَّق — بقية العملاء يزامنون طبيعياً.")}
                    </>
                  ) : (
                    "."
                  )}
                </>
              ) : (
                <>
                  {tx(T, "رفض الخادم العملية:")} <N>{item.code}</N>
                  {item.detail ? ` — ${item.detail}` : ""}
                  {tx(T, ". لم يُكتب فوق أي مستند.")}
                </>
              )}
            </AppText>
          </StateView>
          {detail?.confirmed ? (
            <VersionBlock
              title={tx(T, "على الخادم — مؤكد")}
              kind={detail.confirmed.kind}
              members={detail.confirmed.members}
              at={detail.confirmed.received_at}
              actor={detail.confirmed.actor_name}
              device={detail.confirmed.device_name}
              reserved={false}
            />
          ) : null}
          <VersionBlock
            title={tx(T, "على هذا الجهاز — محجوز")}
            kind={item.kind}
            members={item.members}
            at={item.received_at}
            actor=""
            device={item.device_name}
            reserved
          />
          {sameNumber ? (
            <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
              {tx(T, "نفس رقم المستند بمبلغين مختلفين — غالباً سُجّل السداد على جهازين بقيمتين.")}
            </AppText>
          ) : null}
          {e.balance_if_accept_minor && e.balance_if_reject_minor ? (
            <AppText style={{ marginBottom: SPACE["3"] }}>
              {tx(T, "الأثر على الرصيد: بالقبول يصبح رصيد")} {partyFirst}{" "}
              <N>{formatMinor(e.balance_if_accept_minor)}</N>
              {tx(T, "، وبالرفض يبقى")} <N>{formatMinor(e.balance_if_reject_minor)}</N>
              {tx(T, ". راجع الإيصال الورقي قبل أن تقرّر.")}
            </AppText>
          ) : null}

          {state === "conflict" ? (
            <View style={{ gap: SPACE["2"] }}>
              <TextField
                label={tx(T, "سبب القرار")}
                value={reason}
                onChangeText={setReason}
                required
                error={attempted && !reason.trim() ? tx(T, "سبب القرار") : undefined}
              />
              {failed && failed !== "list" ? (
                <StateView state="server_error" title={tx(T, "لم يُسجَّل القرار")}>
                  <AppText variant="secondary">
                    {failed === "manual_merge_required"
                      ? tx(T, "هذا التعارض يحتاج دمجاً يدوياً — غير مبني بعد.")
                      : failed === "already_decided"
                        ? tx(T, "حُسم هذا البند سلفاً — لا تراجع.")
                        : tx(T, "الخادم لم يقبل القرار.")}
                  </AppText>
                </StateView>
              ) : null}
              <Button
                financial
                label={tx(T, "قبول نسخة الجهاز بسبب")}
                loading={busy}
                onPress={() => void decide("accept")}
                disabledReason={
                  detail?.acceptable
                    ? undefined
                    : tx(T, "الدمج اليدوي غير مبني — القبول لتعارض سداد مؤكد")
                }
              />
              <Button
                variant="secondary"
                label={tx(T, "رفض والإبقاء على المؤكد")}
                loading={busy}
                onPress={() => void decide("reject")}
              />
              <Button
                variant="quiet"
                label={tx(T, "فتح الدمج اليدوي")}
                onPress={() => undefined}
                disabledReason={tx(T, "الدمج حقلاً حقلاً غير مبني")}
              />
              <AppText variant="note" muted>
                {tx(
                  T,
                  "القرار يتطلب صلاحية المالك، ويُسجَّل في سجل التدقيق باسمك وسببك ووقته. المستندان يبقيان مقروءين بعده.",
                )}
              </AppText>
            </View>
          ) : (
            <StateView state="permission_denied" title={tx(T, "حسم التعارض صلاحية مالك")}>
              <AppText variant="secondary">
                {tx(T, "حسم التعارض صلاحية مالك. الكاشير يرى التعارض ويُبلّغ عنه ولا يحسمه.")}
              </AppText>
              <AppText variant="note">
                {tx(T, "النسختان محفوظتان كلتاهما. لا شيء ضاع، ولا شيء يُطبَّق حتى تقرّر.")}
              </AppText>
            </StateView>
          )}
          <Button variant="quiet" label={tx(T, "البنود المحجوزة")} onPress={back} />
        </>
      ) : null}

      {state === "success" && decided ? (
        <>
          <StateView state="success" title={tx(T, "حُسم التعارض")}>
            <AppText variant="secondary">
              {decided.decision === "accept" ? (
                <>
                  {tx(T, "اختار المالك نسخة الجهاز")}
                  {decided.balanceAfter ? (
                    <>
                      {tx(T, ". الرصيد صار")} <N>{formatMinor(decided.balanceAfter)}</N>
                    </>
                  ) : null}
                  {tx(T, "، والنسخة الأخرى محفوظة في السجل لا ممحوّة.")}
                </>
              ) : (
                <>
                  {tx(T, "أبقى المالك النسخة المؤكدة")}
                  {e.balance_if_reject_minor ? (
                    <>
                      {tx(T, ". الرصيد يبقى")} <N>{formatMinor(e.balance_if_reject_minor)}</N>
                    </>
                  ) : null}
                  {tx(T, "، والنسخة المرفوضة محفوظة في السجل لا ممحوّة.")}
                </>
              )}
            </AppText>
            <AppText variant="note">
              <Strong>{tx(T, "المرفوض يبقى")}</Strong>{" "}
              {tx(T, "· النسخة غير المختارة تبقى مقروءة في سجل التدقيق باسم من أدخلها.")}
            </AppText>
            <AppText variant="note">
              <Strong>{tx(T, "لا تراجع")}</Strong>{" "}
              {tx(
                T,
                "· الحسم نهائي. التصحيح بقرارٍ جديد يشير إليه — لا بتراجعٍ يمحو أن قراراً اتُّخذ.",
              )}
            </AppText>
          </StateView>
          <GroupedList>
            <Row
              title={tx(T, "القرار")}
              detail={
                decided.decision === "accept"
                  ? tx(T, "قبول نسخة الجهاز")
                  : tx(T, "رفض والإبقاء على المؤكد")
              }
            />
            <Row title={tx(T, "السبب")} detail={decided.item.decision_reason} />
            <Row title={tx(T, "باسم")} detail={decided.item.decided_by_name} last />
          </GroupedList>
          <Button label={tx(T, "البنود المحجوزة")} onPress={back} />
        </>
      ) : null}
    </Screen>
  );
}

function ReasonWord({ reason }: { reason: Item["reason"] }) {
  const c = useColors();
  return reason === "conflicted" ? (
    <AppText variant="note" style={{ color: c.state.conflict.fg }}>
      {tx(T, "تعارض")}
    </AppText>
  ) : (
    <AppText variant="note" style={{ color: c.state.server_error.fg }}>
      {tx(T, "مرفوضة")}
    </AppText>
  );
}

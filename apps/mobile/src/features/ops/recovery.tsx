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

const T = "SYS-07";
type State =
  "ready" | "permission_denied" | "pending_sync" | "conflict" | "success" | "stale" | "offline";

interface HeldItem {
  readonly id: string;
  readonly operation_id: string;
  readonly kind: string;
  readonly members: readonly { entity: string; id: string; payload: Record<string, unknown> }[];
  readonly received_at: string;
  readonly effect_minor: string;
}
interface DeviceRow {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly branch_name: string;
  readonly status: "revoked" | "frozen" | "wiped" | "active";
  readonly revoked_at: string;
  readonly frozen_at: string;
  readonly wiped_at: string;
  readonly held_count: number;
  readonly held_value_minor: string;
  readonly reported_pending: number;
  readonly reported_pending_at: string;
  readonly last_seen_at: string;
  readonly actor_names: readonly string[];
  readonly items?: readonly HeldItem[];
}
interface ListData {
  readonly is_owner: boolean;
  readonly devices: readonly DeviceRow[];
}
interface RestoreResult {
  readonly device_id: string;
  readonly status: string;
  readonly restored: number;
  readonly duplicate: number;
  readonly conflicted: number;
  readonly rejected: number;
}

export const RECOVERY_CACHE = "ops.recovery_cache";

const STATUS_LABEL: Record<DeviceRow["status"], string> = {
  revoked: tx(T, "مسحوب"),
  frozen: tx(T, "مجمَّد"),
  wiped: tx(T, "ممحو"),
  active: tx(T, "فعّال"),
};

function asStored(i: HeldItem): StoredOperation {
  return {
    operationId: i.operation_id,
    kind: i.kind,
    opVersion: 1,
    dependencies: [],
    members: i.members.map((m) => ({ ...m, schemaVersion: 1, serverSeq: null })),
    state: "quarantined",
    createdLocalSeq: 0,
    snapshotRelation: "none",
  };
}

/**
 * SYS-07 — استرداد جهاز مسحوب (نظير `recovery-client.tsx`): السحب قرار إداري والعمل أمانة مال — والشاشة
 * تفصل بينهما. الاسترداد للمالك بتفصيله؛ المدير يرى العدد والقيمة بلا تفصيل؛ لا ترجيح تلقائي عند
 * التعارض (SYS-03)؛ الجهاز يبقى مسحوباً بعد الاسترداد؛ لا محو قبل إنقاذ المعلّق: تجميد فوري أو محو بعد
 * إقرار مكتوب.
 */
export function RecoveryScreen({ selectedId }: { selectedId: string }) {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const ctx = useShiftContext();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [ack, setAck] = useState("");
  const [ackAttempted, setAckAttempted] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [pick, setPick] = useState(selectedId);

  const load = useCallback(() => call<ListData>(() => api.GET("/api/sync/recovery", {})), [api]);
  const {
    p: data,
    failed: listFailed,
    data: live,
    reload,
  } = useCachedGet<ListData>({
    cacheKey: RECOVERY_CACHE,
    load,
  });
  useEffect(() => setPick(selectedId), [selectedId]);

  const isOwner = data?.is_owner ?? ctx?.roleCode === "owner";
  const devices = data?.devices ?? [];
  const selected = devices.find((d) => d.id === pick) ?? devices[0] ?? null;
  const pendingOnly = Boolean(
    selected &&
    selected.held_count === 0 &&
    selected.reported_pending > 0 &&
    selected.status !== "wiped",
  );

  const state: State = result
    ? result.conflicted > 0 || result.rejected > 0
      ? "conflict"
      : "success"
    : !data && listFailed
      ? "offline"
      : data && !isOwner
        ? "permission_denied"
        : pendingOnly
          ? "pending_sync"
          : listFailed && live === null
            ? "stale"
            : "ready";

  const act = async (action: "restore" | "freeze" | "wipe") => {
    if (!selected || busy) return;
    if (action === "wipe") {
      setAckAttempted(true);
      if (!ack.trim()) return;
    }
    setBusy(true);
    setFailed(null);
    try {
      const r = await call<RestoreResult>(() =>
        api.POST("/api/sync/recovery/{device_id}/{action}", {
          params: { path: { device_id: selected.id, action } },
          body: action === "wipe" ? { acknowledgement: ack.trim() } : {},
        }),
      );
      if (!r.ok) {
        setFailed(r.offline ? "server_error" : detailOf(r.error) || "server_error");
        return;
      }
      if (action === "restore" && r.data) setResult(r.data);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const items = selected?.items ?? [];
  const tone = (d: DeviceRow) => (d.status === "wiped" ? c.state.empty.fg : c.state.conflict.fg);

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "مركز الاتصال والمزامنة")}
      onRefresh={() => void reload()}
    >
      <AppText variant="section">{tx(T, "استرداد جهاز مسحوب")}</AppText>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "جهاز سُحب وصوله وعليه عمل لم يُرفع.")}
      </AppText>

      {state === "offline" ? (
        <StateView state="offline" title={tx(T, "استرداد جهاز مسحوب")}>
          <AppText variant="secondary">{OPS.offlineNone}</AppText>
        </StateView>
      ) : null}
      {state === "stale" ? (
        <StateView state="stale" title={tx(T, "استرداد جهاز مسحوب")}>
          <AppText variant="secondary">{OPS.offlineCached}</AppText>
        </StateView>
      ) : null}

      {devices.length > 1 ? (
        <GroupedList title={tx(T, "الأجهزة")}>
          {devices.map((d, i) => (
            <Row
              key={d.id}
              title={
                <AppText>
                  {d.name} · <N>{d.prefix}</N>
                </AppText>
              }
              trailing={
                <View style={{ alignItems: "flex-end" }}>
                  <AppText variant="note" style={{ color: tone(d) }}>
                    {STATUS_LABEL[d.status]}
                  </AppText>
                  <N>{d.held_count}</N>
                </View>
              }
              onPress={() => setPick(d.id)}
              last={i === devices.length - 1}
            />
          ))}
        </GroupedList>
      ) : null}

      {!selected && data ? (
        <StateView state="empty" title={tx(T, "لا أجهزة مسحوبة عليها عمل")}>
          <AppText variant="secondary">{tx(T, "كل الأجهزة فعّالة أو سُوّي ما عليها.")}</AppText>
        </StateView>
      ) : null}

      {state === "success" && result ? (
        <StateView state="success" title={tx(T, "استُرد العمل")}>
          <AppText variant="secondary">
            <N>{result.restored}</N>{" "}
            {tx(
              T,
              "عمليات دخلت الدفتر منسوبةً إلى من أنشأها لا إلى من استردّها — والفرق بينهما مسجّل في السجل.",
            )}
          </AppText>
          <AppText variant="note">
            <Strong>{tx(T, "والجهاز")}</Strong> {tx(T, "· يبقى مسحوباً.")}
          </AppText>
          {result.duplicate > 0 ? (
            <AppText variant="note">
              <N>{result.duplicate}</N> {tx(T, "كانت عند الخادم سلفاً — لم تُحسب مرتين.")}
            </AppText>
          ) : null}
        </StateView>
      ) : null}

      {state === "conflict" && result ? (
        <StateView state="conflict" title={tx(T, "عملٌ مسترد يعارض ما وقع بعده")}>
          <AppText variant="secondary">
            {tx(T, "دخل")} <N>{result.restored}</N> {tx(T, "· تعارض")} <N>{result.conflicted}</N>{" "}
            {tx(T, "· رُفض")} <N>{result.rejected}</N>
            {tx(T, ". الجهاز المسحوب باع، وجهازٌ آخر باع بعد السحب — القطع واحدة والمبيع مرتان.")}
          </AppText>
          <AppText variant="note">
            <Strong>{tx(T, "لا ترجيح تلقائي")}</Strong>{" "}
            {tx(
              T,
              "· لا الأقدم ولا الأحدث. البيعان وقعا فعلاً ونقدهما في درجين مختلفين. يُحال إلى «مراجعة التعارضات» بالنسختين.",
            )}
          </AppText>
          <Button label={tx(T, "مراجعة المالك")} onPress={() => router.push("/sync/review")} />
        </StateView>
      ) : null}

      {selected ? (
        <>
          <GroupedList>
            <Row
              title={tx(T, "الجهاز")}
              detail={
                <>
                  {selected.name} · <N>{selected.prefix}</N> · {selected.branch_name}
                </>
              }
            />
            <Row
              title={tx(T, "الحالة")}
              trailing={
                <AppText variant="note" style={{ color: tone(selected) }}>
                  {STATUS_LABEL[selected.status]}
                </AppText>
              }
            />
            <Row
              title={tx(T, "ما على الجهاز المسحوب")}
              detail={
                <>
                  <N>{selected.held_count}</N> {tx(T, "عمليات بـ")}
                  <N>{formatMinor(selected.held_value_minor)}</N>
                  {selected.reported_pending > selected.held_count ? (
                    <>
                      {" "}
                      {tx(T, "· لم تصل بعد")} <N>{selected.reported_pending}</N>
                    </>
                  ) : null}
                </>
              }
            />
            <Row
              title={tx(T, "آخر نشاط")}
              detail={
                <>
                  {selected.last_seen_at ? (
                    <>
                      <DayLabel iso={selected.last_seen_at} /> <N>{hhmm(selected.last_seen_at)}</N>
                    </>
                  ) : (
                    "—"
                  )}
                  {selected.actor_names.length
                    ? ` · ${selected.actor_names.join(tx(T, "،") + " ")}`
                    : ""}
                </>
              }
              last
            />
          </GroupedList>

          {state === "permission_denied" ? (
            <StateView state="permission_denied" title={tx(T, "الاسترداد للمالك")}>
              <AppText variant="secondary">
                {tx(
                  T,
                  "مدير الفرع سحب الجهاز ولا يسترد عمله: الاسترداد يقرأ عمليات موظف آخر بتفصيلها.",
                )}
              </AppText>
              <AppText variant="note">
                <Strong>{tx(T, "ما يراه المدير")}</Strong>{" "}
                {tx(T, "· العدد والقيمة الإجمالية بلا تفصيل.")}
              </AppText>
            </StateView>
          ) : null}

          {state === "pending_sync" ? (
            <StateView state="pending_sync" title={tx(T, "خطر فقد")}>
              <AppText variant="secondary">
                {tx(T, "على الجهاز")} <N>{selected.reported_pending}</N>{" "}
                {tx(T, "عمليات لم تصل. محوها الآن يعني أن بضاعة خرجت من مخزنك بلا قيد.")}
              </AppText>
              <AppText variant="note">
                {tx(
                  T,
                  "التجميد يمنع أي بيع جديد فوراً ويُبقي المعلّق قابلاً للرفع لو عاد الجهاز للشبكة. المحو متاح بعد إقرار مكتوب بفقد العمليات.",
                )}
              </AppText>
              <AppText variant="note">
                {tx(T, "يُجمَّد الجهاز فوراً: لا بيع جديد، لا وصول للبيانات، والمحفوظ باقٍ.")}
              </AppText>
              <AppText variant="note">
                {tx(
                  T,
                  "المحو يحتاج إقراراً مكتوباً باسم المالك بأن العمليات تُعدّ مفقودة، ويُسجَّل الإقرار في سجل التدقيق.",
                )}
              </AppText>
              <TextField
                label={tx(T, "إقرار مكتوب بفقد المعلّق")}
                value={ack}
                onChangeText={setAck}
                error={ackAttempted && !ack.trim() ? tx(T, "الإقرار إلزامي قبل المحو") : undefined}
              />
              <Button
                label={tx(T, "تجميد الجهاز الآن")}
                loading={busy}
                onPress={() => void act("freeze")}
                disabledReason={selected.status === "frozen" ? tx(T, "مجمَّد سلفاً") : undefined}
              />
              <Button
                variant="secondary"
                financial
                label={tx(T, "محو — بعد الإقرار")}
                loading={busy}
                onPress={() => void act("wipe")}
              />
            </StateView>
          ) : null}

          {state === "ready" && selected.held_count > 0 ? (
            <>
              <GroupedList title={tx(T, "ما على الجهاز المسحوب")}>
                {items.map((i, idx) => {
                  const d = describeOperation(asStored(i));
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
                      detail={d.effect}
                      trailing={<N>{formatMinor(i.effect_minor)}</N>}
                      last={idx === items.length - 1}
                    />
                  );
                })}
              </GroupedList>
              <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
                <Strong>{tx(T, "السحب قائم")}</Strong>{" "}
                {tx(
                  T,
                  "· الجهاز لا يستعيد وصوله بهذا. الاسترداد يسحب العمل ولا يُعيد الصلاحية — فعلان منفصلان.",
                )}
              </AppText>
              {failed ? (
                <StateView state="server_error" title={tx(T, "لم يُنفَّذ")}>
                  <AppText variant="secondary">
                    {failed === "acknowledgement_required"
                      ? tx(T, "المحو يحتاج إقراراً مكتوباً.")
                      : tx(T, "الخادم لم يقبل الطلب.")}
                  </AppText>
                </StateView>
              ) : null}
              <Button
                financial
                label={tx(T, "استرداد العمل إلى الدفتر")}
                loading={busy}
                onPress={() => void act("restore")}
              />
            </>
          ) : null}
          {state === "ready" && selected.held_count === 0 && selected.reported_pending === 0 ? (
            <AppText variant="note" muted>
              {tx(T, "لا عمل محجوزاً على هذا الجهاز.")}
            </AppText>
          ) : null}
        </>
      ) : null}
      <View style={{ marginTop: SPACE["3"] }}>
        <Button
          variant="quiet"
          label={tx(T, "مركز المزامنة")}
          onPress={() => router.push("/sync")}
        />
      </View>
    </Screen>
  );
}

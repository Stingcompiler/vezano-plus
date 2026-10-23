import type { StoredOperation } from "@sting/platform";
import {
  checkReach,
  hhmm,
  readHalted,
  readLastOk,
  readLastPush,
  reconcileNow,
} from "@sting/app-core";
import { describeOperation, readAttempts, readVerifiers, savedAt } from "@sting/sync-core";
import { tx } from "@sting/texts";
import type { StateCode } from "@sting/design";
import {
  AppText,
  Button,
  FONT,
  GroupedList,
  ListRow,
  Screen,
  SPACE,
  StateView,
  useColors,
  ThemedText as Text,
} from "@sting/ui-native";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { Ago, supportLine } from "@/lib/ago";
import { newId } from "@/lib/crypto";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "SYS-01";
/** آخر مطابقة ناجحة أقدم من هذا = «قديمة» وإن كان الطابور فارغاً (07-D3 stale) — كالويب. */
const STALE_MS = 60 * 60_000;
const RECENT_LIMIT = 20;

type State = "ready" | "pending_sync" | "synced" | "stale" | "server_error" | "offline";

interface Row {
  readonly op: StoredOperation;
  readonly title: string;
  readonly number: string;
  readonly effect: string;
  readonly savedAt: string | null;
  readonly code: string;
}

const STATE_LABEL: Record<StoredOperation["state"], string> = {
  local: tx(T, "محفوظ محلياً"),
  pending: tx(T, "قيد الرفع"),
  synced: tx(T, "مؤكد اليوم"),
  conflict: tx(T, "محجوز للمراجعة"),
  quarantined: tx(T, "متعثّرة"),
};
const STATE_TONE: Record<StoredOperation["state"], StateCode> = {
  local: "saved_local",
  pending: "pending_sync",
  synced: "synced",
  conflict: "conflict",
  quarantined: "server_error",
};

function N({ children }: { children: string | number }) {
  return <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>{String(children)}</Text>;
}

/**
 * SYS-01 — مركز الاتصال والمزامنة على الجوال (خطة الجوال M1؛ 0005 §١٧٥). نفس محرّك الويب من
 * `@sting/app-core` (رفع، وقوف بعد ثلاث، فحص وصول): الجواب أولاً بجملة — هل عملي وصل؟ — ثم المعلّق
 * والمحجوز صفوفاً بكلمة حالتها، ثم آخر ما رُفع. «هناك شبكة» ≠ «نجح الوصول»: الحالة من ردّ الخادم.
 */
export default function Sync() {
  const { api } = useSession();
  const c = useColors();
  const [rows, setRows] = useState<Row[]>([]);
  const [lastOk, setLastOk] = useState<string | null>(null);
  const [halted, setHalted] = useState<string | null>(null);
  const [lastStatus, setLastStatus] = useState<number | undefined>(undefined);
  const [prefix, setPrefix] = useState<string | null>(null);
  const [reached, setReached] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [justSynced, setJustSynced] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const storage = await getStorage();
    const ops = await storage.read(async (t) => [
      ...(await t.listOperationsByState("local")),
      ...(await t.listOperationsByState("pending")),
      ...(await t.listOperationsByState("conflict")),
      ...(await t.listOperationsByState("quarantined")),
      ...(await t.listOperationsByState("synced")),
    ]);
    const open = ops
      .filter((o) => o.state !== "synced")
      .sort((a, b) => a.createdLocalSeq - b.createdLocalSeq);
    const recent = ops
      .filter((o) => o.state === "synced")
      .sort((a, b) => b.createdLocalSeq - a.createdLocalSeq)
      .slice(0, RECENT_LIMIT);
    const out: Row[] = [];
    for (const op of [...open, ...recent]) {
      const attempts = await readAttempts(storage, op.operationId);
      const last = [...attempts].reverse().find((a) => a.event !== "saved" && a.event !== "sent");
      const d = describeOperation(op);
      out.push({
        op,
        ...d,
        savedAt: savedAt(attempts),
        code: last?.code ?? (last?.status ? String(last.status) : ""),
      });
    }
    setRows(out);
    setLastOk(await readLastOk(storage));
    setHalted(await readHalted(storage));
    setLastStatus((await readLastPush(storage))?.status);
    setPrefix((await readVerifiers(storage))?.prefix ?? null);
  }, []);

  const probe = useCallback(async () => {
    const storage = await getStorage();
    setReached((await checkReach(api, storage)) !== null);
    await load();
  }, [api, load]);

  useEffect(() => {
    void load().then(probe);
  }, [load, probe]);

  const pendingRows = rows.filter((r) => r.op.state === "local" || r.op.state === "pending");
  const conflictRows = rows.filter((r) => r.op.state === "conflict");
  const quarantinedRows = rows.filter((r) => r.op.state === "quarantined");
  const openRows = rows.filter((r) => r.op.state !== "synced");
  const recentRows = rows.filter((r) => r.op.state === "synced");
  const pending = pendingRows.length;
  const stale = !lastOk || Date.now() - new Date(lastOk).getTime() > STALE_MS;

  const state: State =
    reached === false && !halted
      ? "offline"
      : halted
        ? "server_error"
        : pending > 0
          ? "pending_sync"
          : justSynced > 0
            ? "synced"
            : reached && stale
              ? "stale"
              : "ready";

  const syncNow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const storage = await getStorage();
      const { synced, reach } = await reconcileNow({ api, storage, requestId: newId });
      setReached(reach !== null);
      setJustSynced(synced);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await probe();
    } finally {
      setRefreshing(false);
    }
  };

  const action = (r: Row) =>
    r.op.state === "conflict"
      ? tx(T, "يحتاج قرارك")
      : r.op.state === "quarantined"
        ? tx(T, "خطأ خادم")
        : r.op.state === "synced"
          ? tx(T, "وصل الخادم")
          : halted
            ? tx(T, "بانتظار محاولة يدوية")
            : tx(T, "يُرفع تلقائياً");

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "مركز الاتصال والمزامنة")}
      onRefresh={() => void refresh()}
      refreshing={refreshing}
    >
      {state === "offline" ? (
        <StateView state="offline" title={tx(T, "بلا اتصال — البيع يعمل")}>
          <AppText variant="secondary">
            {tx(T, "كل ما تبيعه الآن محفوظ على هذا الجهاز ويُرفع عند عودة الشبكة.")}
          </AppText>
          <AppText variant="note">
            <N>{pending}</N> {tx(T, "عمليات معلّقة")}
            {lastOk ? (
              <>
                {" "}
                {tx(T, "· آخر اتصال ناجح قبل")} <Ago iso={lastOk} />
              </>
            ) : null}
          </AppText>
        </StateView>
      ) : null}

      {state === "server_error" ? (
        <StateView state="server_error" title={tx(T, "الخادم يرفض الطابور")}>
          <AppText variant="secondary">
            {tx(
              T,
              "الشبكة تعمل والخادم يردّ بخطأ. ثلاث محاولات متباعدة ثم وقوف — والطابور محفوظ كما هو.",
            )}
          </AppText>
          <AppText variant="note">
            <Text style={{ fontFamily: FONT.bold }}>{tx(T, "البيع مستمر")}</Text>{" "}
            {tx(T, "· POS لا يتوقف. الطابور يكبر ويُعرض عدده، والعمل لا ينقطع لأن خادماً تعثّر.")}
          </AppText>
          <N>{supportLine({ status: lastStatus, devicePrefix: prefix })}</N>
        </StateView>
      ) : null}

      {state === "pending_sync" ? (
        <StateView state="pending_sync" title={tx(T, "معلّق")}>
          <AppText variant="secondary">
            <N>{pending}</N> {tx(T, "عمليات معلّقة")}
          </AppText>
          <AppText variant="note">
            {lastOk ? (
              <>
                {tx(T, "آخر اتصال ناجح قبل")} <Ago iso={lastOk} />
              </>
            ) : (
              tx(T, "لم يصل الخادم من هذا الجهاز بعد")
            )}
          </AppText>
        </StateView>
      ) : null}

      {state === "synced" ? (
        <StateView state="synced" title={tx(T, "اكتمل الرفع الآن")}>
          <AppText variant="secondary">
            {tx(T, "رُفعت")} <N>{justSynced}</N> {tx(T, "عملية")}
          </AppText>
        </StateView>
      ) : null}

      {state === "stale" ? (
        <StateView state="stale" title={tx(T, "آخر مطابقة قديمة")}>
          <AppText variant="secondary">
            {tx(T, "لا شيء في الطابور والاتصال قائم، لكن آخر مطابقة ناجحة")}{" "}
            {lastOk ? (
              <>
                {tx(T, "قبل")} <Ago iso={lastOk} />
              </>
            ) : (
              tx(T, "لم تحدث بعد")
            )}
            {tx(T, ". لا معلّق عندك ولا تأكيد أن ما عند الخادم وصلك.")}
          </AppText>
          <Button label={tx(T, "طابق الآن")} onPress={() => void syncNow()} loading={busy} />
        </StateView>
      ) : null}

      {state === "ready" ? (
        <StateView state="ready" title={tx(T, "كل عملك وصل")}>
          <AppText variant="secondary">
            {lastOk ? (
              <>
                {tx(T, "آخر مطابقة قبل")} <Ago iso={lastOk} />
              </>
            ) : (
              tx(T, "لا مطابقة بعد")
            )}{" "}
            {tx(T, "· لا شيء في الطابور")}
          </AppText>
        </StateView>
      ) : null}

      <View style={{ marginBottom: SPACE["4"] }}>
        <Button
          label={tx(T, "محاولة رفع الآن")}
          onPress={() => void syncNow()}
          loading={busy}
          disabledReason={
            state === "offline" ? tx(T, "بلا اتصال — يُرفع عند عودة الشبكة") : undefined
          }
        />
      </View>

      {openRows.length > 0 ? (
        <GroupedList title={tx(T, "المعلّق والمحجوز")}>
          {openRows.map((r, i) => (
            <ListRow
              key={r.op.operationId}
              title={r.number ? `${r.title} ${r.number}` : r.title}
              subtitle={`${r.effect} · ${action(r)}${r.code ? ` ${r.code}` : ""}`}
              trailing={
                <AppText variant="note" style={{ color: c.state[STATE_TONE[r.op.state]].fg }}>
                  {STATE_LABEL[r.op.state]}
                </AppText>
              }
              last={i === openRows.length - 1}
            />
          ))}
        </GroupedList>
      ) : null}
      {conflictRows.length + quarantinedRows.length > 0 ? (
        <AppText variant="note" muted style={{ marginBottom: SPACE["4"] }}>
          <N>{conflictRows.length}</N> {tx(T, "محجوز للمراجعة ·")} <N>{quarantinedRows.length}</N>{" "}
          {tx(T, "خطأ خادم")}
        </AppText>
      ) : null}

      <GroupedList title={tx(T, "آخر ما رُفع")}>
        {recentRows.length === 0 ? (
          <ListRow title={tx(T, "لم يُرفع شيء من هذا الجهاز بعد.")} last />
        ) : (
          recentRows.map((r, i) => (
            <ListRow
              key={r.op.operationId}
              title={r.number ? `${r.title} ${r.number}` : r.title}
              trailing={
                <View style={{ alignItems: "flex-end" }}>
                  <AppText variant="note" style={{ color: c.state.synced.fg }}>
                    {tx(T, "مؤكد")}
                  </AppText>
                  <N>{r.savedAt ? hhmm(r.savedAt) : "—"}</N>
                </View>
              }
              last={i === recentRows.length - 1}
            />
          ))
        )}
      </GroupedList>

      <AppText variant="note" muted>
        {tx(T, "معرّفات الدعم مثل")} <N>ERR-SYNC-0112</N>{" "}
        {tx(T, "للفريق التقني ولا تحتوي بيانات عملاء. لا يُعرض عليك JSON ولا رسائل خادم خام.")}
      </AppText>
    </Screen>
  );
}

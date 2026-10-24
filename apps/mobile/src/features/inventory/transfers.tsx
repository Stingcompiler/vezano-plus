import { formatQty, hhmm } from "@sting/app-core";
import {
  type LocalTransfer,
  readLocalTransfers,
  readStockCache,
  storeStockCache,
} from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  Screen,
  SPACE,
  StateView,
  useColors,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { dayLabel } from "@/lib/invoices";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

import { M } from "./common";
import { STATUS_LABEL, TransferCard, type TransferView } from "./transfer-card";
import { useDeviceContext } from "./use-ctx";

const T = "INV-08";
type State = "ready" | "loading" | "empty" | "partial" | "pending_sync";

interface ListData {
  readonly branch_id: string;
  readonly branches: readonly { readonly id: string; readonly name: string }[];
  readonly can_send: boolean;
  readonly awaiting_count: number;
  readonly partial_count: number;
  readonly transfers: readonly TransferView[];
  readonly as_of: string;
}
interface Row extends TransferView {
  readonly pending: boolean;
}

const CACHE_KEY = "transfers";

/**
 * INV-08 — قائمة التحويلات (خطة الجوال M3): كل تحويل بمرحلته وكميةُ الطريق معروضة صراحةً — مخزون
 * الطريق لا يُحسب في رصيد الفرعين؛ نصف المستلم يبقى مفتوحاً بالمتبقّي ولا يُغلق بالسهو؛ المحفوظ محلياً
 * ولم يُرفع موسوم؛ مخوَّلة للفرعين والمالك. التحويل المختار بطاقته فوق القائمة.
 */
export function TransfersScreen({ selectedId }: { selectedId: string }) {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const { ctx } = useDeviceContext();
  const [data, setData] = useState<ListData | null>(null);
  const [cached, setCached] = useState<ListData | null>(null);
  const [local, setLocal] = useState<LocalTransfer[]>([]);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [fetching, setFetching] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(selectedId);

  const load = useCallback(async () => {
    const storage = await getStorage();
    const [cache, locals] = await Promise.all([
      readStockCache<ListData>(storage, CACHE_KEY),
      readLocalTransfers(storage),
    ]);
    setCached(cache);
    setLocal(locals);
    const pend = new Set<string>();
    await storage.read(async (t) => {
      for (const l of locals) {
        const op = await t.getOperation(l.operation_id);
        if (op && op.state !== "synced") pend.add(l.id);
      }
    });
    setPendingIds(pend);
    try {
      const { data: d, response } = await api.GET("/api/inventory/transfers", {});
      const body = d as unknown as ListData | undefined;
      if (!response.ok || !body) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setData(body);
      await storeStockCache(storage, CACHE_KEY, body);
    } catch {
      setFailed(true);
    } finally {
      setFetching(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const server = data ?? cached;
  const serverIds = new Set((server?.transfers ?? []).map((t) => t.id));
  const rows: Row[] = [
    ...local
      .filter((t) => !serverIds.has(t.id) || pendingIds.has(t.id))
      .map((t): Row => ({ ...t, pending: true })),
    ...(server?.transfers ?? [])
      .filter((t) => !pendingIds.has(t.id))
      .map((t): Row => ({ ...t, pending: false })),
  ];
  const pendingCount = rows.filter((r) => r.pending).length;
  const partialCount = rows.filter((r) => r.status === "partially_received").length;
  const awaiting = rows.filter(
    (r) => r.status === "sent" || r.status === "partially_received",
  ).length;
  // بلا اختيار: بطاقة أول تحويل معلّق من هذا الجهاز (14-D9) — ما لم يُرفع يُعرض لا يُخفى
  const selected = rows.find((r) => r.id === picked) ?? rows.find((r) => r.pending) ?? null;

  const state: State =
    fetching && server === null && local.length === 0
      ? "loading"
      : rows.length === 0
        ? "empty"
        : pendingCount > 0
          ? "pending_sync"
          : partialCount > 0
            ? "partial"
            : "ready";

  const cancel = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const { response } = await api.POST("/api/inventory/transfers/{transfer_id}/cancel", {
        params: { path: { transfer_id: id } },
      });
      if (response.ok) await load();
    } catch {
      /* بلا اتصال: الإلغاء أونلاين */
    } finally {
      setBusy(false);
    }
  };

  const isOwner = ctx?.roleCode === "owner";
  const goNew = () => router.push("/inventory/transfers/new");

  return (
    <Screen screenId={T} state={state} title={tx(T, "التحويلات وحالاتها")}>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(
          T,
          "كل تحويل بمرحلته: أُرسل، في الطريق، استُلم، استُلم جزئياً. وكميةُ الطريق معروضة صراحةً.",
        )}
      </AppText>
      <AppText variant="secondary" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "ينتظر استلاماً")} <M>{awaiting}</M>
        {failed ? ` ${tx(T, "· المطابقة متعثّرة")}` : ""}
      </AppText>
      <View style={{ marginBottom: SPACE["4"] }}>
        <Button label={tx(T, "إنشاء وإرسال تحويل")} financial onPress={goNew} />
      </View>

      {state === "loading" ? (
        <StateView state="loading" title={tx(T, "جلب التحويلات")}>
          {null}
        </StateView>
      ) : null}
      {state === "empty" ? (
        <StateView state="empty" title={tx(T, "لا تحويلات")}>
          <AppText variant="secondary">{tx(T, "فرعٌ واحد أو لا نقل بين الفروع.")}</AppText>
          <Button label={tx(T, "إنشاء وإرسال تحويل")} onPress={goNew} />
        </StateView>
      ) : null}
      {state === "partial" ? (
        <StateView state="partial" title={tx(T, "تحويلات نصف مستلمة")}>
          <AppText variant="secondary">
            <M>{partialCount}</M> {tx(T, "تحويلات استُلم بعض سطورها — والباقي في الطريق أو مفقود.")}
          </AppText>
          <AppText variant="note" muted>
            {tx(T, "لا يُغلق بالسهو")}{" "}
            {tx(T, "· التحويل يبقى مفتوحاً بالمتبقّي حتى يُستلم أو يُلغى بقرار.")}
          </AppText>
        </StateView>
      ) : null}

      {selected ? (
        <TransferCard
          t={selected}
          pending={selected.pending}
          onReceive={
            !selected.pending && (isOwner || selected.branch_to_id === ctx?.branchId)
              ? () =>
                  router.push({
                    pathname: "/inventory/transfers/[id]/receive",
                    params: { id: selected.id },
                  })
              : undefined
          }
          onCancel={
            !selected.pending && (isOwner || selected.branch_from_id === ctx?.branchId)
              ? () => void cancel(selected.id)
              : undefined
          }
          cancelDisabledReason={selected.pending ? tx(T, "بانتظار الرفع") : undefined}
        />
      ) : null}

      {rows.length > 0 ? (
        <GroupedList title={tx(T, "التحويلات")}>
          {rows.map((r, i) => {
            const sent = r.lines.reduce((a, l) => a + BigInt(l.base_qty_milli), 0n);
            const rec = r.lines.reduce((a, l) => a + BigInt(l.received_base_milli), 0n);
            const transit =
              r.in_transit_milli !== undefined ? BigInt(r.in_transit_milli) : sent - rec;
            const day = dayLabel(r.sent_at);
            const tone = r.pending
              ? "pending_sync"
              : r.status === "received"
                ? "synced"
                : r.status === "cancelled"
                  ? "empty"
                  : "pending_sync";
            return (
              <Pressable
                key={r.id}
                accessibilityRole="button"
                accessibilityLabel={r.transfer_number}
                onPress={() => setPicked(r.id)}
                style={{
                  padding: SPACE["4"],
                  gap: SPACE["1"],
                  borderBottomWidth: i === rows.length - 1 ? 0 : 1,
                  borderBottomColor: c.border,
                }}
              >
                <AppText variant="bodyStrong">
                  {tx(T, "تحويل")} <M>{r.transfer_number}</M>
                </AppText>
                <AppText variant="note" muted>
                  {r.branch_from_name} ← {r.branch_to_name} · {tx(T, "أُرسل")} {day.word ?? ""}
                  {day.n ? <M>{day.n}</M> : null} <M>{hhmm(r.sent_at)}</M>
                </AppText>
                <AppText variant="note" style={{ color: c.state[tone].fg }}>
                  {tx(T, "المرحلة")}{" "}
                  {r.pending ? tx(T, "معلّق هذا الجهاز") : STATUS_LABEL[r.status]}
                </AppText>
                <AppText variant="note" muted>
                  {tx(T, "في الطريق")} <M>{formatQty(transit, 0)}</M>
                  {r.late ? (
                    <AppText variant="note" style={{ color: c.state.stale.fg }}>
                      {" "}
                      {tx(T, "تأخّر فوق 72 ساعة")}
                    </AppText>
                  ) : null}
                </AppText>
              </Pressable>
            );
          })}
        </GroupedList>
      ) : null}
      <AppText variant="note" muted>
        {tx(T, "مخزون الطريق")} {tx(T, "· لا يُحسب في رصيد الفرعين.")}
      </AppText>
    </Screen>
  );
}

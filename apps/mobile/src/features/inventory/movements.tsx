import { agoParts, dayMonth, formatQty } from "@sting/app-core";
import {
  type PendingStockMovement,
  readLocalItems,
  readPendingStockMovements,
  readReturns,
  readSales,
  readStockCache,
  storeStockCache,
} from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  Chip,
  GroupedList,
  Screen,
  SPACE,
  StateView,
  useColors,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { type ShiftContext, readShiftContext } from "@/lib/pos";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

import { M, Wrap, when } from "./common";

const T = "INV-02";
type State = "ready" | "loading" | "empty" | "pending_sync" | "stale";
type Range = "30" | "all";
type Dp = 0 | 1 | 2 | 3;

interface ServerRow {
  readonly id: string;
  readonly occurred_at: string;
  readonly reason: string;
  readonly label: string;
  readonly actor: string;
  readonly doc: string;
  readonly delta_milli: string;
  readonly balance_after_milli: string;
}
interface Movements {
  readonly item: {
    readonly id: string;
    readonly name: string;
    readonly sale_unit: {
      readonly code: string;
      readonly name: string;
      readonly decimal_places: Dp;
    };
  };
  readonly branch_id: string;
  readonly branch_name: string;
  readonly range: Range;
  readonly as_of: string;
  readonly rows: readonly ServerRow[];
  readonly balance_milli: string;
  readonly total_count: number;
  readonly last_movement_at: string;
}
interface Row {
  readonly id: string;
  readonly at: string;
  readonly label: string;
  readonly who: string;
  readonly doc: string;
  readonly deltaMilli: bigint;
  readonly balanceMilli: bigint | null;
  readonly phase: "confirmed" | "pending";
}

const REASON_LABELS: Record<string, string> = {
  sale: tx(T, "بيع نقطة بيع"),
  return: tx(T, "مرتجع زبون"),
  return_damaged: tx(T, "مرتجع زبون"),
  reversal: tx(T, "عكس بيع مكرَّر"),
  receive: tx(T, "استلام بضاعة"),
  count: tx(T, "تسوية جرد"),
  transfer_out: tx(T, "تحويل صادر"),
  transfer_in: tx(T, "تحويل وارد"),
  opening: tx(T, "افتتاحية"),
};

const cacheKey = (itemId: string, branchId: string, range: Range) =>
  `movements.${itemId}.${branchId}.${range}`;

/**
 * INV-02 — سجل حركة الصنف (خطة الجوال M3): الجواب على «كيف صار الرصيد كذا» — لا سطر بلا مستند؛ الرصيد
 * يفصل «مؤكَّد خادمياً» عن «معلّق هذا الجهاز»؛ الصفوف المعلّقة لا تُخفى ولا تُخلط؛ «لم يتحرّك بعد»
 * غير «لا حركة في هذا المدى». يعمل من آخر لقطة مخزَّنة بلا اتصال.
 */
export function MovementsScreen({
  itemId,
  branchId: wanted,
  range: initialRange,
}: {
  itemId: string;
  branchId: string;
  range: Range;
}) {
  const router = useRouter();
  const c = useColors();
  const { api, state: session } = useSession();
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [range, setRange] = useState<Range>(initialRange);
  const [data, setData] = useState<Movements | null>(null);
  const [cached, setCached] = useState<Movements | null>(null);
  const [failed, setFailed] = useState(false);
  const [online, setOnline] = useState(true);
  const [fetching, setFetching] = useState(true);
  const [pendingRows, setPendingRows] = useState<Row[]>([]);
  const [pendingDelta, setPendingDelta] = useState(0n);
  const [itemName, setItemName] = useState("");
  const branchId = wanted || ctx?.branchId || "";

  useEffect(() => {
    void (async () => {
      const storage = await getStorage();
      setCtx(
        await readShiftContext(storage, { deviceId: session.deviceId, userId: session.userId }),
      );
      const items = await readLocalItems(storage);
      setItemName(items.find((i) => i.id === itemId)?.name ?? "");
    })();
  }, [itemId, session.deviceId, session.userId]);

  useEffect(() => {
    if (!branchId) return;
    let alive = true;
    setFetching(true);
    setFailed(false);
    setData(null);
    void (async () => {
      const storage = await getStorage();
      const [cache, moves, sales, returns] = await Promise.all([
        readStockCache<Movements>(storage, cacheKey(itemId, branchId, range)),
        readPendingStockMovements(storage),
        readSales(storage),
        readReturns(storage),
      ]);
      if (!alive) return;
      setCached(cache);
      const mine = moves.filter((m) => m.itemId === itemId && m.branchId === branchId);
      const docOf = (m: PendingStockMovement): { doc: string; who: string } => {
        if (m.sourceEntity === "sales.Sale") {
          const s = sales.find((x) => x.id === m.sourceId);
          return { doc: s?.invoice_number ?? "", who: s?.user_name ?? "" };
        }
        if (m.sourceEntity === "sales.SaleReturn") {
          const r = returns.find((x) => x.id === m.sourceId);
          return { doc: r?.return_number ?? "", who: r?.user_name ?? "" };
        }
        return { doc: "", who: "" };
      };
      setPendingRows(
        mine
          .map((m): Row => ({
            id: m.movementId,
            at: m.occurredAt,
            label: REASON_LABELS[m.reason] ?? m.reason,
            ...docOf(m),
            deltaMilli: m.deltaMilli,
            balanceMilli: null,
            phase: "pending",
          }))
          .reverse(),
      );
      setPendingDelta(mine.reduce((a, m) => a + m.deltaMilli, 0n));
      try {
        const { data: d, response } = await api.GET("/api/inventory/items/{item_id}/movements", {
          params: { path: { item_id: itemId }, query: { branch_id: branchId, range } },
        });
        if (!alive) return;
        setOnline(true);
        const body = d as unknown as Movements | undefined;
        if (!response.ok || !body) {
          setFailed(true);
          return;
        }
        setData(body);
        await storeStockCache(storage, cacheKey(itemId, branchId, range), body);
      } catch {
        if (alive) setOnline(false);
      } finally {
        if (alive) setFetching(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [itemId, branchId, range, api]);

  const server = data ?? cached;
  const dp: Dp = server?.item.sale_unit.decimal_places ?? 0;
  const confirmed: Row[] = (server?.rows ?? [])
    .map((r): Row => ({
      id: r.id,
      at: r.occurred_at,
      label: r.label,
      who: r.actor,
      doc: r.doc,
      deltaMilli: BigInt(r.delta_milli),
      balanceMilli: BigInt(r.balance_after_milli),
      phase: "confirmed",
    }))
    .reverse();
  const rows = [...pendingRows, ...confirmed];
  const serverBalance = server ? BigInt(server.balance_milli) : null;
  const staleData = !online || failed;

  const state: State = staleData
    ? "stale"
    : fetching && data === null
      ? "loading"
      : rows.length === 0
        ? "empty"
        : pendingRows.length > 0
          ? "pending_sync"
          : "ready";

  const name = server?.item.name || itemName;
  const unit = server?.item.sale_unit.name ?? "";
  const branchName = server?.branch_name ?? ctx?.branchName ?? "";
  const ago = server ? agoParts(server.as_of) : null;
  const last = server?.last_movement_at ? dayMonth(server.last_movement_at) : null;

  return (
    <Screen screenId={T} state={state} title={tx(T, "سجل حركة الصنف")}>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "لا سطر بلا مستند، والحركات المحفوظة محلياً معلَّمة بصراحة فلا تُقرأ كمؤكَّدة.")}
      </AppText>
      <AppText variant="title">
        {name}
        {unit ? ` — ${unit}` : ""}
        {branchName ? ` · ${branchName}` : ""}
      </AppText>
      <AppText variant="secondary" muted style={{ marginTop: SPACE["1"] }}>
        {tx(T, "الرصيد الحالي")}{" "}
        <M>{serverBalance === null ? "—" : formatQty(serverBalance + pendingDelta, dp)}</M>
        {pendingRows.length > 0 ? (
          <>
            {" "}
            {tx(T, "· منه")} <M>{formatQty(pendingDelta, dp)}</M> {tx(T, "من حركات لم تُرفع بعد")}
          </>
        ) : null}
      </AppText>
      <AppText
        variant="note"
        style={{
          color: staleData ? c.state.stale.fg : c.state.synced.fg,
          marginTop: SPACE["1"],
          marginBottom: SPACE["3"],
        }}
      >
        {ago ? (
          <>
            {tx(T, "آخر تحديث خادمي قبل")} <M>{ago.n}</M>{" "}
            {ago.unit === "minute"
              ? tx(T, "دقيقة")
              : ago.unit === "hour"
                ? tx(T, "ساعة")
                : tx(T, "يوم")}
          </>
        ) : (
          tx(T, "لا تحديث خادمي بعد")
        )}
      </AppText>
      <View style={{ marginBottom: SPACE["3"] }}>
        <Button
          label={tx(T, "تسجيل التالف")}
          variant="secondary"
          onPress={() =>
            router.push({ pathname: "/inventory/items/[id]/damage", params: { id: itemId } })
          }
        />
      </View>
      <AppText variant="secondary" muted style={{ marginBottom: SPACE["1"] }}>
        {tx(T, "المدى")}
      </AppText>
      <Wrap>
        <Chip label={tx(T, "30 يوماً")} on={range === "30"} onPress={() => setRange("30")} />
        <Chip label={tx(T, "كل الحركات")} on={range === "all"} onPress={() => setRange("all")} />
      </Wrap>

      {state === "loading" ? (
        <StateView state="loading" title={tx(T, "جلب الحركات")}>
          <AppText variant="note" muted>
            {tx(T, "المدى")} {range === "all" ? tx(T, "كل الحركات") : <M>30</M>}
            {cached ? (
              <>
                {" "}
                {tx(T, "· الحركات المتوقَّعة")} <M>{cached.rows.length}</M>
              </>
            ) : null}
          </AppText>
        </StateView>
      ) : null}
      {state === "stale" ? (
        <StateView state={online ? "stale" : "offline"} title={tx(T, "آخر تحديث خادمي")}>
          <AppText variant="secondary">
            {tx(T, "الحركات المحفوظة محلياً معلَّمة بصراحة فلا تُقرأ كمؤكَّدة.")}
          </AppText>
        </StateView>
      ) : null}
      {state === "empty" ? (
        <StateView state="empty" title={tx(T, "لا حركة")}>
          <AppText variant="secondary">
            {server && server.total_count > 0 && last ? (
              <>
                {tx(T, "لا حركة في هذا المدى — آخرها")} <M>{last.day}</M> {last.month}
              </>
            ) : (
              tx(T, "الصنف لم يتحرّك بعد")
            )}
          </AppText>
          <Button
            label={tx(T, "أرصدة المخزون")}
            variant="secondary"
            onPress={() => router.push("/inventory")}
          />
        </StateView>
      ) : null}

      {rows.length > 0 ? (
        <GroupedList title={tx(T, "سجل الحركة")}>
          {rows.map((r, i) => (
            <View
              key={r.id}
              style={{
                paddingHorizontal: SPACE["4"],
                paddingVertical: SPACE["3"],
                flexDirection: "row",
                gap: SPACE["3"],
                borderBottomWidth: i === rows.length - 1 ? 0 : 1,
                borderBottomColor: c.border,
              }}
            >
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong">{r.label}</AppText>
                <AppText variant="note" muted>
                  <M>{when(r.at)}</M> · {r.who || "—"}
                </AppText>
                <AppText variant="note" muted>
                  {tx(T, "المستند")} <M>{r.doc || "—"}</M>
                </AppText>
                <AppText
                  variant="note"
                  style={{
                    color: r.phase === "pending" ? c.state.pending_sync.fg : c.state.synced.fg,
                  }}
                >
                  {r.phase === "pending" ? tx(T, "معلّق هذا الجهاز") : tx(T, "مؤكَّد")}
                </AppText>
              </View>
              <View style={{ alignItems: "flex-start" }}>
                <AppText
                  variant="money"
                  style={{
                    color: r.deltaMilli < 0n ? c.danger : c.state.synced.fg,
                    writingDirection: "ltr",
                  }}
                >
                  {r.deltaMilli > 0n ? "+" : ""}
                  {formatQty(r.deltaMilli, dp)}
                </AppText>
                <AppText variant="note" muted>
                  {tx(T, "الرصيد بعدها")}{" "}
                  <M>{r.balanceMilli === null ? "—" : formatQty(r.balanceMilli, dp)}</M>
                </AppText>
              </View>
            </View>
          ))}
        </GroupedList>
      ) : null}
    </Screen>
  );
}

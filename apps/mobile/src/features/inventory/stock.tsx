import { formatQty, hhmm } from "@sting/app-core";
import {
  type LocalItem,
  pendingByItem,
  readLocalBalances,
  readLocalItems,
  readPendingStockMovements,
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
  TextField,
  useColors,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { dayLabel } from "@/lib/invoices";
import { readShiftContext, type ShiftContext } from "@/lib/pos";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

import { M, Wrap } from "./common";

const T = "INV-01";
type State = "ready" | "loading" | "empty" | "stale" | "offline" | "pending_sync" | "partial";
type Filter = "all" | "negative" | "low";
type Dp = 0 | 1 | 2 | 3;

interface UnitInfo {
  readonly code: string;
  readonly name: string;
  readonly decimal_places: Dp;
}
interface ServerRow {
  readonly item_id: string;
  readonly name: string;
  readonly qty_milli: string;
  readonly sale_unit: UnitInfo;
  readonly purchase_unit: (UnitInfo & { readonly factor_milli: string }) | null;
  readonly alert_threshold_milli: string;
  readonly tag: "negative" | "low" | "ok";
  readonly quarantine_milli: string;
  readonly in_transit_milli?: string;
  readonly last_movement_at: string;
  readonly price_missing: boolean;
}
interface Balances {
  readonly catalog_items?: number;
  readonly branch_id: string;
  readonly branches: readonly { readonly id: string; readonly name: string }[];
  readonly as_of: string;
  readonly rows: readonly ServerRow[];
}
/** صف الشاشة: خادمي + معلّق هذا الجهاز (للفرع الحالي) — يُعرضان مركَّبين لا مجموعاً وحده. */
export interface Row {
  readonly id: string;
  readonly name: string;
  readonly serverMilli: bigint;
  readonly pendingMilli: bigint;
  readonly pendingCount: number;
  readonly qtyMilli: bigint;
  readonly saleUnit: UnitInfo;
  readonly purchase: (UnitInfo & { readonly factor_milli: string }) | null;
  readonly thresholdMilli: bigint | null;
  readonly priceMissing: boolean;
  readonly lastAt: string;
  readonly asOf: string;
  readonly tag: "negative" | "low" | "missing" | "ok";
  readonly quarantineMilli: bigint;
  readonly inTransitMilli: bigint;
}

/** «0.83» بالكرتونة: الرصيد ÷ معامل وحدة الشراء بمنزلتين — قراءة مساعدة لا مجموع (R-08). */
export function inPurchaseUnit(qtyMilli: bigint, factorMilli: bigint): string {
  if (factorMilli <= 0n) return "—";
  const scaled = (qtyMilli * 100n) / factorMilli;
  const neg = scaled < 0n;
  const abs = neg ? -scaled : scaled;
  return `${neg ? "−" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

function tagOf(qty: bigint, threshold: bigint | null, priceMissing: boolean): Row["tag"] {
  if (qty < 0n) return "negative";
  if (threshold !== null && qty < threshold) return "low";
  if (priceMissing) return "missing";
  return "ok";
}

function toRow(
  r: ServerRow,
  asOf: string,
  pend: { deltaMilli: bigint; count: number } | undefined,
): Row {
  const serverMilli = BigInt(r.qty_milli);
  const pendingMilli = pend?.deltaMilli ?? 0n;
  const qty = serverMilli + pendingMilli;
  const threshold = r.alert_threshold_milli ? BigInt(r.alert_threshold_milli) : null;
  return {
    id: r.item_id,
    name: r.name,
    serverMilli,
    pendingMilli,
    pendingCount: pend?.count ?? 0,
    qtyMilli: qty,
    saleUnit: r.sale_unit,
    purchase: r.purchase_unit,
    thresholdMilli: threshold,
    priceMissing: r.price_missing,
    lastAt: r.last_movement_at,
    asOf,
    tag: tagOf(qty, threshold, r.price_missing && !r.purchase_unit),
    quarantineMilli: BigInt(r.quarantine_milli || "0"),
    inTransitMilli: BigInt(r.in_transit_milli || "0"),
  };
}

/** بلا اتصال: أرصدة الجهاز (تشمل ما لم يُرفع لأن الحفظ المحلي يحرّكها) على أصناف الكتالوج المحلي. */
function localRowsOf(
  items: readonly LocalItem[],
  balances: Map<string, { readonly qty_milli: string; readonly as_of: string }>,
): Row[] {
  const out: Row[] = [];
  for (const it of items) {
    const b = balances.get(it.id);
    if (!b) continue;
    const units = [...it.units].sort((a, c) =>
      Number(BigInt(c.factor_milli) - BigInt(a.factor_milli)),
    );
    const top = units[0];
    const purchase =
      top && BigInt(top.factor_milli) !== 1000n
        ? {
            code: top.code,
            name: top.name,
            decimal_places: top.decimal_places ?? 0,
            factor_milli: top.factor_milli,
          }
        : null;
    const qty = BigInt(b.qty_milli);
    const threshold = it.alert_threshold_milli ? BigInt(it.alert_threshold_milli) : null;
    const priceMissing = BigInt(it.sale_price_minor || "0") <= 0n;
    out.push({
      id: it.id,
      name: it.name,
      serverMilli: qty,
      pendingMilli: 0n,
      pendingCount: 0,
      qtyMilli: qty,
      saleUnit: {
        code: it.base_unit_code,
        name: it.base_unit_name,
        decimal_places: it.base_unit_decimal_places ?? 0,
      },
      purchase,
      thresholdMilli: threshold,
      priceMissing,
      lastAt: "",
      asOf: b.as_of,
      tag: tagOf(qty, threshold, priceMissing && !purchase),
      quarantineMilli: 0n,
      inTransitMilli: 0n,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

const countWord = (n: number) =>
  n === 1 ? tx(T, "صنف") : n === 2 ? tx(T, "صنفان") : n <= 10 ? tx(T, "أصناف") : tx(T, "صنفاً");

/**
 * INV-01 — أرصدة المخزون (خطة الجوال M3): قائمة بفلتر الفرع والحالة. لكل صنف رصيده بوحدة البيع ووحدة
 * الشراء بمعاملها المعلن قراءةً مساعدة — لا مجموع كمّي عبر وحدات (R-08)؛ السالب يُعرض بلونه ولا يمنع
 * البيع (ACC-17)؛ المعلّق من هذا الجهاز داخل في الأرصدة وموسوم؛ لكل رصيد تغطية زمنية. بلا اتصال: أرصدة
 * الجهاز المحلية. المواقع الأخرى تَرِد واحداً واحداً والمجموع لا يُعرض قبل اكتمالها.
 */
export function StockScreen() {
  const router = useRouter();
  const c = useColors();
  const { api, state: session } = useSession();
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [branchId, setBranchId] = useState("");
  const [data, setData] = useState<Balances | null>(null);
  const [cached, setCached] = useState<Balances | null>(null);
  const [failed, setFailed] = useState(false);
  const [online, setOnline] = useState(true);
  const [fetching, setFetching] = useState(true);
  const [localRows, setLocalRows] = useState<Row[] | null>(null);
  const [localItemsCount, setLocalItemsCount] = useState(0);
  const [pending, setPending] = useState<Map<string, { deltaMilli: bigint; count: number }>>(
    new Map(),
  );
  const [others, setOthers] = useState<Map<string, Balances | "failed" | "pending">>(new Map());
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  // الفرع: من سياق الجهاز، وإلا يختار الخادم أول فرع نشط (مالك بلا جهاز مسجَّل)
  useEffect(() => {
    void (async () => {
      const storage = await getStorage();
      const c = await readShiftContext(storage, {
        deviceId: session.deviceId,
        userId: session.userId,
      });
      setCtx(c);
      if (c?.branchId) {
        setBranchId((b) => b || c.branchId);
        return;
      }
      try {
        const { data: d, response } = await api.GET("/api/inventory/balances", {
          params: { query: {} },
        });
        const body = d as unknown as Balances | undefined;
        if (response.ok && body?.branch_id) setBranchId((b) => b || body.branch_id);
        setOnline(true);
      } catch {
        setOnline(false);
        setFetching(false);
      }
    })();
  }, [api, session.deviceId, session.userId]);

  useEffect(() => {
    if (!branchId) return;
    let alive = true;
    setFetching(true);
    setFailed(false);
    setData(null);
    setOthers(new Map());
    void (async () => {
      const storage = await getStorage();
      const [cache, moves, balances, items] = await Promise.all([
        readStockCache<Balances>(storage, branchId),
        readPendingStockMovements(storage),
        readLocalBalances(storage),
        readLocalItems(storage),
      ]);
      if (!alive) return;
      setCached(cache);
      setPending(pendingByItem(moves, branchId));
      setLocalRows(localRowsOf(items, balances));
      setLocalItemsCount(items.length);
      try {
        const { data: d, response } = await api.GET("/api/inventory/balances", {
          params: { query: { branch_id: branchId } },
        });
        if (!alive) return;
        setOnline(true);
        const body = d as unknown as Balances | undefined;
        if (!response.ok || !body) {
          setFailed(true);
          return;
        }
        setData(body);
        await storeStockCache(storage, branchId, body);
        const rest = body.branches.filter((b) => b.id !== branchId);
        setOthers(new Map(rest.map((b) => [b.id, "pending" as const])));
        for (const b of rest) {
          try {
            const r = await api.GET("/api/inventory/balances", {
              params: { query: { branch_id: b.id } },
            });
            const rb = r.data as unknown as Balances | undefined;
            if (!alive) return;
            setOthers((m) => new Map(m).set(b.id, r.response.ok && rb ? rb : "failed"));
          } catch {
            if (!alive) return;
            setOthers((m) => new Map(m).set(b.id, "failed"));
          }
        }
      } catch {
        if (alive) setOnline(false);
      } finally {
        if (alive) setFetching(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [branchId, api]);

  const server = data ?? cached;
  const catalogCount = server?.catalog_items ?? (localItemsCount || null);
  const isDeviceBranch = ctx?.branchId === branchId;
  const source: Row[] | null =
    server && (online || !isDeviceBranch)
      ? server.rows.map((r) => toRow(r, server.as_of, pending.get(r.item_id)))
      : isDeviceBranch
        ? localRows
        : null;
  const rowsAll = source ?? [];
  const needle = q.trim();
  const rows = rowsAll
    .filter((r) => (needle ? r.name.includes(needle) : true))
    .filter((r) =>
      filter === "negative" ? r.qtyMilli < 0n : filter === "low" ? r.tag === "low" : true,
    );
  const pendingCount = rowsAll.reduce((a, r) => a + r.pendingCount, 0);
  const attention = rowsAll.filter((r) => r.tag !== "ok").length;
  const othersArr = [...others.values()];
  const othersPending = othersArr.some((v) => v === "pending");
  const othersFailed = othersArr.some((v) => v === "failed");
  const totalsReady = server !== null && !othersPending && !othersFailed;

  const state: State = !online
    ? "offline"
    : source === null || (fetching && data === null && cached === null)
      ? "loading"
      : failed
        ? "stale"
        : othersPending
          ? "loading"
          : othersFailed
            ? "partial"
            : rowsAll.length === 0
              ? "empty"
              : pendingCount > 0
                ? "pending_sync"
                : "ready";

  const totalAcross = (itemId: string): bigint | null => {
    if (!totalsReady || !server) return null;
    let sum = 0n;
    for (const r of server.rows) if (r.item_id === itemId) sum += BigInt(r.qty_milli);
    for (const v of othersArr) {
      if (v === "pending" || v === "failed") return null;
      for (const r of v.rows) if (r.item_id === itemId) sum += BigInt(r.qty_milli);
    }
    return sum;
  };
  const multi = (server?.branches.length ?? 0) > 1;
  const branchName = server?.branches.find((b) => b.id === branchId)?.name ?? ctx?.branchName ?? "";
  const open = (r: Row) =>
    router.push({
      pathname: "/inventory/items/[id]",
      params: { id: r.id, branch: branchId },
    });
  const tagTone = { negative: "stale", low: "pending_sync", missing: "empty" } as const;
  const tagLabel = {
    negative: tx(T, "رصيد سالب"),
    low: tx(T, "تحت حد التنبيه"),
    missing: tx(T, "بيانات ناقصة"),
  } as const;

  return (
    <Screen screenId={T} state={state} title={`${tx(T, "المخزون —")} ${branchName}`}>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "الرصيد السالب يُنبَّه عليه ولا يمنع البيع. لكل رصيد تغطية زمنية.")}
      </AppText>
      <TextField label={tx(T, "اسم الصنف")} value={q} onChangeText={setQ} autoCorrect={false} />
      {server && server.branches.length > 1 ? (
        <>
          <AppText variant="secondary" muted style={{ marginBottom: SPACE["1"] }}>
            {tx(T, "الفرع")}
          </AppText>
          <Wrap>
            {server.branches.map((b) => (
              <Chip
                key={b.id}
                label={b.name}
                on={b.id === branchId}
                onPress={() => setBranchId(b.id)}
              />
            ))}
          </Wrap>
        </>
      ) : null}
      <AppText variant="secondary" muted style={{ marginBottom: SPACE["1"] }}>
        {tx(T, "الأصناف")}
      </AppText>
      <Wrap>
        <Chip label={tx(T, "كل الأصناف")} on={filter === "all"} onPress={() => setFilter("all")} />
        <Chip
          label={tx(T, "السالب فقط")}
          on={filter === "negative"}
          onPress={() => setFilter("negative")}
        />
        <Chip
          label={tx(T, "تحت حد التنبيه")}
          on={filter === "low"}
          onPress={() => setFilter("low")}
        />
      </Wrap>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        <M>{rowsAll.length}</M> {tx(T, "صنفاً ·")} <M>{attention}</M>{" "}
        {tx(T, "أصناف تحتاج انتباهاً")}
      </AppText>
      <View style={{ gap: SPACE["2"], marginBottom: SPACE["4"] }}>
        <Button
          label={tx(T, "استلم بضاعة")}
          variant="secondary"
          onPress={() => router.push("/inventory/receive")}
        />
        <Button
          label={tx(T, "أدخل افتتاحيات المخزون")}
          variant="quiet"
          onPress={() => router.push("/inventory/openings")}
        />
        <Button
          label={tx(T, "جلسة جرد")}
          variant="quiet"
          onPress={() => router.push("/inventory/count")}
        />
        <Button
          label={tx(T, "التحويلات")}
          variant="quiet"
          onPress={() => router.push("/inventory/transfers")}
        />
      </View>

      {state === "loading" && othersPending ? (
        <StateView state="loading" title={tx(T, "جمع المواقع")}>
          <AppText variant="secondary">
            {tx(T, "المواقع تَرِد واحداً واحداً، والمجموع لا يُعرض قبل اكتمالها.")}
          </AppText>
        </StateView>
      ) : null}
      {state === "partial" ? (
        <StateView state="partial" title={tx(T, "جمع المواقع")}>
          <AppText variant="secondary">
            {tx(T, "اتصالٌ ومواقع لم تَرد. المجموع لا يُعرض قبل اكتمالها — لا مجموع جزئي.")}
          </AppText>
          <AppText variant="note" muted>
            {[...others.entries()]
              .filter(([, v]) => v === "failed")
              .map(([id]) => server?.branches.find((b) => b.id === id)?.name ?? id)
              .join(" · ")}
          </AppText>
        </StateView>
      ) : null}
      {state === "stale" ? (
        <StateView state="stale" title={tx(T, "أرصدة قديمة")}>
          <AppText variant="secondary">{tx(T, "من آخر مطابقة قبل ساعتين وقد بيع منها.")}</AppText>
        </StateView>
      ) : null}
      {state === "offline" ? (
        <StateView state="offline" title={tx(T, "أرصدة محلية")}>
          <AppText variant="secondary">
            {tx(T, "أرصدة هذا الجهاز وما زامنه، ومعها ما لم يُرفع.")}
          </AppText>
        </StateView>
      ) : null}
      {state === "empty" && catalogCount === 0 ? (
        <StateView state="empty" title={tx(T, "لا أصناف بعد")}>
          <AppText variant="secondary">
            {tx(T, "الكتالوج فارغ — أضف أصنافك أولاً ثم أدخل أرصدتها.")}
          </AppText>
          <Button label={tx(T, "أضف صنفاً")} onPress={() => router.push("/catalog/new")} />
        </StateView>
      ) : state === "empty" ? (
        <StateView state="empty" title={tx(T, "لا أرصدة")}>
          <AppText variant="secondary">
            {catalogCount ? (
              <>
                {tx(T, "في الكتالوج")} <M>{catalogCount}</M> {countWord(catalogCount)}{" "}
                {tx(T, "بلا رصيد بعد — أدخل افتتاحياتها أو استلم بضاعة.")}
              </>
            ) : (
              tx(T, "لا رصيد مسجّل في هذا الموقع بعد.")
            )}
          </AppText>
          <Button
            label={tx(T, "أدخل افتتاحيات المخزون")}
            onPress={() => router.push("/inventory/openings")}
          />
          <Button
            label={tx(T, "استلم بضاعة")}
            variant="secondary"
            onPress={() => router.push("/inventory/receive")}
          />
        </StateView>
      ) : null}

      {rows.length > 0 ? (
        <GroupedList title={tx(T, "أرصدة المخزون")}>
          {rows.map((r, i) => {
            const dp = r.saleUnit.decimal_places;
            const last = r.lastAt ? dayLabel(r.lastAt) : null;
            return (
              <Pressable
                key={r.id}
                accessibilityRole="button"
                accessibilityLabel={r.name}
                onPress={() => open(r)}
                style={{
                  paddingHorizontal: SPACE["4"],
                  paddingVertical: SPACE["3"],
                  gap: SPACE["1"],
                  borderBottomWidth: i === rows.length - 1 ? 0 : 1,
                  borderBottomColor: c.border,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE["3"] }}>
                  <View style={{ flex: 1 }}>
                    <AppText variant="bodyStrong">{r.name}</AppText>
                    <AppText variant="note" muted>
                      {r.saleUnit.name}
                      {r.purchase ? ` · ${tx(T, "وحدة الشراء")} ${r.purchase.name}` : ""}
                    </AppText>
                  </View>
                  <AppText
                    variant="money"
                    style={{
                      color: r.qtyMilli < 0n ? c.danger : c.inkStrong,
                      writingDirection: "ltr",
                    }}
                  >
                    {formatQty(r.qtyMilli, dp)}
                  </AppText>
                </View>
                {r.purchase ? (
                  <AppText variant="note" muted>
                    {tx(T, "المعامل:")} <M>1</M> {r.purchase.name} ={" "}
                    <M>{formatQty(r.purchase.factor_milli, dp)}</M> {r.saleUnit.name}
                    {" · "}
                    {tx(T, "بالكرتونة")}{" "}
                    <M>{inPurchaseUnit(r.qtyMilli, BigInt(r.purchase.factor_milli))}</M>
                  </AppText>
                ) : (
                  <AppText variant="note" muted>
                    {tx(T, "وحدة واحدة — لا تحويل")}
                  </AppText>
                )}
                {r.pendingCount > 0 ? (
                  <AppText variant="note" muted>
                    {tx(T, "خادمي")} <M>{formatQty(r.serverMilli, dp)}</M>{" "}
                    {tx(T, "+ معلّق هذا الجهاز")} <M>{formatQty(r.pendingMilli, dp)}</M>
                  </AppText>
                ) : null}
                {r.inTransitMilli > 0n ? (
                  <AppText variant="note" muted>
                    {tx(T, "في الطريق")} <M>{formatQty(r.inTransitMilli, dp)}</M>
                  </AppText>
                ) : null}
                {r.quarantineMilli > 0n ? (
                  <AppText variant="note" muted>
                    {tx(T, "حجر — قابل للمراجعة")} <M>{formatQty(r.quarantineMilli, dp)}</M>
                  </AppText>
                ) : null}
                {state === "stale" || state === "offline" ? (
                  <AppText variant="note" muted>
                    {tx(T, "حتى")} <M>{r.asOf ? hhmm(r.asOf) : "—"}</M>
                  </AppText>
                ) : null}
                {multi ? (
                  <AppText variant="note" muted>
                    {tx(T, "كل المواقع")}{" "}
                    <M>{((t) => (t === null ? "—" : formatQty(t, dp)))(totalAcross(r.id))}</M>
                  </AppText>
                ) : null}
                {r.tag !== "ok" ? (
                  <>
                    <AppText variant="note" style={{ color: c.state[tagTone[r.tag]].fg }}>
                      {tagLabel[r.tag]}
                    </AppText>
                    <AppText variant="note" muted>
                      {r.tag === "negative" ? (
                        tx(
                          T,
                          "بيع فوق الرصيد الدفتري. لا يُصحَّح تلقائياً — يحتاج جرد أو تسجيل استلام فائت.",
                        )
                      ) : r.tag === "low" && r.thresholdMilli !== null ? (
                        <>
                          {tx(T, "تحت حد إعادة الطلب (")}
                          <M>{formatQty(r.thresholdMilli, dp)}</M>
                          {tx(T, "). التنبيه اقتراح لا أمر — قد تكون تعرف أن شحنة في الطريق.")}
                        </>
                      ) : (
                        tx(
                          T,
                          "بلا سعر وبلا معامل تحويل. يُباع بسعر يدوي في نقطة البيع ولا يدخل تقارير القيمة حتى يُستكمل.",
                        )
                      )}
                    </AppText>
                  </>
                ) : null}
                {last ? (
                  <AppText variant="note" muted>
                    {tx(T, "آخر حركة")} {last.word ?? ""}
                    {last.n ? <M>{last.n}</M> : null} <M>{hhmm(r.lastAt)}</M>
                  </AppText>
                ) : null}
              </Pressable>
            );
          })}
        </GroupedList>
      ) : null}

      <AppText variant="note" muted style={{ marginBottom: SPACE["2"] }}>
        {tx(T, "آخر تحديث خادمي")} <M>{server?.as_of ? hhmm(server.as_of) : "—"}</M>
        {pendingCount > 0 ? (
          <>
            {" · "}
            {pendingCount === 1
              ? tx(T, "حركة واحدة معلقة")
              : pendingCount === 2
                ? tx(T, "حركتان معلقتان")
                : null}
            {pendingCount > 2 ? (
              <>
                <M>{pendingCount}</M> {tx(T, "حركات معلقة")}
              </>
            ) : null}{" "}
            {tx(T, "من هذا الجهاز داخلتان في الأرصدة.")}
          </>
        ) : null}{" "}
        {tx(T, "الرصيد السالب لا يمنع البيع")}{" "}
        {tx(T, "— يعني أن بيعاً سُجّل قبل تسجيل الاستلام، والتسوية تتم بالجرد لا بالمنع.")}
      </AppText>
      <AppText variant="note" muted>
        {tx(T, "معامل التحويل معلن ومحرَّر.")}{" "}
        {tx(
          T,
          "«كرتونة = 12 حبة» رقم يكتبه صاحب المحل ويظهر في بطاقة الصنف. الرصيد بوحدة البيع، والشراء يحوَّل بالمعامل المعلن عند الاستلام.",
        )}
      </AppText>
    </Screen>
  );
}

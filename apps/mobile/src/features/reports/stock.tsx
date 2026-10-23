import { formatQty, hhmm, pushPending } from "@sting/app-core";
import { readPendingStockMovements } from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  Chip,
  FONT,
  GroupedList,
  Screen,
  SPACE,
  StateView,
  useColors,
  ThemedText as Text,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { ChipGroup, DayCell, N, ReportNav, Row, Strong } from "@/components/reports/ui";
import { Ago } from "@/lib/ago";
import { newId } from "@/lib/crypto";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

import { CompletenessBadge, type Completeness, DevicesSynced } from "./completeness";
import { fetchFileText, shareReportFile } from "./share";
import { fetched, useReport } from "./use-report";

const T = "REP-03";
type State = "ready" | "loading" | "empty" | "stale" | "pending_sync";
type RangeKey = "today" | "yesterday" | "7d" | "30d" | "custom";

interface StockRow {
  item_id: string;
  name: string;
  unit: { code: string; name: string; decimal_places: 0 | 1 | 2 | 3 };
  opening_milli: string;
  in_milli: string;
  out_milli: string;
  closing_milli: string;
  moved_in_range: number;
  tag: "negative" | "empty" | "ok";
  doc: string;
  explain: string;
  last_movement_at: string;
}
export interface StockPayload {
  scope: "all" | "branch";
  branch: { id: string; name: string } | null;
  range: { key: string; start: string; end: string; label: string };
  rows: StockRow[];
  moved_rows: number;
  negatives: number;
  completeness: Completeness;
  branches: { id: string; name: string }[];
  computed_at: string;
  last_movement_date: string;
}
interface LocalPending {
  count: number;
  byItem: Map<string, bigint>;
}

export const STOCK_CACHE = "rep.stock_cache";

/** حركات هذا الجهاز التي لم تُرفع في المدى والفرع: تُشمل موسومةً — إخفاؤها يخالف الرفّ. */
async function localPendingIn(branchId: string, start: string, end: string): Promise<LocalPending> {
  const byItem = new Map<string, bigint>();
  let count = 0;
  try {
    for (const m of await readPendingStockMovements(await getStorage())) {
      if (m.branchId !== branchId) continue;
      const d = m.occurredAt.slice(0, 10);
      if (d < start || d > end) continue;
      count += 1;
      byItem.set(m.itemId, (byItem.get(m.itemId) ?? 0n) + m.deltaMilli);
    }
  } catch {
    /* بلا تخزين محلي — لا معلّق */
  }
  return { count, byItem };
}

const labelOf = (k: RangeKey, custom: { start: string; end: string } | null) =>
  k === "today"
    ? tx(T, "اليوم")
    : k === "yesterday"
      ? tx(T, "أمس")
      : k === "7d"
        ? tx(T, "آخر 7 أيام")
        : k === "30d"
          ? tx(T, "آخر 30 يوماً")
          : custom
            ? custom.start === custom.end
              ? custom.start
              : `${custom.start} – ${custom.end}`
            : tx(T, "مدى مخصَّص");

/**
 * REP-03 — تقرير المخزون والحركات (نظير `stock-report-client.tsx`): كل كمية لها مستند، بوحدة البيع،
 * والسالب لا يُخفى ولا يُصفَّر ويظهر بلونه ومعه المستند؛ حركات هذا الجهاز غير المرفوعة تُشمل موسومة.
 * 403 = العودة إلى أرصدة النطاق (INV-01) كالويب.
 */
export function StockReport() {
  const router = useRouter();
  const c = useColors();
  const { api, state: session } = useSession();
  const [range, setRange] = useState<RangeKey>("30d");
  const [custom, setCustom] = useState<{ start: string; end: string } | null>(null);
  const [branch, setBranch] = useState("");
  const [local, setLocal] = useState<LocalPending>({ count: 0, byItem: new Map() });
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const query: Record<string, string> = { range };
    if (range === "custom" && custom) {
      query.start = custom.start;
      query.end = custom.end;
    }
    if (branch) query.branch_id = branch;
    return fetched<StockPayload>(await api.GET("/api/reports/stock", { params: { query } }));
  }, [api, range, custom, branch]);

  const { p, data, failed, fetching, reload } = useReport<StockPayload>({
    cacheKey: STOCK_CACHE,
    load,
    onForbidden: () => router.replace("/inventory"),
  });

  useEffect(() => {
    if (!data?.branch) return;
    void localPendingIn(data.branch.id, data.range.start, data.range.end).then(setLocal);
  }, [data]);

  const state: State = (() => {
    if (failed && p) return "stale";
    if (!p || (fetching && data === null)) return "loading";
    if (local.count > 0 || !p.completeness.complete) return "pending_sync";
    if (p.moved_rows === 0) return "empty";
    return "ready";
  })();

  const exportCsv = async () => {
    if (!p) return;
    const q = new URLSearchParams({ export: "csv", range: p.range.key });
    if (p.range.key === "custom") {
      q.set("start", p.range.start);
      q.set("end", p.range.end);
    }
    if (branch) q.set("branch_id", branch);
    const body = await fetchFileText(`/api/reports/stock?${q.toString()}`, session.tokens?.access);
    if (body !== null)
      await shareReportFile(body, `stock-${p.range.start}-${p.range.end}.csv`, "csv");
  };

  const syncThenRecompute = async () => {
    setSyncing(true);
    try {
      const storage = await getStorage();
      await pushPending({ api, storage, requestId: newId }, 10, { manual: true });
    } catch {
      /* SYS-01 يبلّغ — نعيد الحساب بما وصل */
    } finally {
      setSyncing(false);
      await reload();
    }
  };

  const rows = (p?.rows ?? []).map((r) => {
    const pend = local.byItem.get(r.item_id) ?? 0n;
    return { ...r, pendMilli: pend, shownMilli: BigInt(r.closing_milli) + pend };
  });

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "التقارير")}
      onRefresh={() => void reload()}
      refreshing={fetching}
    >
      <ReportNav current="stock" />
      <AppText variant="section">{tx(T, "تقرير المخزون والحركات")}</AppText>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(
          T,
          "ما في المخزن وكيف وصل إليه. حركة المخزن والتصدير — كل كمية لها مستند. السالب لا يُخفى ولا يُصفَّر. يظهر بلونه ومعه المستند الذي أنشأه.",
        )}
      </AppText>

      <ChipGroup label={tx(T, "المدى")}>
        <Chip label={tx(T, "اليوم")} on={range === "today"} onPress={() => setRange("today")} />
        <Chip
          label={tx(T, "أمس")}
          on={range === "yesterday"}
          onPress={() => setRange("yesterday")}
        />
        <Chip label={tx(T, "آخر 7 أيام")} on={range === "7d"} onPress={() => setRange("7d")} />
        <Chip label={tx(T, "آخر 30 يوماً")} on={range === "30d"} onPress={() => setRange("30d")} />
        {range === "custom" && custom ? (
          <Chip label={labelOf("custom", custom)} on onPress={() => undefined} />
        ) : null}
      </ChipGroup>
      {p?.branches.length ? (
        <ChipGroup label={tx(T, "الفرع")}>
          {p.branches.map((b) => (
            <Chip
              key={b.id}
              label={b.name}
              on={(branch || p.branch?.id) === b.id}
              onPress={() => setBranch(b.id)}
            />
          ))}
        </ChipGroup>
      ) : null}

      {state === "loading" ? (
        <StateView state="loading" title={tx(T, "جارٍ الجمع")}>
          <AppText variant="secondary">
            {tx(T, "الأرصدة من مواقع متعددة —")} {labelOf(range, custom)}
            {p?.branch ? ` · ${p.branch.name}` : ""}.
          </AppText>
        </StateView>
      ) : null}
      {state === "stale" && p ? (
        <StateView state="stale" title={tx(T, "أرصدة من آخر مطابقة")}>
          <AppText variant="secondary">
            {tx(T, "الأرصدة قديمة")} <Ago iso={p.computed_at} /> {tx(T, "وقد بيع منها. حُسبت في")}{" "}
            <N>{hhmm(p.computed_at)}</N>.
          </AppText>
        </StateView>
      ) : null}
      {state === "empty" && p ? (
        <StateView state="empty" title={tx(T, "لا حركة في المدى")}>
          <AppText variant="secondary">
            {tx(T, "المدى المختار (")}
            {p.range.label}
            {tx(T, ") بلا حركة. الفراغ سببه المرشّح لا المخزون.")}
          </AppText>
          {p.last_movement_date ? (
            <AppText variant="secondary">
              {tx(T, "لا حركة في")} {p.range.label} {tx(T, "— آخر حركة")}{" "}
              <DayCell iso={p.last_movement_date} />.
            </AppText>
          ) : null}
          {p.last_movement_date ? (
            <Button
              variant="secondary"
              label={tx(T, "وسّع المدى")}
              onPress={() => {
                setCustom({ start: p.last_movement_date, end: p.range.end });
                setRange("custom");
              }}
            />
          ) : null}
        </StateView>
      ) : null}
      {state === "pending_sync" && p ? (
        <StateView state="pending_sync" title={tx(T, "حركات لم تُرفع")}>
          {local.count > 0 ? (
            <AppText variant="secondary">
              {tx(T, "على هذا الجهاز")} <N>{local.count}</N>{" "}
              {tx(T, "حركات مخزون معلّقة، والتقرير يشملها موسومةً.")}
            </AppText>
          ) : null}
          {p.completeness.pending_ops > 0 ? (
            <AppText variant="secondary">
              {tx(T, "هذا التقرير لا يشمل")} <N>{p.completeness.pending_ops}</N>{" "}
              {tx(T, "عمليات معلّقة من")}{" "}
              {p.completeness.not_synced
                .filter((d) => d.pending > 0)
                .map((d) => d.device_name)
                .join(` ${tx(T, "و")}`)}
              {tx(T, ". حُسب في")} <N>{hhmm(p.computed_at)}</N>.
            </AppText>
          ) : null}
          <Button
            variant="secondary"
            label={tx(T, "تصدير مع ختم الاكتمال")}
            onPress={() => void exportCsv()}
          />
          <Button
            label={tx(T, "مزامنة ثم إعادة الحساب")}
            onPress={() => void syncThenRecompute()}
            loading={syncing}
          />
        </StateView>
      ) : null}

      {p ? (
        <>
          <View style={{ marginBottom: SPACE["4"], gap: SPACE["1"] }}>
            <AppText variant="bodyStrong">{tx(T, "اكتمال البيانات")}</AppText>
            <AppText variant="secondary">
              {tx(T, "حركة الأصناف —")} {p.range.label}
              {p.branch ? ` · ${p.branch.name}` : ""}
            </AppText>
            <CompletenessBadge
              synced={p.completeness.devices_synced}
              total={p.completeness.devices_total}
              computedAt={p.computed_at}
            />
            <AppText variant="note" muted>
              <DevicesSynced
                synced={p.completeness.devices_synced}
                total={p.completeness.devices_total}
              />{" "}
              {tx(T, "· حُسب في")} <N>{hhmm(p.computed_at)}</N>
              {p.negatives > 0 ? (
                <>
                  {" "}
                  · <Strong>{tx(T, "صنف برصيد سالب")}</Strong>: <N>{p.negatives}</N>
                </>
              ) : null}
            </AppText>
          </View>

          <GroupedList title={tx(T, "حركة الأصناف")}>
            {rows.map((r, i) => {
              const dp = r.unit.decimal_places;
              const neg = r.shownMilli < 0n;
              return (
                <Row
                  key={r.item_id}
                  title={
                    <View>
                      <AppText>{r.name}</AppText>
                      <AppText variant="note" muted>
                        {tx(T, "الصنف والوحدة")}: {r.unit.name}
                      </AppText>
                    </View>
                  }
                  detail={
                    <>
                      {tx(T, "أول المدة")} <N>{formatQty(r.opening_milli, dp)}</N> · {tx(T, "وارد")}{" "}
                      <N>{formatQty(r.in_milli, dp)}</N> · {tx(T, "صادر")}{" "}
                      <N>{formatQty(r.out_milli, dp)}</N>
                      {"\n"}
                      {neg ? (
                        <Text style={{ color: c.danger }}>
                          <Strong>{tx(T, "رصيد سالب")}</Strong> · «{r.name}
                          {tx(T, "» عند")} <N>{formatQty(r.shownMilli, dp)}</N>
                          {tx(
                            T,
                            ": بِيع أكثر مما دخل مسجَّلاً. السبب غالباً إدخال شراء لم يُسجَّل بعد. لا نصفّره ولا نمنع البيع بأثر رجعي — نعرضه حتى يُصحَّح بمستند.",
                          )}
                          {"\n"}
                        </Text>
                      ) : null}
                      {r.tag === "empty" && r.last_movement_at ? (
                        <>
                          {tx(T, "نفد — آخر صرف")} <DayCell iso={r.last_movement_at} />
                        </>
                      ) : r.explain && neg ? (
                        `${r.explain} ${tx(T, "— راجع")} ${r.doc}`
                      ) : (
                        r.doc
                      )}
                      {r.pendMilli !== 0n ? (
                        <>
                          {"\n"}
                          {tx(T, "خادمي")} <N>{formatQty(r.closing_milli, dp)}</N>{" "}
                          {tx(T, "+ معلّق هذا الجهاز")} <N>{formatQty(r.pendMilli, dp)}</N>
                        </>
                      ) : null}
                      {r.last_movement_at ? (
                        <>
                          {"\n"}
                          <N>{hhmm(r.last_movement_at)}</N> <DayCell iso={r.last_movement_at} />
                        </>
                      ) : null}
                    </>
                  }
                  trailing={
                    <View style={{ alignItems: "flex-end" }}>
                      <N
                        style={{ color: neg ? c.danger : c.inkStrong, fontFamily: FONT.monoMedium }}
                      >
                        {formatQty(r.shownMilli, dp)}
                      </N>
                      <AppText variant="note" muted>
                        {tx(T, "الرصيد")}
                      </AppText>
                    </View>
                  }
                  onPress={() => router.push(`/inventory/items/${r.item_id}` as never)}
                  last={i === rows.length - 1}
                />
              );
            })}
          </GroupedList>

          <Button variant="secondary" label={tx(T, "صدِّر CSV")} onPress={() => void exportCsv()} />
        </>
      ) : null}
    </Screen>
  );
}

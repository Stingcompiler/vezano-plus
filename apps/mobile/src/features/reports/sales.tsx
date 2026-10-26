import { formatMinorShort, hhmm, pushPending } from "@sting/app-core";
import { readSales } from "@sting/sync-core";
import { MOBILE_TEXTS, tx } from "@sting/texts";
import { AppText, Button, Chip, GroupedList, Screen, SPACE, StateView } from "@sting/ui-native";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { ChipGroup, CountText, DayCell, N, ReportNav, Row, Strong } from "@/components/reports/ui";
import { Ago } from "@/lib/ago";
import { newId } from "@/lib/crypto";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

import { CompletenessBadge, type Completeness, DevicesSynced } from "./completeness";
import { fetchFileText, shareReportFile } from "./share";
import { MISSING_OPERATIONS } from "./texts";
import { fetched, useReport } from "./use-report";

const T = "REP-01";
type State = "ready" | "loading" | "empty" | "stale" | "pending_sync" | "permission_denied";
type RangeKey = "today" | "yesterday" | "7d" | "30d" | "custom";
type Method = "all" | "cash" | "credit" | "bank";

export interface SalesPayload {
  scope: "all" | "branch";
  branch_name: string;
  can_all_branches: boolean;
  range: { key: string; start: string; end: string; label: string };
  method: Method;
  totals: {
    revenue_minor: string;
    returns_minor: string;
    net_minor: string;
    invoices: number;
    returns_count: number;
    cash_minor: string;
    credit_minor: string;
    bank_minor: string;
    average_minor: string;
  };
  by_branch: {
    id: string;
    name: string;
    revenue_minor: string;
    returns_minor: string;
    invoices: number;
    last_sync_at: string;
    pending: number;
    complete: boolean;
  }[];
  by_day: {
    date: string;
    invoices: number;
    cash_minor: string;
    credit_minor: string;
    bank_minor: string;
    revenue_minor: string;
    returns_minor: string;
    net_minor: string;
  }[];
  completeness: Completeness;
  branches: { id: string; name: string }[];
  computed_at: string;
  last_sale_date: string;
  cost_columns: "phase_locked";
}

interface LocalPending {
  count: number;
  totalMinor: bigint;
}

export const SALES_CACHE = "rep.sales_cache";

/** معلّق هذا الجهاز في المدى: يُضاف إلى الأرقام موسوماً — الخادم لا يراه بعد. */
async function localPendingIn(start: string, end: string): Promise<LocalPending> {
  try {
    const storage = await getStorage();
    const sales = await readSales(storage);
    let count = 0;
    let total = 0n;
    for (const s of sales) {
      const d = s.business_date.slice(0, 10);
      if (d < start || d > end) continue;
      const op = await storage.read((t) => t.getOperation(s.operation_id));
      const st = op?.state ?? "local";
      if (st !== "local" && st !== "pending") continue;
      count += 1;
      total += BigInt(s.total_minor);
    }
    return { count, totalMinor: total };
  } catch {
    return { count: 0, totalMinor: 0n };
  }
}

/**
 * REP-01 — تقرير المبيعات — الرقم ومعه وقته (نظير `sales-report-client.tsx`): المدى والفرع والوسيلة
 * شرائح، سطر الاكتمال في الرأس، معلّق هذا الجهاز يُضاف موسوماً، والأرقام صفوف. لا عمود تكلفة ولا
 * هامش (G-03). الفشل أو انقطاع الشبكة = آخر ردّ محفوظ بحالة stale.
 */
export function SalesReport() {
  const { api, state: session } = useSession();
  const [range, setRange] = useState<RangeKey>("today");
  const [custom, setCustom] = useState<{ start: string; end: string } | null>(null);
  const [branch, setBranch] = useState("");
  const [allBranches, setAllBranches] = useState(true);
  const [method, setMethod] = useState<Method>("all");
  const [compareDenied, setCompareDenied] = useState(false);
  const [local, setLocal] = useState<LocalPending>({ count: 0, totalMinor: 0n });
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const query: Record<string, string> = { range, method };
    if (range === "custom" && custom) {
      query.start = custom.start;
      query.end = custom.end;
    }
    if (branch && allBranches === false) query.branch_id = branch;
    return fetched<SalesPayload>(await api.GET("/api/reports/sales", { params: { query } }));
  }, [api, range, custom, branch, allBranches, method]);

  const { p, data, failed, fetching, denied, reload } = useReport<SalesPayload>({
    cacheKey: SALES_CACHE,
    load,
  });

  useEffect(() => {
    if (!data) return;
    void localPendingIn(data.range.start, data.range.end).then(setLocal);
  }, [data]);

  const otherPending = p ? p.completeness.pending_ops : 0;
  const incomplete = p ? !p.completeness.complete : false;
  const state: State = denied
    ? "permission_denied"
    : failed && p
      ? "stale"
      : !p || (fetching && data === null)
        ? "loading"
        : incomplete || local.count > 0
          ? "pending_sync"
          : p.totals.invoices === 0
            ? "empty"
            : "ready";
  const showDenied = state === "permission_denied" || compareDenied;

  const exportCsv = async () => {
    if (!p) return;
    const q = new URLSearchParams({ export: "csv", range: p.range.key, method });
    if (p.range.key === "custom") {
      q.set("start", p.range.start);
      q.set("end", p.range.end);
    }
    if (branch && !allBranches) q.set("branch_id", branch);
    const body = await fetchFileText(`/api/reports/sales?${q.toString()}`, session.tokens?.access);
    if (body !== null)
      await shareReportFile(body, `sales-${p.range.start}-${p.range.end}.csv`, "csv");
  };

  const syncThenRecompute = async () => {
    setSyncing(true);
    try {
      const storage = await getStorage();
      await pushPending({ api, storage, requestId: newId }, 10, { manual: true });
    } catch {
      /* المزامنة تُبلغ في SYS-01 — هنا نعيد الحساب بما وصل */
    } finally {
      setSyncing(false);
      await reload();
    }
  };

  const revenue = p ? BigInt(p.totals.revenue_minor) + local.totalMinor : 0n;
  const invoices = p ? p.totals.invoices + local.count : 0;
  const branchesSynced = p ? p.by_branch.filter((b) => b.complete).length : 0;
  const branchChips = p?.branches ?? [];
  const canCompare = p?.can_all_branches ?? false;
  const rangeText =
    range === "today"
      ? tx(T, "اليوم")
      : range === "yesterday"
        ? tx(T, "أمس")
        : range === "7d"
          ? tx(T, "آخر 7 أيام")
          : range === "30d"
            ? tx(T, "آخر 30 يوماً")
            : tx(T, "مدى مخصَّص");

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "التقارير")}
      onRefresh={() => void reload()}
      refreshing={fetching}
    >
      <ReportNav current="sales" />
      <AppText variant="section" style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "تقرير المبيعات — الرقم ومعه وقته")}
      </AppText>

      <ChipGroup label={tx(T, "الفترة")}>
        <Chip label={tx(T, "اليوم")} on={range === "today"} onPress={() => setRange("today")} />
        <Chip
          label={tx(T, "أمس")}
          on={range === "yesterday"}
          onPress={() => setRange("yesterday")}
        />
        <Chip label={tx(T, "آخر 7 أيام")} on={range === "7d"} onPress={() => setRange("7d")} />
        <Chip label={tx(T, "آخر 30 يوماً")} on={range === "30d"} onPress={() => setRange("30d")} />
        {range === "custom" && custom ? (
          <Chip
            label={custom.start === custom.end ? custom.start : `${custom.start} – ${custom.end}`}
            on
            onPress={() => undefined}
          />
        ) : null}
      </ChipGroup>
      <ChipGroup label={tx(T, "الفرع")}>
        <Chip
          label={tx(T, "كل الفروع")}
          on={allBranches && !compareDenied}
          onPress={() => {
            if (canCompare) {
              setCompareDenied(false);
              setAllBranches(true);
              setBranch("");
            } else setCompareDenied(true);
          }}
        />
        {canCompare ? (
          branchChips.map((b) => (
            <Chip
              key={b.id}
              label={b.name}
              on={!allBranches && branch === b.id}
              onPress={() => {
                setCompareDenied(false);
                setAllBranches(false);
                setBranch(b.id);
              }}
            />
          ))
        ) : p?.branch_name ? (
          <Chip label={p.branch_name} on={!compareDenied} onPress={() => setCompareDenied(false)} />
        ) : null}
      </ChipGroup>
      <ChipGroup label={tx(T, "وسيلة الدفع")}>
        <Chip
          label={tx(T, "كل وسائل الدفع")}
          on={method === "all"}
          onPress={() => setMethod("all")}
        />
        <Chip label={tx(T, "نقد")} on={method === "cash"} onPress={() => setMethod("cash")} />
        <Chip label={tx(T, "آجل")} on={method === "credit"} onPress={() => setMethod("credit")} />
        <Chip label={tx(T, "تحويل")} on={method === "bank"} onPress={() => setMethod("bank")} />
      </ChipGroup>

      {showDenied ? (
        <StateView state="permission_denied" title={tx(T, "مدير الفرع يرى فرعه")}>
          <AppText variant="secondary">
            {tx(T, "يرى أرقام فرعه كاملةً ولا يرى الفروع الأخرى ولا المقارنة بينها.")}
          </AppText>
          <AppText variant="secondary">
            {denied
              ? `${tx(T, "التقرير للمالك ومدير الفرع —")} ${denied.role || tx(T, "هذا الدور")} ${tx(T, "يرى نطاقه في قائمة الفواتير.")}`
              : `${tx(T, "تُعرض أرقام")} ${p?.branch_name || tx(T, "فرعك")} ${tx(T, "— المقارنة بين الفروع للمالك.")}`}
          </AppText>
        </StateView>
      ) : null}
      {state === "loading" ? (
        <StateView state="loading" title={tx(T, "جارٍ الحساب")}>
          <AppText variant="secondary">
            {tx(T, "التقرير يُحسب لا يُقرأ جاهزاً —")} {rangeText}
            {branchChips.length ? (
              <>
                {" "}
                · <N>{branchChips.length}</N> {tx(T, "فروع")}
              </>
            ) : null}
            .
          </AppText>
          <AppText variant="secondary">
            {tx(T, "المرشّحات فعّالة")} {tx(T, "· تغييرها أثناء الحساب يعيد الطلب لا ينتظره.")}
          </AppText>
        </StateView>
      ) : null}
      {state === "stale" && p ? (
        <StateView state="stale" title={tx(T, "أرقام من آخر مطابقة")}>
          <AppText variant="secondary">
            {tx(T, "لا اتصال الآن، والتقرير من بيانات الجهاز المحلية. حُسب في")}{" "}
            <N>{hhmm(p.computed_at)}</N>.
          </AppText>
        </StateView>
      ) : null}
      {state === "empty" && p ? (
        <StateView state="empty" title={tx(T, "لا مبيعات في المدى")}>
          <AppText variant="secondary">
            {tx(T, "المدى المختار بلا فواتير. السبب المرشّح غالباً لا انعدام البيع.")}
          </AppText>
          {p.last_sale_date ? (
            <AppText variant="secondary">
              {tx(T, "لا مبيعات في")} {p.range.label} {tx(T, "— آخر بيع")}{" "}
              <DayCell iso={p.last_sale_date} />.
            </AppText>
          ) : null}
          {p.last_sale_date ? (
            <Button
              variant="secondary"
              label={tx(T, "نقترح المدى الأقرب")}
              onPress={() => {
                setCustom({ start: p.last_sale_date, end: p.last_sale_date });
                setRange("custom");
              }}
            />
          ) : null}
        </StateView>
      ) : null}
      {state === "pending_sync" && p ? (
        <StateView state="pending_sync" title={tx(T, "ناقص معلوم")}>
          {otherPending > 0 ? (
            <AppText variant="secondary">
              {tx(T, "هذا التقرير لا يشمل")} <N>{otherPending}</N> {tx(T, "عمليات معلّقة من")}{" "}
              {p.completeness.not_synced
                .filter((d) => d.pending > 0)
                .map((d) => d.device_name)
                .join(` ${tx(T, "و")}`)}
              {tx(T, ". حُسب في")} <N>{hhmm(p.computed_at)}</N>{" "}
              {tx(T, ". طبعه الآن يعني طبع رقم ناقص تعرف مقداره.")}
            </AppText>
          ) : null}
          {local.count > 0 ? (
            <AppText variant="secondary">
              {tx(T, "يشمل")} <N>{local.count}</N> {tx(T, "عمليات معلّقة من هذا الجهاز بقيمة")}{" "}
              <N>{formatMinorShort(local.totalMinor)}</N>{" "}
              {tx(T, "— موسومة «معلّق هذا الجهاز» حتى تُرفع.")}
            </AppText>
          ) : null}
          <AppText variant="note" muted>
            {tx(
              T,
              "الملف المصدَّر يحمل في ترويسته سطر الاكتمال نفسه — لا تفقده الورقة حين تخرج من الشاشة.",
            )}
          </AppText>
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

      {p && state !== "permission_denied" ? (
        <>
          <View style={{ marginBottom: SPACE["4"], gap: SPACE["1"] }}>
            <AppText variant="bodyStrong">{tx(T, "اكتمال البيانات")}</AppText>
            <CompletenessBadge
              synced={p.completeness.devices_synced}
              total={p.completeness.devices_total}
              computedAt={p.computed_at}
            />
            <AppText variant="secondary">
              <DevicesSynced
                synced={p.completeness.devices_synced}
                total={p.completeness.devices_total}
              />
              .
              {p.completeness.not_synced.map((d) => (
                <AppText key={d.device_name} variant="secondary">
                  {" "}
                  {tx(T, "جهاز")} {d.branch_name} ({d.device_name}
                  {tx(T, ") لم يُزامن")}{" "}
                  {d.last_seen_at ? (
                    <>
                      {tx(T, "منذ")} <Ago iso={d.last_seen_at} />
                    </>
                  ) : (
                    tx(T, "بعد")
                  )}
                  {d.pending > 0 ? (
                    <>
                      {" "}
                      · <N>{d.pending}</N> {tx(T, "معلّقة")}
                    </>
                  ) : null}{" "}
                  {tx(T, "— أرقام هذا التقرير تنقصها مبيعاته.")}
                </AppText>
              ))}
            </AppText>
            <AppText variant="note" muted>
              {tx(T, "المبيعات —")} {p.range.label} {tx(T, "· حُسب في")}{" "}
              <N>{hhmm(p.computed_at)}</N>
              {p.scope === "branch" && p.branch_name ? ` · ${p.branch_name}` : ""}
            </AppText>
          </View>

          <GroupedList>
            <Row
              title={tx(T, "الإيراد")}
              detail={
                <>
                  {p.completeness.devices_total === 0 ? (
                    tx(T, "لا جهاز بيع بعد")
                  ) : branchesSynced === 0 ? (
                    tx(T, "لم يزامن أي فرع بعد")
                  ) : branchesSynced === 1 ? (
                    tx(T, "من فرع واحد زامن")
                  ) : branchesSynced === 2 ? (
                    tx(T, "من فرعين زامنا")
                  ) : (
                    <>
                      {tx(T, "من")}{" "}
                      <CountText
                        n={branchesSynced}
                        forms={{
                          one: MOBILE_TEXTS.branchesOne,
                          two: MOBILE_TEXTS.branchesTwo,
                          few: MOBILE_TEXTS.branchesFew,
                          many: MOBILE_TEXTS.branchesMany,
                        }}
                      />{" "}
                      {tx(T, "زامنت")}
                    </>
                  )}
                  {local.count > 0 ? ` ${tx(T, "· يشمل معلّق هذا الجهاز")}` : ""}
                </>
              }
              trailing={<N>{formatMinorShort(revenue)}</N>}
            />
            <Row
              title={tx(T, "المرتجعات")}
              detail={
                <>
                  <N>{p.totals.returns_count}</N> {tx(T, "مرتجعات")}
                </>
              }
              trailing={<N>{formatMinorShort(p.totals.returns_minor)}</N>}
            />
            <Row
              title={tx(T, "عدد الفواتير")}
              detail={
                <>
                  {tx(T, "متوسط")}{" "}
                  <N>
                    {formatMinorShort(
                      invoices ? (revenue * 2n + BigInt(invoices)) / (2n * BigInt(invoices)) : 0n,
                    )}
                  </N>
                </>
              }
              trailing={<N>{invoices}</N>}
              last
            />
          </GroupedList>

          <GroupedList title={tx(T, "المبيعات حسب الفرع")}>
            {p.by_branch.map((b, i) => (
              <Row
                key={b.id}
                title={b.name}
                detail={
                  <>
                    {tx(T, "آخر مزامنة")}:{" "}
                    {!b.last_sync_at ? (
                      tx(T, "لم يزامن بعد")
                    ) : b.complete ? (
                      <>
                        {tx(T, "مكتمل ·")} <Ago iso={b.last_sync_at} />
                      </>
                    ) : (
                      <>
                        {b.pending > 0 ? (
                          <>
                            {tx(T, "ناقص")} <CountText n={b.pending} forms={MISSING_OPERATIONS} />
                          </>
                        ) : (
                          tx(T, "غير مكتمل — عدد العمليات الناقصة غير معروف")
                        )}{" "}
                        · <Ago iso={b.last_sync_at} />
                      </>
                    )}
                  </>
                }
                trailing={
                  <View style={{ alignItems: "flex-end" }}>
                    <N>{formatMinorShort(b.revenue_minor)}</N>
                    <AppText variant="note" muted>
                      {tx(T, "المرتجعات")} <N>{formatMinorShort(b.returns_minor)}</N>
                    </AppText>
                  </View>
                }
                last={i === p.by_branch.length - 1}
              />
            ))}
          </GroupedList>

          {p.by_day.length ? (
            <GroupedList title={tx(T, "المبيعات حسب اليوم")}>
              {p.by_day.map((d, i) => (
                <Row
                  key={d.date}
                  title={<DayCell iso={d.date} />}
                  detail={
                    <>
                      {tx(T, "فواتير")} <N>{d.invoices}</N> · {tx(T, "نقد")}{" "}
                      <N>{formatMinorShort(d.cash_minor)}</N> · {tx(T, "آجل")}{" "}
                      <N>{formatMinorShort(d.credit_minor)}</N> · {tx(T, "مرتجعات")}{" "}
                      <N>{formatMinorShort(d.returns_minor)}</N>
                    </>
                  }
                  trailing={
                    <View style={{ alignItems: "flex-end" }}>
                      <N>{formatMinorShort(d.net_minor)}</N>
                      <AppText variant="note" muted>
                        {tx(T, "الصافي")}
                      </AppText>
                    </View>
                  }
                  last={i === p.by_day.length - 1}
                />
              ))}
            </GroupedList>
          ) : null}

          <View style={{ marginBottom: SPACE["4"] }}>
            <Button
              variant="secondary"
              label={tx(T, "صدِّر CSV")}
              onPress={() => void exportCsv()}
            />
          </View>
          <AppText variant="note" muted>
            <Strong>{tx(T, "لا عمود تكلفة ولا هامش هنا")}</Strong>
            {tx(
              T,
              ": الإيراد والمرتجعات ووسائل الدفع أساسية، والتكلفة تحتاج سياسة معتمدة وتظهر في «تقرير الهامش» مقفلةً حتى تُعتمد.",
            )}
          </AppText>
        </>
      ) : null}
    </Screen>
  );
}

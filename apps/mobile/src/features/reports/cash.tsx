import { dayMonth, formatMinorShort, hhmm } from "@sting/app-core";
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
import { useCallback, useState } from "react";
import { Text, View } from "react-native";

import { ChipGroup, N, ReportNav, Row, Strong } from "@/components/reports/ui";
import { Ago } from "@/lib/ago";
import { nativeRoute } from "@/lib/routes";
import { useSession } from "@/lib/session";
import { openOnWeb } from "@/lib/web";

import { CompletenessBadge, type Completeness, DevicesSynced } from "./completeness";
import { fetchFileText, shareReportFile } from "./share";
import { fetched, useReport } from "./use-report";

const T = "REP-04";
type State = "ready" | "loading" | "empty" | "conflict" | "stale";
type RangeKey = "today" | "yesterday" | "7d" | "30d";

interface Conflict {
  quarantine_id: string;
  device_name: string;
  counted_by_name: string;
  counted_cash_minor: string;
  expected_cash_at_close_minor: string;
  occurred_at: string;
  received_at: string;
}
interface ShiftRow {
  id: string;
  branch_name: string;
  device_name: string;
  user_name: string;
  opened_at: string;
  closed_at: string;
  count_status: string;
  expected_cash_at_close_minor: string;
  counted_cash_minor: string;
  counted_by_name: string;
  witness_name: string;
  variance_minor: string;
  reviewed: boolean;
  reviewed_by_name: string;
  conflict: Conflict | null;
}
export interface CashPayload {
  scope: "all" | "branch";
  branch_name: string;
  can_all_branches: boolean;
  range: { key: string; start: string; end: string; label: string };
  rows: ShiftRow[];
  totals: {
    shifts: number;
    counted: number;
    not_counted: number;
    variance_minor: string;
    over_minor: string;
    short_minor: string;
    unreviewed_variances: number;
    excluded_conflicts: number;
  };
  open_shifts: {
    id: string;
    branch_name: string;
    user_name: string;
    opened_at: string;
    open_hours: number;
    abandoned: boolean;
  }[];
  completeness: Completeness;
  branches: { id: string; name: string }[];
  computed_at: string;
  last_closed_date: string;
}

export const CASH_CACHE = "rep.cash_cache";

const signed = (minor: string) => {
  const v = BigInt(minor);
  return v > 0n ? `+${formatMinorShort(v)}` : formatMinorShort(v);
};

/** «12 تشرين 14:05» — اليوم والوقت mono والشهر عربي. */
function When({ iso }: { iso: string }) {
  if (!iso) return <>—</>;
  const { day, month } = dayMonth(iso);
  return (
    <>
      <N>{day}</N> {month} <N>{hhmm(iso)}</N>
    </>
  );
}

/**
 * REP-04 — تقرير الصندوق والورديات (نظير `cash-report-client.tsx`): المتوقَّع مقابل المعدود عبر الورديات
 * المغلقة وحدها؛ وردية أُقفلت على جهازين بمبلغين = `conflict`: لا نجمع ولا نرجّح، النسختان تُعرضان
 * ويُستثنى الصفّ من المجموع (SHIFT-05). 403 = العودة إلى الوردية الحالية كالويب.
 */
export function CashReport() {
  const router = useRouter();
  const c = useColors();
  const { api, state: session } = useSession();
  const [range, setRange] = useState<RangeKey>("7d");
  const [branch, setBranch] = useState("");

  const load = useCallback(async () => {
    const query: Record<string, string> = { range };
    if (branch) query.branch_id = branch;
    return fetched<CashPayload>(await api.GET("/api/reports/cash", { params: { query } }));
  }, [api, range, branch]);
  const { p, data, failed, fetching, reload } = useReport<CashPayload>({
    cacheKey: CASH_CACHE,
    load,
    onForbidden: () => router.replace("/shifts/current"),
  });

  const state: State = (() => {
    if ((failed || (p && !p.completeness.complete)) && p) return "stale";
    if (!p || (fetching && data === null)) return "loading";
    if (p.totals.excluded_conflicts > 0) return "conflict";
    if (p.rows.length === 0) return "empty";
    return "ready";
  })();

  const exportCsv = async () => {
    if (!p) return;
    const q = new URLSearchParams({ export: "csv", range: p.range.key });
    if (branch) q.set("branch_id", branch);
    const body = await fetchFileText(`/api/reports/cash?${q.toString()}`, session.tokens?.access);
    if (body !== null)
      await shareReportFile(body, `cash-${p.range.start}-${p.range.end}.csv`, "csv");
  };

  const openReview = () => {
    const href = nativeRoute("/sync/review");
    if (href) router.push(href);
    else void openOnWeb("/sync/review");
  };

  const conflicts = p ? p.rows.filter((r) => r.conflict) : [];

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "التقارير")}
      onRefresh={() => void reload()}
      refreshing={fetching}
    >
      <ReportNav current="cash" />
      <AppText variant="section">{tx(T, "تقرير الصندوق والورديات")}</AppText>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "النقد المتوقَّع مقابل المعدود عبر الورديات.")}
      </AppText>

      <ChipGroup label={tx(T, "المدى")}>
        <Chip label={tx(T, "اليوم")} on={range === "today"} onPress={() => setRange("today")} />
        <Chip
          label={tx(T, "أمس")}
          on={range === "yesterday"}
          onPress={() => setRange("yesterday")}
        />
        <Chip label={tx(T, "ورديات الأسبوع")} on={range === "7d"} onPress={() => setRange("7d")} />
        <Chip label={tx(T, "آخر 30 يوماً")} on={range === "30d"} onPress={() => setRange("30d")} />
      </ChipGroup>
      {p?.branches.length ? (
        <ChipGroup label={tx(T, "الفرع")}>
          <Chip label={tx(T, "كل الفروع")} on={!branch} onPress={() => setBranch("")} />
          {p.branches.map((b) => (
            <Chip key={b.id} label={b.name} on={branch === b.id} onPress={() => setBranch(b.id)} />
          ))}
        </ChipGroup>
      ) : null}

      {state === "loading" ? (
        <StateView state="loading" title={tx(T, "جارٍ التجميع")}>
          <AppText variant="secondary">
            {tx(T, "يُجمع من ورديات مغلقة وحدها. المفتوحة لا تدخل — وردية بلا عدّ ليس لها فارق.")}
          </AppText>
        </StateView>
      ) : null}
      {state === "stale" && p ? (
        <StateView state="stale" title={tx(T, "ناقص معلوم")}>
          {failed ? (
            <AppText variant="secondary">
              {tx(T, "الأرقام من آخر مطابقة — حُسب في")} <N>{hhmm(p.computed_at)}</N>{" "}
              {tx(T, ". طبعه الآن يعني طبع رقم ناقص تعرف مقداره.")}
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
              {tx(T, ". حُسب في")} <N>{hhmm(p.computed_at)}</N>{" "}
              {tx(T, ". طبعه الآن يعني طبع رقم ناقص تعرف مقداره.")}
            </AppText>
          ) : null}
          <AppText variant="note" muted>
            {tx(
              T,
              "الملف المصدَّر يحمل في ترويسته سطر الاكتمال نفسه — لا تفقده الورقة حين تخرج من الشاشة.",
            )}
          </AppText>
        </StateView>
      ) : null}
      {state === "empty" && p ? (
        <StateView state="empty" title={tx(T, "لا ورديات مغلقة")}>
          <AppText variant="secondary">{tx(T, "الورديات مفتوحة أو لم تبدأ بعد.")}</AppText>
          {p.open_shifts.length ? (
            <AppText variant="secondary">
              <Strong>{tx(T, "المخرج")}</Strong> ·{" "}
              {p.open_shifts.map((o) => (
                <Text key={o.id}>
                  {tx(T, "وردية")} {o.user_name} — {o.branch_name} {tx(T, "مفتوحة منذ")}{" "}
                  <Ago iso={o.opened_at} />
                  {o.abandoned ? ` ${tx(T, "— إقفال مهجور")}` : ""}.{" "}
                </Text>
              ))}
            </AppText>
          ) : null}
        </StateView>
      ) : null}
      {state === "conflict" && p ? (
        <StateView state="conflict" title={tx(T, "وردية بعدّين مختلفين")}>
          <AppText variant="secondary">
            {tx(T, "وردية أُقفلت على جهازين بمبلغين مختلفين — عُدّت مرتين والنسختان في الدفتر.")}
          </AppText>
          <AppText variant="secondary">
            <Strong>{tx(T, "لا نجمع ولا نرجّح")}</Strong>{" "}
            {tx(
              T,
              "· لا نأخذ المتوسط ولا الأحدث. تُعرض النسختان باسم من عدّ ووقته، وتُحال إلى «مراجعة التعارضات».",
            )}
          </AppText>
          <AppText variant="secondary">
            <Strong>{tx(T, "الصفّ يُستثنى من المجموع")}</Strong> ·{" "}
            {p.totals.excluded_conflicts === 1 ? (
              tx(T, "«وردية واحدة خارج المجموع — بانتظار الحسم»")
            ) : (
              <>
                <N>{p.totals.excluded_conflicts}</N> {tx(T, "ورديات خارج المجموع — بانتظار الحسم")}
              </>
            )}
            .
          </AppText>
          {conflicts.map((r) => (
            <AppText key={r.id} variant="note">
              {r.user_name} — {r.branch_name}
              {tx(T, ": النسخة الأولى")} <N>{formatMinorShort(r.counted_cash_minor || "0")}</N>{" "}
              {tx(T, "عدّها")} {r.counted_by_name || r.user_name} {tx(T, "على")} {r.device_name}{" "}
              {tx(T, "في")} <N>{hhmm(r.closed_at)}</N> {tx(T, "· النسخة الثانية")}{" "}
              <N>{formatMinorShort(r.conflict?.counted_cash_minor || "0")}</N> {tx(T, "عدّها")}{" "}
              {r.conflict?.counted_by_name || "—"} {tx(T, "على")}{" "}
              {r.conflict?.device_name || tx(T, "جهاز آخر")} {tx(T, "في")}{" "}
              <N>{r.conflict ? hhmm(r.conflict.occurred_at) : "—"}</N>
            </AppText>
          ))}
          <Button
            variant="secondary"
            label={tx(T, "الحسم في مراجعة التعارضات")}
            onPress={openReview}
          />
        </StateView>
      ) : null}

      {p && state !== "empty" ? (
        <>
          <AppText variant="bodyStrong">{tx(T, "الفوارق")}</AppText>
          <AppText variant="secondary" style={{ marginBottom: SPACE["2"] }}>
            {tx(T, "ورديات الأسبوع —")} {p.range.label}
          </AppText>
          <GroupedList>
            <Row
              title={tx(T, "صافي الفوارق")}
              detail={
                <>
                  {tx(T, "من")} <N>{p.totals.counted}</N> {tx(T, "وردية معدودة")}
                  {p.totals.excluded_conflicts > 0 ? (
                    <>
                      {" "}
                      · <N>{p.totals.excluded_conflicts}</N> {tx(T, "خارج المجموع")}
                    </>
                  ) : null}
                </>
              }
              trailing={<N>{signed(p.totals.variance_minor)}</N>}
            />
            <Row
              title={tx(T, "عجز")}
              detail={
                <>
                  <N>{p.totals.unreviewed_variances}</N> {tx(T, "فرق لم يُراجَع")}
                </>
              }
              trailing={<N>{formatMinorShort(p.totals.short_minor)}</N>}
            />
            <Row
              title={tx(T, "زيادة")}
              detail={
                <>
                  <N>{p.totals.not_counted}</N> {tx(T, "بلا عدّ")}
                </>
              }
              trailing={<N>{formatMinorShort(p.totals.over_minor)}</N>}
              last
            />
          </GroupedList>
          <View style={{ marginBottom: SPACE["4"], gap: SPACE["1"] }}>
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
            </AppText>
          </View>

          <GroupedList title={tx(T, "الورديات المغلقة")}>
            {p.rows.map((r, i) => (
              <Row
                key={r.id}
                title={`${r.user_name} — ${r.branch_name}`}
                detail={
                  <>
                    <When iso={r.closed_at} /> · {r.device_name}
                    {"\n"}
                    {tx(T, "المتوقَّع")}{" "}
                    <N>
                      {r.expected_cash_at_close_minor
                        ? formatMinorShort(r.expected_cash_at_close_minor)
                        : "—"}
                    </N>{" "}
                    · {tx(T, "المعدود")}{" "}
                    <N>{r.counted_cash_minor ? formatMinorShort(r.counted_cash_minor) : "—"}</N>
                    {"\n"}
                    {tx(T, "من عدّ")}: {r.counted_by_name || "—"}
                    {r.witness_name ? ` · ${tx(T, "شاهد:")} ${r.witness_name}` : ""}
                    {r.reviewed ? ` · ${tx(T, "رُوجع بواسطة")} ${r.reviewed_by_name}` : ""}
                  </>
                }
                trailing={
                  <View style={{ alignItems: "flex-end", maxWidth: 140 }}>
                    {r.conflict ? (
                      <AppText variant="note" style={{ color: c.state.conflict.fg }}>
                        {tx(T, "خارج المجموع — بانتظار الحسم")}
                      </AppText>
                    ) : r.variance_minor ? (
                      <N
                        style={{ color: r.variance_minor.startsWith("-") ? c.danger : c.inkStrong }}
                      >
                        {signed(r.variance_minor)}
                      </N>
                    ) : (
                      <AppText variant="note" muted>
                        {tx(T, "بلا عدّ")}
                      </AppText>
                    )}
                    <AppText variant="note" muted>
                      {tx(T, "الفارق")}
                    </AppText>
                  </View>
                }
                onPress={() => {
                  const href = nativeRoute("/shifts/review");
                  router.push(href ?? "/shifts/review");
                }}
                last={i === p.rows.length - 1}
              />
            ))}
          </GroupedList>
          <Button
            variant="secondary"
            label={tx(T, "تصدير مع ختم الاكتمال")}
            onPress={() => void exportCsv()}
          />
        </>
      ) : null}
    </Screen>
  );
}

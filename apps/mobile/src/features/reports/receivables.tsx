import { formatMinorShort, hhmm } from "@sting/app-core";
import { tx } from "@sting/texts";
import { AppText, Button, Chip, GroupedList, Screen, SPACE, StateView } from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { ChipGroup, DayCell, N, ReportNav, Row, Strong } from "@/components/reports/ui";
import { Ago } from "@/lib/ago";
import { useSession } from "@/lib/session";

import { fetchFileText, shareReportFile } from "./share";
import { fetched, useReport } from "./use-report";

const T = "REP-02";
type State = "ready" | "loading" | "empty" | "stale" | "permission_denied";
type Side = "customers" | "suppliers";

interface PartyRow {
  id: string;
  name: string;
  balance_minor: string;
  last_payment_date: string;
  oldest_unpaid_date: string;
  invoices: number;
  source: string;
}
export interface ReceivablesPayload {
  side: Side;
  scope: "all";
  rows: PartyRow[];
  totals: { balance_minor: string; parties: number };
  computed_at: string;
  ageing: "disabled";
}

export const RECEIVABLES_CACHE = "rep.receivables_cache";

function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** «اليوم» أو اليوم والشهر؛ بلا تاريخ تظهر الكلمة المعطاة. */
function DateText({ iso, none }: { iso: string; none: string }) {
  if (!iso) return <>{none}</>;
  if (iso === localIso(new Date())) return <>{tx(T, "اليوم")}</>;
  return <DayCell iso={iso} />;
}

/**
 * REP-02 — تقرير الذمم (نظير `receivables-report-client.tsx`): قائمة أطراف مرتّبة بالرصيد وآخر سداد
 * وأقدم حركة غير مسددة — بلا أعمار ديون مخترَعة (G-15). الكاشير يُمنع (403) وتبقى كلمة السبب.
 */
export function ReceivablesReport() {
  const router = useRouter();
  const { api, state: session } = useSession();
  const [side, setSide] = useState<Side>("customers");

  const load = useCallback(
    async () =>
      fetched<ReceivablesPayload>(
        await api.GET("/api/reports/receivables", { params: { query: { side } } }),
      ),
    [api, side],
  );
  const { p, data, cached, failed, fetching, denied, reload } = useReport<ReceivablesPayload>({
    cacheKey: RECEIVABLES_CACHE,
    load,
    accept: (c) => c.side === side,
    resetOnChange: true,
  });

  const state: State = denied
    ? "permission_denied"
    : failed && p
      ? "stale"
      : !p || (fetching && data === null)
        ? "loading"
        : p.rows.length === 0
          ? "empty"
          : "ready";
  const expectedCount = cached?.totals.parties ?? 0;
  const sideLabel = side === "customers" ? tx(T, "على العملاء") : tx(T, "لنا على الموردين");

  const exportCsv = async () => {
    const body = await fetchFileText(
      `/api/reports/receivables?side=${side}&export=csv`,
      session.tokens?.access,
    );
    if (body !== null) await shareReportFile(body, `receivables-${side}.csv`, "csv");
  };

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "التقارير")}
      onRefresh={() => void reload()}
      refreshing={fetching}
    >
      <ReportNav current="receivables" />
      <AppText variant="section">{tx(T, "تقرير الذمم — بلا تقادم مخترَع")}</AppText>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "آخر سداد وأقدم حركة غير مسددة، لا جدول أعمار.")}
      </AppText>

      <ChipGroup label={tx(T, "الجهة")}>
        <Chip
          label={tx(T, "على العملاء")}
          on={side === "customers"}
          onPress={() => setSide("customers")}
        />
        <Chip
          label={tx(T, "لنا على الموردين")}
          on={side === "suppliers"}
          onPress={() => setSide("suppliers")}
        />
      </ChipGroup>
      <ChipGroup label={tx(T, "الفرع")}>
        <Chip label={tx(T, "كل الفروع")} on onPress={() => undefined} />
      </ChipGroup>
      {state !== "permission_denied" ? (
        <View style={{ marginBottom: SPACE["4"] }}>
          <Button variant="secondary" label={tx(T, "تصدير")} onPress={() => void exportCsv()} />
        </View>
      ) : null}

      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "الكاشير يرى زبائنه")}>
          <AppText variant="secondary">
            {tx(T, "الكاشير يرى رصيد الطرف الذي يبيع له وقت البيع، ولا يرى تقرير الذمم كاملاً.")}
          </AppText>
          <AppText variant="secondary">
            <Strong>{tx(T, "لماذا")}</Strong>{" "}
            {tx(
              T,
              "· التقرير الكامل صورةٌ مالية للمنشأة كلها. رؤية رصيد زبون أمامك حاجةُ عمل، ورؤية الجميع ليست كذلك.",
            )}
            {denied?.role ? ` ${tx(T, "دورك:")} ${denied.role}.` : ""}
          </AppText>
        </StateView>
      ) : null}
      {state === "loading" ? (
        <StateView state="loading" title={tx(T, "جارٍ الحساب")}>
          <AppText variant="secondary">
            {tx(T, "الذمم تُحسب من كل الحركات لا تُقرأ جاهزة.")}
            {expectedCount ? (
              <>
                {" "}
                <N>{expectedCount}</N> {tx(T, "طرفاً في آخر قائمة.")}
              </>
            ) : null}
          </AppText>
        </StateView>
      ) : null}
      {state === "stale" && p ? (
        <StateView state="stale" title={tx(T, "الذمم من آخر مطابقة")}>
          <AppText variant="secondary">
            {tx(T, "محسوبة")} <Ago iso={p.computed_at} /> (<N>{hhmm(p.computed_at)}</N>
            {tx(T, "). سدادٌ وقع في فرعٍ لم يُزامن لا يظهر هنا.")}
          </AppText>
          <AppText variant="secondary">
            <Strong>{tx(T, "الخطر المحدد")}</Strong> {tx(T, "· أن تطالب زبوناً سدّد.")}
          </AppText>
        </StateView>
      ) : null}
      {state === "empty" ? (
        <StateView state="empty" title={tx(T, "لا ذمم")}>
          <AppText variant="secondary">
            {side === "customers"
              ? tx(T, "لا ذمم مفتوحة على العملاء.")
              : tx(T, "لا مستحقات مفتوحة على الموردين.")}
          </AppText>
        </StateView>
      ) : null}

      {p && state !== "permission_denied" && state !== "empty" ? (
        <>
          <AppText variant="note" muted style={{ marginBottom: SPACE["2"] }}>
            {sideLabel} · <N>{p.totals.parties}</N> {tx(T, "طرفاً · المجموع")}{" "}
            <N>{formatMinorShort(p.totals.balance_minor)}</N> {tx(T, "· حُسب في")}{" "}
            <N>{hhmm(p.computed_at)}</N>
          </AppText>
          <GroupedList title={tx(T, "الذمم")}>
            {p.rows.map((r, i) => (
              <Row
                key={r.id}
                title={r.name}
                detail={
                  <>
                    {tx(T, "آخر سداد")}:{" "}
                    <DateText iso={r.last_payment_date} none={tx(T, "لا سداد بعد")} />
                    {"\n"}
                    {tx(T, "أقدم حركة غير مسددة")}: <DateText iso={r.oldest_unpaid_date} none="—" />
                    {r.source ? `\n${tx(T, "المصدر")}: ${r.source}` : ""}
                  </>
                }
                trailing={
                  <View style={{ alignItems: "flex-end" }}>
                    <N>{formatMinorShort(r.balance_minor)}</N>
                    <AppText variant="note" muted>
                      {tx(T, "الرصيد")}
                    </AppText>
                  </View>
                }
                onPress={() => router.push(`/parties/${r.id}/statement` as never)}
                last={i === p.rows.length - 1}
              />
            ))}
          </GroupedList>
        </>
      ) : null}

      {state !== "permission_denied" ? (
        <StateView state="phase_locked" title={tx(T, "تقادم الديون (30/60/90) غير معروض.")}>
          <AppText variant="note">
            <Strong>{tx(T, "غير مفعّل")}</Strong>{" "}
            {tx(
              T,
              "· حسابه يتطلب توزيع كل دفعة على فواتير بعينها، وهو ما لا يفعله النظام حالياً — السداد يُخفض الرصيد الإجمالي دون ربطه بفاتورة. عرض أعمار مبنية على ترتيب افتراضي سيعطيك أرقاماً تبدو دقيقة وهي مخمَّنة، وقد تلاحق عميلاً بدين سدّده. المعروض أعلاه حقائق مؤكدة: رصيد، وتاريخ آخر سداد، وتاريخ أقدم حركة لم يغطها سداد لاحق.",
            )}
          </AppText>
        </StateView>
      ) : null}
    </Screen>
  );
}

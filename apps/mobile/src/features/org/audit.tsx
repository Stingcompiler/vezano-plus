import { hhmm } from "@sting/app-core";
import { tx } from "@sting/texts";
import { AppText, Button, Chip, GroupedList, Screen, SPACE, StateView } from "@sting/ui-native";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { Ago, Check, Heading, Item, Lead, Mono, N, Note, Strong, Word } from "@/components/org/ui";
import { useSession } from "@/lib/session";

import { fetchFileText, shareText } from "./share";
import { ORG_TEXTS } from "./texts";
import { fetched, useReport } from "./use-report";

const T = "ORG-10";
type State = "ready" | "loading" | "empty" | "permission_denied";

export interface AuditRow {
  id: string;
  at: string;
  actor_name: string;
  actor_role: string;
  branch_id: string;
  branch_name: string;
  kind: string;
  title: string;
  detail: string;
  reason: string;
  sensitive: boolean;
}
export interface AuditPayload {
  range: string;
  since: string;
  rows: AuditRow[];
  count: number;
  last_event_at: string;
  scope: "all" | "branch" | "own";
  can_export: boolean;
  branches: { id: string; name: string }[];
}

const RANGES: [string, string][] = [
  ["today", tx(T, "اليوم")],
  ["7d", tx(T, "آخر 7 أيام")],
  ["30d", tx(T, "آخر 30 يوماً")],
  ["all", tx(T, "الكل")],
];
const RANGE_LABEL = Object.fromEntries(RANGES) as Record<string, string>;

/** «وسّع المدى»: اليوم ← 7 أيام ← 30 يوماً ← الكل. */
export const widen = (range: string) => (range === "today" ? "7d" : range === "7d" ? "30d" : "all");

/** استعلام السجل والتصدير بالمرشّحات نفسها (التصدير يحمل نطاق التصفية). */
export function auditQuery(range: string, branch: string, sensitive: boolean) {
  return {
    range,
    ...(branch ? { branch_id: branch } : {}),
    ...(sensitive ? { sensitive: "1" } : {}),
  };
}

/**
 * ORG-10 — سجل التدقيق (نظير `audit-client.tsx`): فاعل ووقت وسبب ولا تعديل؛ يُقرأ ويُصفّى ويُصدَّر ولا
 * يُحرَّر ولو من المالك؛ من يرى السجل يحدَّد بالدور (الكاشير أفعاله، والمدير فرعه، والمالك الكل). التصدير
 * للمالك ويُسلَّم بورقة المشاركة الأصلية. قائمة زمنية بفلتر بدل الجدول.
 */
export function Audit() {
  const { api, state: session } = useSession();
  const [range, setRange] = useState("today");
  const [branch, setBranch] = useState("");
  const [sensitive, setSensitive] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);

  const load = useCallback(
    async () =>
      fetched<AuditPayload>(
        await api.GET("/api/org/audit", {
          params: { query: auditQuery(range, branch, sensitive) },
        }),
      ),
    [api, range, branch, sensitive],
  );
  const { data: p, denied, failed, fetching, reload } = useReport<AuditPayload>({ load });

  const exportCsv = async () => {
    setExportFailed(false);
    const q = new URLSearchParams({ export: "csv", ...auditQuery(range, branch, sensitive) });
    const body = await fetchFileText(`/api/org/audit?${q.toString()}`, session.tokens?.access);
    if (body === null || !(await shareText(body, `audit-${range}.csv`))) setExportFailed(true);
  };

  const state: State = denied
    ? "permission_denied"
    : !p
      ? "loading"
      : p.scope !== "all"
        ? "permission_denied"
        : p.rows.length === 0
          ? "empty"
          : "ready";

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "سجل التدقيق")}
      onRefresh={() => void reload()}
      refreshing={fetching}
    >
      <AppText variant="section">{tx(T, "سجل التدقيق — فاعل ووقت وسبب، ولا تعديل")}</AppText>
      <Note>{tx(T, "يُقرأ ويُصفّى ويُصدَّر، ولا يُحرَّر ولو من المالك.")}</Note>
      <View style={{ height: SPACE["3"] }} />

      {state === "loading" ? (
        <StateView state="loading" title={tx(T, "جلب السجل")}>
          <Lead>{tx(T, "مع المدى المختار وعدد الأحداث المتوقَّع.")}</Lead>
          {failed ? (
            <Button
              variant="secondary"
              label={tx("ORG-06", "أعد المحاولة")}
              onPress={() => void reload()}
            />
          ) : null}
        </StateView>
      ) : null}

      <AppText variant="section" muted>
        {tx(T, "المدى")}
      </AppText>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: SPACE["2"],
          marginVertical: SPACE["2"],
        }}
      >
        {RANGES.map(([v, label]) => (
          <Chip key={v} label={label} on={range === v} onPress={() => setRange(v)} />
        ))}
      </View>
      {p && p.scope === "all" && (p.branches ?? []).length > 0 ? (
        <>
          <AppText variant="section" muted>
            {tx(T, "الفرع")}
          </AppText>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: SPACE["2"],
              marginVertical: SPACE["2"],
            }}
          >
            <Chip label={tx(T, "كل الفروع")} on={!branch} onPress={() => setBranch("")} />
            {p.branches.map((b) => (
              <Chip
                key={b.id}
                label={b.name}
                on={branch === b.id}
                onPress={() => setBranch(b.id)}
              />
            ))}
          </View>
        </>
      ) : null}
      <Check on={sensitive} onPress={() => setSensitive((s) => !s)}>
        {tx(T, "الأفعال الحسّاسة فقط")}
      </Check>
      {p?.can_export ? (
        <>
          <Button variant="secondary" label={tx(T, "تصدير")} onPress={() => void exportCsv()} />
          {exportFailed ? <Note>{ORG_TEXTS.exportFailed}</Note> : null}
        </>
      ) : null}
      <View style={{ height: SPACE["3"] }} />

      {state === "permission_denied" && p ? (
        <StateView state="permission_denied" title={tx(T, "سجل التدقيق")}>
          <Lead>
            <Strong>{tx(T, "لا زر تعديل ولا زر حذف في هذه الشاشة.")}</Strong>{" "}
            {tx(
              T,
              "التصحيح يُسجَّل كقيد جديد يشير إلى الأول. من يرى السجل يحدَّد بالدور: الكاشير يرى أفعاله وحدها، والمدير يرى فرعه، والمالك يرى الكل.",
            )}
          </Lead>
          <Note>
            {p.scope === "branch" ? tx(T, "ترى أفعال فرعك.") : tx(T, "ترى أفعالك وحدها.")}{" "}
            {tx(T, "التصدير من الهاتف متاح للمالك فقط، ويحمل نطاق التصفية في ترويسته.")}
          </Note>
        </StateView>
      ) : null}

      {state === "empty" && p ? (
        <StateView state="empty" title={tx(T, "لا أحداث في المدى")}>
          <Lead>{tx(T, "المدى بلا أحداث مسجّلة — والسبب المرشّح غالباً.")}</Lead>
          <Note>
            {p.last_event_at ? (
              <>
                {tx(T, "لا أحداث في هذا المدى — آخر حدث")} <Ago iso={p.last_event_at} />.
              </>
            ) : (
              tx(T, "لا حدث مسجَّل بعد في هذه المنشأة.")
            )}
          </Note>
          {range !== "all" ? (
            <Button
              variant="secondary"
              label={tx(T, "وسّع المدى")}
              onPress={() => setRange(widen(range))}
            />
          ) : null}
        </StateView>
      ) : null}

      {p && p.rows.length > 0 ? (
        <>
          <Heading>{tx(T, "أحدث الأفعال")}</Heading>
          <Note>
            {branch ? (p.branches.find((b) => b.id === branch)?.name ?? "") : tx(T, "كل الفروع")} ·{" "}
            {RANGE_LABEL[range] ?? range} · <N>{p.count}</N> {tx(T, "حدثاً")}
          </Note>
          <View style={{ height: SPACE["2"] }} />
          <GroupedList title={tx(T, "سجل التدقيق")}>
            {p.rows.map((r, i) => (
              <Item
                key={r.id}
                title={
                  <AppText variant="bodyStrong">
                    <Mono text={r.title} />
                  </AppText>
                }
                last={i === p.rows.length - 1}
                status={r.sensitive ? <Word tone="expired">{tx(T, "حسّاس")}</Word> : undefined}
              >
                <Note>
                  <N>{r.at.slice(0, 10)}</N> <N>{hhmm(r.at)}</N>
                </Note>
                {r.detail ? (
                  <Note>
                    <Mono text={r.detail} />
                  </Note>
                ) : null}
                {r.reason ? (
                  <Note>
                    {tx(T, "السبب المكتوب: «")}
                    <Mono text={r.reason} />»
                  </Note>
                ) : null}
                <AppText variant="secondary">{r.actor_name || "—"}</AppText>
                <Note>
                  {r.actor_role}
                  {r.branch_name ? ` · ${r.branch_name}` : ""}
                </Note>
              </Item>
            ))}
          </GroupedList>
          <Note>
            <Strong>{tx(T, "لا زر تعديل ولا زر حذف في هذه الشاشة.")}</Strong>{" "}
            {tx(
              T,
              "التصحيح يُسجَّل كقيد جديد يشير إلى الأول. من يرى السجل يحدَّد بالدور: الكاشير يرى أفعاله وحدها، والمدير يرى فرعه، والمالك يرى الكل. التصدير من الهاتف متاح للمالك فقط، ويحمل نطاق التصفية في ترويسته.",
            )}
          </Note>
        </>
      ) : null}
    </Screen>
  );
}

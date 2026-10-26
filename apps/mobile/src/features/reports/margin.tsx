import { formatMinorShort, hhmm } from "@sting/app-core";
import { tx } from "@sting/texts";
import { AppText, Button, Chip, GroupedList, Screen, SPACE, StateView } from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { ChipGroup, N, ReportNav, Row, Strong } from "@/components/reports/ui";
import { useSession } from "@/lib/session";

import { fetched, useReport } from "./use-report";

const T = "REP-05";
type State = "ready" | "empty" | "permission_denied" | "phase_locked" | "loading";
type RangeKey = "today" | "7d" | "30d";

interface MarginRow {
  id: string;
  name: string;
  sales_minor: string;
  cost_minor: string;
  margin_minor: string;
  margin_bp: number;
}
export interface MarginPayload {
  state: "phase_locked" | "empty" | "ready";
  scope: "all" | "branch";
  branch_compare: boolean;
  range: { key: string; start: string; end: string; label: string };
  policy: string;
  policy_label: string;
  computed_at: string;
  sales_by_branch: { id: string; name: string; sales_minor: string }[];
  rows: MarginRow[];
  groups: MarginRow[];
  missing: {
    uncosted_items: number;
    sold_items: number;
    top_uncosted: { item_id: string; name: string; sales_minor: string }[];
  } | null;
}

const pct = (bp: number) => `${(bp / 100).toFixed(2)}%`;

const LOCK_EXPLANATION = tx(
  T,
  "ليس نقص صلاحية ولا عطلاً. حساب الهامش يحتاج قراراً لم يُتخذ بعد: كيف تُحتسب تكلفة الوحدة المباعة — بآخر سعر شراء، أم بالمتوسط المرجّح، أم بالوارد أولاً صادر أولاً. الثلاثة تعطي أرقام ربح مختلفة للبضاعة نفسها.",
);

function MarginRows({ title, rows }: { title: string; rows: readonly MarginRow[] }) {
  return (
    <GroupedList title={title}>
      {rows.map((r, i) => (
        <Row
          key={r.id || r.name}
          title={r.name}
          detail={
            <>
              {tx(T, "المبيعات")} <N>{formatMinorShort(r.sales_minor)}</N> · {tx(T, "التكلفة")}{" "}
              <N>{formatMinorShort(r.cost_minor)}</N>
            </>
          }
          trailing={
            <View style={{ alignItems: "flex-end" }}>
              <N>{formatMinorShort(r.margin_minor)}</N>
              <N>{pct(r.margin_bp)}</N>
            </View>
          }
          last={i === rows.length - 1}
        />
      ))}
    </GroupedList>
  );
}

/**
 * REP-05 — الهامش ومقارنة الفروع (نظير `margin-report-client.tsx`): مشروط بسياسة تكلفة معتمدة (G-03)
 * فتظهر `phase_locked` بتخطيط معتمد وعمود مبيعات دقيق فقط؛ بسياسة وأصناف بلا تكلفة `empty` يمتنع عن
 * الرقم؛ وغير المالك محجوب (403). كالويب: لا حالة stale مرسومة ولا تخزين — تبقى الشاشة كما كانت.
 */
export function MarginReport() {
  const router = useRouter();
  const { api } = useSession();
  const [range, setRange] = useState<RangeKey>("30d");

  const load = useCallback(
    async () =>
      fetched<MarginPayload>(
        await api.GET("/api/reports/margin", { params: { query: { range } } }),
      ),
    [api, range],
  );
  const { p, denied, fetching, reload } = useReport<MarginPayload>({ load });

  const state: State = denied ? "permission_denied" : p ? p.state : "loading";
  const salesTotal = p ? p.sales_by_branch.reduce((a, b) => a + BigInt(b.sales_minor), 0n) : 0n;

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "التقارير")}
      onRefresh={() => void reload()}
      refreshing={fetching}
    >
      <ReportNav current="margin" />
      <AppText variant="section">{tx(T, "الهامش ومقارنة الفروع")}</AppText>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "مشروط بسياسة تكلفة معتمدة، ويبقى مقفلاً حتى تُعتمد.")}
      </AppText>

      {state !== "permission_denied" ? (
        <ChipGroup label={tx(T, "المدى")}>
          <Chip label={tx(T, "اليوم")} on={range === "today"} onPress={() => setRange("today")} />
          <Chip label={tx(T, "آخر 7 أيام")} on={range === "7d"} onPress={() => setRange("7d")} />
          <Chip
            label={tx(T, "آخر 30 يوماً")}
            on={range === "30d"}
            onPress={() => setRange("30d")}
          />
        </ChipGroup>
      ) : null}

      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "الشاشة كلها محجوبة")}>
          <AppText variant="secondary">
            {tx(T, "كما في «التكلفة والهامش»: من يرى الهامش يرى التكلفة بالطرح.")}
          </AppText>
          {denied?.role ? (
            <AppText variant="secondary">
              {tx(T, "دورك:")} {denied.role}.
            </AppText>
          ) : null}
        </StateView>
      ) : null}

      {state === "phase_locked" && p ? (
        <>
          <StateView state="phase_locked" title={tx(T, "هذا التقرير مصمَّم ولا يعمل الآن")}>
            <AppText variant="secondary">{LOCK_EXPLANATION}</AppText>
          </StateView>
          <AppText variant="bodyStrong" style={{ marginBottom: SPACE["2"] }}>
            {tx(T, "ما سيعرضه عند التفعيل — تخطيط معتمد ببيانات معطَّلة")}
          </AppText>
          <GroupedList title={tx(T, "الهامش بالفرع")}>
            {p.sales_by_branch.map((r, i) => (
              <Row
                key={r.id}
                title={r.name}
                detail={
                  <>
                    {tx(T, "التكلفة")}: {tx(T, "تحتاج سياسة")} · {tx(T, "الهامش")}:{" "}
                    {tx(T, "تحتاج سياسة")}
                  </>
                }
                trailing={
                  <View style={{ alignItems: "flex-end" }}>
                    <N>{formatMinorShort(r.sales_minor)}</N>
                    <AppText variant="note" muted>
                      {tx(T, "المبيعات")}
                    </AppText>
                  </View>
                }
                last={i === p.sales_by_branch.length - 1}
              />
            ))}
          </GroupedList>
          <AppText variant="note" muted>
            {tx(T, "عمود المبيعات دقيق ومتاح الآن في")}
          </AppText>
          <Button
            variant="quiet"
            label={tx(T, "تقرير المبيعات")}
            onPress={() => router.replace("/reports")}
          />
          <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
            {tx(T, ". الممتنع هو التكلفة والهامش وحدهما — ولن يظهرا برقم تقريبي.")}
          </AppText>
          <AppText variant="note" muted>
            <Strong>{tx(T, "ما الذي تحتاجه سياسة التكلفة")}</Strong>{" "}
            {tx(
              T,
              "· اختيار طريقة التكلفة (آخر شراء أم متوسط مرجَّح) — قرار يُسجَّل مرة ويُطبَّق على الكل. تسجيل تكلفة الشراء للأصناف — تُلتقط تلقائياً من فواتير الموردين بعد اليوم.",
            )}
          </AppText>
        </>
      ) : null}

      {state === "empty" && p && p.missing ? (
        <>
          <StateView state="empty" title={tx(T, "تقرير الهامش — غير متاح بعد")}>
            <AppText variant="secondary">{tx(T, "بلا تكلفة مسجَّلة لا يوجد هامش.")}</AppText>
            <AppText variant="secondary">
              {tx(T, "الهامش = البيع ناقص التكلفة. تكلفة")} <N>{p.missing.uncosted_items}</N>{" "}
              {tx(T, "صنفاً من")} <N>{p.missing.sold_items}</N>{" "}
              {tx(
                T,
                "غير مسجَّلة، فأي رقم نعرضه الآن سيكون مبنياً على أصناف بلا تكلفة — ويبدو دقيقاً وهو ليس كذلك.",
              )}
            </AppText>
            <AppText variant="note">
              <Strong>{tx(T, "ما يلزم لتشغيله")}</Strong>{" "}
              {tx(T, "· ابدأ بإدخال تكاليف الأصناف الأكثر مبيعاً:")}{" "}
              {p.missing.top_uncosted.map((i) => i.name).join(tx(T, "،") + " ")}
              {tx(
                T,
                ". تسجيل تكلفة الشراء للأصناف — تُلتقط تلقائياً من فواتير الموردين بعد اليوم. السياسة المعتمدة:",
              )}{" "}
              {p.policy_label}.
            </AppText>
            {!p.branch_compare ? (
              <AppText variant="note">
                {tx(
                  T,
                  "الباقة الحالية لا تشمل مقارنة الفروع؛ الهامش لفرع واحد متاح فور اكتمال التكاليف.",
                )}
              </AppText>
            ) : null}
          </StateView>
          <Button
            label={tx(T, "ابدأ بإدخال تكاليف الأصناف الأكثر مبيعاً")}
            onPress={() => router.push("/inventory/receive")}
          />
        </>
      ) : null}

      {state === "ready" && p ? (
        <>
          <AppText variant="bodyStrong">{tx(T, "الهامش بالفرع والمجموعة")}</AppText>
          <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
            <Strong>{tx(T, "وقت السياسة")}</Strong> {tx(T, "· التكلفة")} {p.policy_label}
            {tx(T, "، ومكتوبٌ في رأس التقرير أيّ سياسة وُلّد بها.")} {p.range.label}{" "}
            {tx(T, "· حُسب في")} <N>{hhmm(p.computed_at)}</N> {tx(T, "· المبيعات")}{" "}
            <N>{formatMinorShort(salesTotal)}</N>
          </AppText>
          <MarginRows title={tx(T, "الهامش بالفرع")} rows={p.rows} />
          {!p.branch_compare ? (
            <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
              {tx(
                T,
                "الباقة الحالية لا تشمل مقارنة الفروع؛ الهامش لفرع واحد متاح فور اكتمال التكاليف.",
              )}
            </AppText>
          ) : null}
          <MarginRows title={tx(T, "الهامش بالمجموعة")} rows={p.groups} />
        </>
      ) : null}
    </Screen>
  );
}

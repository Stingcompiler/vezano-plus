import { agoParts, dayMonth, hhmm } from "@sting/app-core";
import { tx } from "@sting/texts";
import { AppText, FONT, ROW_RTL, Screen, SPACE, TOUCH, useColors } from "@sting/ui-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { MO_TEXTS } from "@/features/market-orders/texts";

/** رقم لاتيني بخط mono معزول الاتجاه — لا حرف عربي داخله (القاعدة 2). */
export function M({ children, strong = false }: { children: string | number; strong?: boolean }) {
  return (
    <Text style={{ fontFamily: strong ? FONT.monoSemiBold : FONT.mono, writingDirection: "ltr" }}>
      {String(children)}
    </Text>
  );
}

/** حالة تُعرض مرة واحدة ككلمة ملوّنة (لا شريط ولا دائرة) — القاعدة 5. */
export function StatusWord({ tone, label }: { tone: ToneName; label: string }) {
  const c = useColors();
  return (
    <AppText variant="note" style={{ color: c.state[tone].fg }}>
      {label}
    </AppText>
  );
}
export type ToneName =
  | "success"
  | "stale"
  | "expired"
  | "conflict"
  | "saved_local"
  | "partial"
  | "synced"
  | "server_error";

/** صف قائمة بعنوان ووصف من عقد React وقيمة على النهاية؛ الصف كله هدف لمس ≥ 52. */
export function Row({
  title,
  sub,
  trailing,
  onPress,
  last = false,
  dim = false,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  trailing?: ReactNode;
  onPress?: (() => void) | undefined;
  last?: boolean;
  dim?: boolean;
  children?: ReactNode;
}) {
  const c = useColors();
  const body = (
    <View
      style={{
        minHeight: sub ? 64 : TOUCH.row,
        paddingHorizontal: SPACE["4"],
        paddingVertical: SPACE["3"],
        gap: SPACE["2"],
        opacity: dim ? 0.65 : 1,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: c.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE["3"] }}>
        <View style={{ flex: 1 }}>
          <AppText variant="bodyStrong">{title}</AppText>
          {sub ? (
            <AppText variant="secondary" muted>
              {sub}
            </AppText>
          ) : null}
        </View>
        {trailing ? <AppText variant="secondary">{trailing}</AppText> : null}
      </View>
      {children}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: pressed ? c.surfaceSunken : "transparent" })}
    >
      {body}
    </Pressable>
  );
}

/** حقول صغيرة «تسمية فوق قيمة» تتدفق في صفّ ملتفّ (بديل أعمدة الجدول على الهاتف). */
export function Cells({ items }: { items: readonly [string, ReactNode][] }) {
  return (
    <View style={{ flexDirection: ROW_RTL, flexWrap: "wrap", gap: SPACE["4"] }}>
      {items.map(([label, value]) => (
        <View key={label} style={{ minWidth: 72 }}>
          <AppText variant="note" muted>
            {label}
          </AppText>
          <AppText variant="secondary">{value}</AppText>
        </View>
      ))}
    </View>
  );
}

/** نصّ ملاحظة ثانوية بتباعد موحّد. */
export function Note({ children, strong }: { children: ReactNode; strong?: boolean }) {
  return (
    <AppText
      variant={strong ? "bodyStrong" : "note"}
      muted={!strong}
      style={{ marginBottom: SPACE["2"] }}
    >
      {children}
    </AppText>
  );
}

/** فقرة قراءة (متن ثانوي). */
export function Para({ children }: { children: ReactNode }) {
  return (
    <AppText variant="secondary" style={{ marginBottom: SPACE["2"] }}>
      {children}
    </AppText>
  );
}

/** عنوان قسم داخل الشاشة. */
export function Heading({ children }: { children: ReactNode }) {
  return (
    <AppText variant="title" accessibilityRole="header" style={{ marginBottom: SPACE["2"] }}>
      {children}
    </AppText>
  );
}

/** أزرار عمودية بتباعد موحّد. */
export function Stack({ children }: { children: ReactNode }) {
  return <View style={{ gap: SPACE["3"], marginBottom: SPACE["4"] }}>{children}</View>;
}

/** صف شرائح مقطعية من اليمين. */
export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        flexDirection: ROW_RTL,
        flexWrap: "wrap",
        gap: SPACE["2"],
        marginBottom: SPACE["3"],
      }}
    >
      {children}
    </View>
  );
}

/** شريحة لمس ≥44 بمحتوى عقدة (اسم عربي + عدد mono). */
export function NodeChip({
  on,
  onPress,
  children,
}: {
  on: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={{
        minHeight: TOUCH.min,
        paddingHorizontal: SPACE["3"],
        borderRadius: 12,
        borderWidth: 1,
        borderColor: on ? c.brandPrimary : c.border,
        backgroundColor: on ? c.brandTint : c.surfaceCard,
        justifyContent: "center",
      }}
    >
      <AppText variant="secondary" style={{ color: on ? c.brandStrong : c.inkStrong }}>
        {children}
      </AppText>
    </Pressable>
  );
}

/** ملاحظة إعلامية محايدة (Notice kind="info"): بطاقة مسطّحة بعنوان ونص بلا لون حالة. */
export function InfoBox({ title, children }: { title: string; children: ReactNode }) {
  const c = useColors();
  return (
    <View
      style={{
        backgroundColor: c.surfaceCard,
        borderRadius: 12,
        padding: SPACE["4"],
        gap: SPACE["2"],
        marginBottom: SPACE["4"],
      }}
    >
      <AppText variant="bodyStrong">{title}</AppText>
      {children}
    </View>
  );
}

/** «09 سبتمبر» — اليوم mono والشهر نص. */
export function DM({ iso }: { iso: string }) {
  const { day, month } = dayMonth(iso);
  return (
    <>
      <M>{day}</M> {month}
    </>
  );
}

/** «09 سبتمبر 14:30». */
export function When({ iso }: { iso: string }) {
  return (
    <>
      <DM iso={iso} /> <M>{hhmm(iso)}</M>
    </>
  );
}

/** «قبل 5 دقائق» — الصيغ العربية كما يكتبها الويب؛ الرقم mono. */
export function Ago({ iso }: { iso: string }) {
  const T = "ORD-03";
  const { n, unit } = agoParts(iso);
  if (unit === "minute") {
    if (n <= 1) return <>{tx(T, "قبل دقيقة")}</>;
    if (n === 2) return <>{tx(T, "قبل دقيقتين")}</>;
    return (
      <>
        {tx(T, "قبل")} <M>{n}</M> {n <= 10 ? tx(T, "دقائق") : tx(T, "دقيقة")}
      </>
    );
  }
  if (unit === "hour") {
    if (n === 1) return <>{tx(T, "قبل ساعة")}</>;
    if (n === 2) return <>{tx(T, "قبل ساعتين")}</>;
    return (
      <>
        {tx(T, "قبل")} <M>{n}</M> {n <= 10 ? tx(T, "ساعات") : tx(T, "ساعة")}
      </>
    );
  }
  if (n === 1) return <>{tx(T, "قبل يوم")}</>;
  if (n === 2) return <>{tx(T, "قبل يومين")}</>;
  return (
    <>
      {tx(T, "قبل")} <M>{n}</M> {n <= 10 ? tx(T, "أيام") : tx(T, "يوماً")}
    </>
  );
}

const PLURALS: Record<string, string> = {
  كرتونة: tx("ORD-01", "كراتين"),
  كيس: tx("ORD-01", "أكياس"),
  علبة: tx("ORD-01", "علب"),
  قطعة: tx("ORD-01", "قطع"),
  حبة: tx("ORD-01", "حبات"),
  جوال: tx("ORD-01", "جوالات"),
  صندوق: tx("ORD-01", "صناديق"),
};

/** «6 كراتين» (3–10 بالجمع) و«12 كرتونة» (11+ بالمفرد) و«كرتونتان» — كما يقولها التاجر (ORD-01). */
export function Units({ n, unit }: { n: number; unit: string }) {
  if (n === 1) return <>{`${unit} ${tx("ORD-01", "واحدة")}`}</>;
  if (n === 2) return <>{`${unit.replace(/ة$/, tx("ORD-01", "ت"))}${tx("ORD-01", "ان")}`}</>;
  return (
    <>
      <M>{n}</M> {n >= 3 && n <= 10 ? (PLURALS[unit] ?? unit) : unit}
    </>
  );
}

/** النص الصرف لعدد بوحدته (لتسميات الأزرار التي تقبل نصاً واحداً). */
export function unitsText(n: number, unit: string): string {
  if (n === 1) return `${unit} ${tx("ORD-01", "واحدة")}`;
  if (n === 2) return `${unit.replace(/ة$/, tx("ORD-01", "ت"))}${tx("ORD-01", "ان")}`;
  return `${n} ${n >= 3 && n <= 10 ? (PLURALS[unit] ?? unit) : unit}`;
}

/** «بند واحد» / «بندان» / «5 بنود». */
export function LinesWord({ n }: { n: number }) {
  if (n === 1) return <>{tx("ORD-02", "بند واحد")}</>;
  if (n === 2) return <>{tx("ORD-02", "بندان")}</>;
  return (
    <>
      <M>{n}</M> {tx("ORD-02", "بنود")}
    </>
  );
}

/** جسم الشاشة: العنوان والتلميح تحته، وسطر «من آخر جلب» حين تُعرض اللقطة المحفوظة بدل الخادم. */
export function Shell({
  id,
  state,
  title,
  hint,
  cached = false,
  onRefresh,
  children,
}: {
  id: string;
  state: string;
  title: string;
  hint?: string | undefined;
  cached?: boolean;
  onRefresh?: () => void;
  children: ReactNode;
}) {
  return (
    <Screen screenId={id} state={state} title={title} {...(onRefresh ? { onRefresh } : {})}>
      {hint ? (
        <AppText variant="secondary" muted style={{ marginBottom: SPACE["3"] }}>
          {hint}
        </AppText>
      ) : null}
      {cached ? <Note>{MO_TEXTS.cached}</Note> : null}
      {children}
    </Screen>
  );
}

export interface Stage {
  id: string;
  label: string;
  state: "done" | "current" | "upcoming" | "failed" | "partial";
  atLabel?: string | undefined;
  detail?: ReactNode;
}

const GLYPH: Record<Stage["state"], string> = {
  done: "✓",
  current: "●",
  upcoming: "○",
  failed: "!",
  partial: "◐",
};

/** C-ORDTL للجوال: مراحل الطلب عمودياً (المرحلة الحالية بعلامتها، والمستقبلية غير مكتملة لا معطّلة). */
export function Timeline({ label, stages }: { label: string; stages: readonly Stage[] }) {
  const c = useColors();
  return (
    <View accessibilityLabel={label} style={{ marginBottom: SPACE["4"], gap: SPACE["2"] }}>
      {stages.map((s) => {
        const tone =
          s.state === "done"
            ? c.state.success.fg
            : s.state === "failed"
              ? c.state.server_error.fg
              : s.state === "partial"
                ? c.state.partial.fg
                : s.state === "current"
                  ? c.brandStrong
                  : c.inkMuted;
        return (
          <View
            key={s.id}
            accessibilityState={{ selected: s.state === "current" }}
            style={{ flexDirection: "row", alignItems: "center", gap: SPACE["3"], minHeight: 32 }}
          >
            <Text style={{ color: tone, width: 20, textAlign: "center" }}>{GLYPH[s.state]}</Text>
            <AppText variant="secondary" style={{ flex: 1 }}>
              {s.label}
              {s.detail ? <> · {s.detail}</> : null}
            </AppText>
            {s.atLabel ? (
              <AppText variant="note" muted>
                <M>{s.atLabel}</M>
              </AppText>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

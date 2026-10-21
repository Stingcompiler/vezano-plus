import { dayMonth, hhmm } from "@sting/app-core";
import { tx } from "@sting/texts";
import { AppText, FONT, SPACE, TOUCH, useColors } from "@sting/ui-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, type TextStyle, View } from "react-native";

/** رقم/مبلغ/وقت لاتيني بخط mono واتجاه LTR — لا حرف عربي داخله (القاعدة 2). */
export function N({ children, style }: { children: string | number; style?: TextStyle }) {
  return (
    <Text style={[{ fontFamily: FONT.mono, writingDirection: "ltr" }, style]}>
      {String(children)}
    </Text>
  );
}

/** إبراز كلمة داخل جملة (نظير `<strong>` في الويب). */
export function Strong({ children }: { children: ReactNode }) {
  return <Text style={{ fontFamily: FONT.bold }}>{children}</Text>;
}

/** صف: عنوان وتفصيل غني على البداية وقيمة على النهاية — بديل الجدول (§٢.٢). */
export function Row({
  title,
  detail,
  trailing,
  onPress,
  last = false,
}: {
  title: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const c = useColors();
  const body = (
    <View
      style={{
        minHeight: detail ? 64 : TOUCH.row,
        paddingHorizontal: SPACE["4"],
        paddingVertical: SPACE["2"],
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE["3"],
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: c.border,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        {typeof title === "string" ? <AppText>{title}</AppText> : title}
        {detail ? (
          <AppText variant="secondary" muted>
            {detail}
          </AppText>
        ) : null}
      </View>
      {trailing}
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

/** مجموعة عناصر بتسمية (شرائح الفلتر). */
export function ChipGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: SPACE["3"], gap: SPACE["2"] }}>
      {label ? (
        <AppText variant="section" muted>
          {label}
        </AppText>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE["2"] }}>{children}</View>
    </View>
  );
}

/** كلمة حالة ملوّنة مرة واحدة (لا شريط جانبي ولا بطاقة ملوّنة). */
export function StatusWord({
  state,
  children,
}: {
  state: keyof ReturnType<typeof useColors>["state"];
  children: ReactNode;
}) {
  const c = useColors();
  return (
    <AppText variant="note" style={{ color: c.state[state].fg }}>
      {children}
    </AppText>
  );
}

/** سطر «مفتاح: قيمة» لحقائق قصيرة (بديل shift-facts). */
export function Fact({ k, children }: { k: string; children: ReactNode }) {
  return (
    <View style={{ gap: 2, paddingVertical: SPACE["1"] }}>
      <AppText variant="note" muted>
        {k}
      </AppText>
      <AppText variant="secondary">{children}</AppText>
    </View>
  );
}

/** «اليوم/أمس/قبل N أيام» + الوقت — النصوص من نص الويب (inbox-client). */
export function dayLabelInbox(iso: string, now = new Date()): ReactNode {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return tx("NOT-01", "اليوم");
  if (diff === 1) return tx("NOT-01", "أمس");
  if (diff === 2) return tx("NOT-01", "قبل يومين");
  return (
    <>
      {tx("NOT-01", "قبل")} <N>{diff}</N> {tx("NOT-01", "أيام")}
    </>
  );
}

/** «اليوم 14:05» أو «12 تشرين 14:05» (حملات). */
export function WhenCell({ iso }: { iso: string }) {
  if (!iso) return <>—</>;
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  const { day: dd, month } = dayMonth(iso);
  return (
    <>
      {diff === 0 ? (
        tx("NOT-03", "اليوم")
      ) : diff === 1 ? (
        tx("NOT-03", "أمس")
      ) : (
        <>
          <N>{dd}</N> {month}
        </>
      )}{" "}
      <N>{hhmm(iso)}</N>
    </>
  );
}

/** «اليوم» / «أمس» / «12 تشرين» — كلمة عربية والرقم mono (نظير `DayLabel` في الويب). */
export function DayLabel({ iso }: { iso: string }) {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return <>{tx("NOT-01", "اليوم")}</>;
  if (diff === 1) return <>{tx("NOT-01", "أمس")}</>;
  const { day: dd, month } = dayMonth(iso);
  return (
    <>
      <N>{dd}</N> {month}
    </>
  );
}

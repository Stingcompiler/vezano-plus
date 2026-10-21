import { dayMonth } from "@sting/app-core";
import { tx } from "@sting/texts";
import { AppText, Chip, FONT, SPACE, TOUCH, useColors } from "@sting/ui-native";
import { useRouter } from "expo-router";
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

/** عدد بصيغته العربية الصحيحة (نظير `Count` في الويب): 1 مفرد، 2 مثنى، 3–10 قلّة، وغيرها تمييز. */
export interface CountForms {
  readonly one: string;
  readonly two: string;
  readonly few: string;
  readonly many: string;
}
export function CountText({ n, forms }: { n: number; forms: CountForms }) {
  if (n === 1) return <>{forms.one}</>;
  if (n === 2) return <>{forms.two}</>;
  return (
    <>
      <N>{n}</N> {n >= 3 && n <= 10 ? forms.few : forms.many}
    </>
  );
}

/** صف تقرير: عنوان وتفصيل غني (أرقام mono داخله) على البداية وقيمة على النهاية — بديل الجدول (§٢.٢). */
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

/** مجموعة شرائح بتسمية: المدى، الفرع، وسيلة الدفع… (شرائح لمس ≥44). */
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

const NAV = "shared:app-core/nav.ts";
const ITEMS = [
  { id: "sales", label: tx(NAV, "تقرير المبيعات"), href: "/reports" },
  { id: "cash", label: tx(NAV, "تقرير الصندوق"), href: "/reports/cash" },
  { id: "receivables", label: tx(NAV, "تقرير الذمم"), href: "/reports/receivables" },
  { id: "stock", label: tx(NAV, "تقرير المخزون"), href: "/reports/stock" },
  { id: "margin", label: tx(NAV, "الهامش"), href: "/reports/margin" },
  { id: "export", label: tx(NAV, "تصدير تقرير"), href: "/reports/export" },
] as const;

/** التنقل بين شاشات التقارير (نظير AppNav في الويب): شرائح، والحالية مختارة. */
export function ReportNav({ current }: { current: (typeof ITEMS)[number]["id"] }) {
  const router = useRouter();
  return (
    <ChipGroup>
      {ITEMS.map((i) => (
        <Chip
          key={i.id}
          label={i.label}
          on={i.id === current}
          onPress={() => {
            if (i.id !== current) router.replace(i.href);
          }}
        />
      ))}
    </ChipGroup>
  );
}

/** كلمة حالة ملوّنة مرة واحدة (لا شريط جانبي ولا بطاقة ملوّنة). */
export function StatusWord({
  state,
  children,
}: {
  state: "synced" | "pending_sync" | "stale" | "conflict" | "server_error";
  children: ReactNode;
}) {
  const c = useColors();
  return (
    <AppText variant="note" style={{ color: c.state[state].fg }}>
      {children}
    </AppText>
  );
}

/** «12 تشرين» — اليوم mono والشهر عربي بجانبه. */
export function DayCell({ iso }: { iso: string }) {
  const { day, month } = dayMonth(iso);
  return (
    <Text>
      <N>{day}</N> {month}
    </Text>
  );
}

/** إبراز كلمة داخل جملة (نظير `<strong>` في الويب) بخط الوزن الثقيل. */
export function Strong({ children }: { children: ReactNode }) {
  return <Text style={{ fontFamily: FONT.bold }}>{children}</Text>;
}

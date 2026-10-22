import { AppText, Chip, FONT, ROW_RTL, SPACE, TOUCH, useColors } from "@sting/ui-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

/** رقم لاتيني بخط mono معزول الاتجاه — لا حرف عربي داخله (القاعدة 2). */
export function M({ children, strong = false }: { children: string | number; strong?: boolean }) {
  return (
    <Text
      style={{
        fontFamily: strong ? FONT.monoSemiBold : FONT.mono,
        writingDirection: "ltr",
      }}
    >
      {String(children)}
    </Text>
  );
}

/**
 * صف قائمة بعنوان ووصف من عقد React (لتركيب أرقام mono داخل النص العربي) وقيمة على النهاية.
 * الصف كله هدف لمس ≥ 52 كـ`ListRow`.
 */
export function PRow({
  title,
  sub,
  trailing,
  onPress,
  last = false,
}: {
  title: ReactNode;
  sub?: ReactNode;
  trailing?: ReactNode;
  onPress?: (() => void) | undefined;
  last?: boolean;
}) {
  const c = useColors();
  const body = (
    <View
      style={{
        minHeight: sub ? 64 : TOUCH.row,
        paddingHorizontal: SPACE["4"],
        paddingVertical: SPACE["2"],
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE["3"],
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: c.border,
      }}
    >
      <View style={{ flex: 1 }}>
        <AppText>{title}</AppText>
        {sub ? (
          <AppText variant="secondary" muted>
            {sub}
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

/** مفتاح تبديل بتسمية ظاهرة (عميل/مورد، ما سيراه المستلم). */
export function SwitchRow({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  hint?: string | undefined;
}) {
  const c = useColors();
  return (
    <View style={{ marginBottom: SPACE["3"] }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: TOUCH.row,
          gap: SPACE["3"],
        }}
      >
        <AppText style={{ flex: 1 }}>{label}</AppText>
        <Switch
          accessibilityLabel={label}
          value={value}
          onValueChange={onChange}
          trackColor={{ true: c.brandPrimary }}
        />
      </View>
      {hint ? (
        <AppText variant="note" style={{ color: c.danger }}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

/** صف شرائح مقطعية (فلتر/مدى/وسيلة) — من اليمين. */
export function Segments<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <View
      style={{
        flexDirection: ROW_RTL,
        flexWrap: "wrap",
        gap: SPACE["2"],
        marginBottom: SPACE["3"],
      }}
    >
      {options.map(([id, label]) => (
        <Chip key={id} label={label} on={value === id} onPress={() => onChange(id)} />
      ))}
    </View>
  );
}

/** الرصيد المركّب: «خادمي X + معلّق Y = Z» — الأرقام mono والكلمات خارجها. */
export function Composite({
  serverLabel,
  pendingLabel,
  server,
  pending,
  total,
}: {
  serverLabel: string;
  pendingLabel: string;
  server: string;
  pending: string;
  total?: string | undefined;
}) {
  return (
    <>
      {serverLabel} <M>{server}</M> {pendingLabel} <M>{pending}</M>
      {total !== undefined ? (
        <>
          {" "}
          = <M>{total}</M>
        </>
      ) : null}
    </>
  );
}

/** قائمة أزرار عمودية بتباعد موحّد. */
export function Stack({ children }: { children: ReactNode }) {
  return <View style={{ gap: SPACE["3"], marginBottom: SPACE["4"] }}>{children}</View>;
}

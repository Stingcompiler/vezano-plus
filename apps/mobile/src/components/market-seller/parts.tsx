import type { StateCode } from "@sting/design";
import { AppText, FONT, SPACE, TOUCH, useColors } from "@sting/ui-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

/** رقم لاتيني بخط mono معزول الاتجاه — لا حرف عربي داخله (القاعدة 2). */
export function M({ children, strong = false }: { children: string | number; strong?: boolean }) {
  return (
    <Text style={{ fontFamily: strong ? FONT.monoSemiBold : FONT.mono, writingDirection: "ltr" }}>
      {String(children)}
    </Text>
  );
}

/** حالة تُعرض مرة واحدة ككلمة ملوّنة (لا شريط ولا دائرة) — القاعدة 5. */
export function StateWord({ state, label }: { state: StateCode; label: ReactNode }) {
  const c = useColors();
  return (
    <AppText variant="note" style={{ color: c.state[state].fg }}>
      {label}
    </AppText>
  );
}

/** نصّ ملاحظة ثانوية بتباعد موحّد. */
export function Note({
  children,
  strong,
  tone,
}: {
  children: ReactNode;
  strong?: boolean;
  tone?: "danger";
}) {
  const c = useColors();
  return (
    <AppText
      variant={strong ? "bodyStrong" : "note"}
      muted={!strong && !tone}
      style={{ marginBottom: SPACE["2"], ...(tone ? { color: c.danger } : {}) }}
    >
      {children}
    </AppText>
  );
}

/** نصّ شرح أساسي تحت العنوان. */
export function Lead({ children }: { children: ReactNode }) {
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

/** صف شرائح مقطعية من اليمين (اختيار/فلتر). */
export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        flexDirection: "row-reverse",
        flexWrap: "wrap",
        gap: SPACE["2"],
        marginBottom: SPACE["3"],
      }}
    >
      {children}
    </View>
  );
}

/** صف قائمة بعنوان ووصف من عقد React وقيمة على النهاية؛ الصف كله هدف لمس ≥ 52. */
export function Row({
  title,
  sub,
  trailing,
  onPress,
  last = false,
  dim = false,
}: {
  title: ReactNode;
  sub?: ReactNode;
  trailing?: ReactNode;
  onPress?: (() => void) | undefined;
  last?: boolean;
  dim?: boolean;
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
        opacity: dim ? 0.65 : 1,
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

/** تسمية فوق قيمة (قوائم الحقائق: «مطلوب/يبقى/يُضاف»، «في دفترك/في دفتره»). */
export function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <View style={{ paddingVertical: SPACE["2"] }}>
      <AppText variant="note" muted>
        {label}
      </AppText>
      <AppText>{children}</AppText>
    </View>
  );
}

/** ملاحظة إعلامية محايدة: بطاقة مسطّحة بعنوان ونص، بلا لون حالة. */
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

/** مفتاح تبديل بتسمية وتلميح (SwitchField في الويب): الصف كله هدف لمس ≥ 52. */
export function SwitchRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={{
        minHeight: TOUCH.row,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE["3"],
        marginBottom: SPACE["3"],
      }}
    >
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong">{label}</AppText>
        {hint ? (
          <AppText variant="note" muted>
            {hint}
          </AppText>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: c.brandPrimary, false: c.border }}
      />
    </Pressable>
  );
}

/** مجموعة خيارات (RadioGroupField): خيار واحد بتسمية وتلميح، لمس ≥ 52. */
export function RadioRows<V extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: V;
  onChange: (v: V) => void;
  options: readonly { value: V; label: string; hint: string }[];
}) {
  const c = useColors();
  return (
    <View style={{ marginBottom: SPACE["3"] }} accessibilityRole="radiogroup">
      <AppText variant="bodyStrong" style={{ marginBottom: SPACE["1"] }}>
        {label}
      </AppText>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={{
              minHeight: TOUCH.row,
              paddingVertical: SPACE["2"],
              paddingHorizontal: SPACE["3"],
              marginBottom: SPACE["2"],
              borderRadius: 12,
              borderWidth: 1,
              borderColor: on ? c.brandPrimary : c.border,
              backgroundColor: on ? c.brandTint : c.surfaceCard,
            }}
          >
            <AppText variant="bodyStrong" style={{ color: on ? c.brandStrong : c.inkStrong }}>
              {o.label}
            </AppText>
            <AppText variant="note" muted>
              {o.hint}
            </AppText>
          </Pressable>
        );
      })}
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

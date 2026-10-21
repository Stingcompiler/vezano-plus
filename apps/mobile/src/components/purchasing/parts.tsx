import { states, type StateCode } from "@sting/design";
import { AppText, FONT, GroupedList, RADIUS, SPACE, TOUCH, useColors } from "@sting/ui-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

/** رقم لاتيني بخط mono معزول الاتجاه (القاعدة 2) — لا حرف عربي داخله. */
export function M({ children }: { children: string | number }) {
  return <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>{String(children)}</Text>;
}

/** صف شرائح بداية-يمين كالويب. */
export function Wrap({ children }: { children: ReactNode }) {
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

/** ملاحظة ثانوية. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <AppText variant="note" muted style={{ marginBottom: SPACE["2"] }}>
      {children}
    </AppText>
  );
}

/** فقرة قراءة داخل إشعار أو كتلة. */
export function Lead({ children }: { children: ReactNode }) {
  return <AppText variant="secondary">{children}</AppText>;
}

/** كلمة بخط عريض (نظير `<strong>` في الويب). */
export function Strong({ children }: { children: ReactNode }) {
  return (
    <AppText variant="secondary" style={{ fontFamily: FONT.bold }}>
      {children}
    </AppText>
  );
}

/** كتلة مجمّعة بحشوة للحقول — بلا شريط جانبي ولا بطاقة ملوّنة. */
export function Block({ title, children }: { title?: string | undefined; children: ReactNode }) {
  return (
    <GroupedList {...(title ? { title } : {})}>
      <View style={{ padding: SPACE["4"], gap: SPACE["2"] }}>{children}</View>
    </GroupedList>
  );
}

/** عنوان الشاشة الفرعي وتلميحه (نظير cat-head في الويب). */
export function Head({ title, hint }: { title: string; hint?: string | undefined }) {
  return (
    <View style={{ marginBottom: SPACE["4"], gap: SPACE["1"] }}>
      <AppText variant="title">{title}</AppText>
      {hint ? (
        <AppText variant="secondary" muted>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * إشعار بإحدى الحالات الـ17 وعنوانه عقدة (لتتّسع لرقم mono) — لون الحالة على الإشعار وحده.
 * يقابل StateView حين لا يكفي عنوان نصّي.
 */
export function Notice({
  state,
  title,
  children,
  action,
}: {
  state: StateCode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const c = useColors();
  const tone = c.state[state];
  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: tone.bg,
        borderColor: tone.border,
        borderWidth: 1,
        borderRadius: RADIUS.panelSm,
        padding: SPACE["4"],
        gap: SPACE["2"],
        marginBottom: SPACE["4"],
      }}
    >
      <AppText variant="note" style={{ color: tone.fg }}>
        {states[state].label}
      </AppText>
      <AppText variant="bodyStrong" style={{ color: tone.fg }}>
        {title}
      </AppText>
      {children}
      {action ? <View style={{ marginTop: SPACE["2"] }}>{action}</View> : null}
    </View>
  );
}

/** حالة تُكتب مرة واحدة بكلمة ملوّنة (لا شارة ولا شريط). */
export function StatusWord({ state, label }: { state: StateCode; label: string }) {
  const c = useColors();
  return (
    <AppText variant="note" style={{ color: c.state[state].fg }}>
      {label}
    </AppText>
  );
}

/** صف قائمة بمحتوى حرّ (عناوين مختلطة بأرقام mono) — الصف كله هدف لمس ≥ 52. */
export function PRow({
  children,
  trailing,
  onPress,
  last = false,
}: {
  children: ReactNode;
  trailing?: ReactNode;
  onPress?: (() => void) | undefined;
  last?: boolean;
}) {
  const c = useColors();
  const body = (
    <View
      style={{
        minHeight: TOUCH.row,
        paddingHorizontal: SPACE["4"],
        paddingVertical: SPACE["3"],
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE["3"],
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: c.border,
      }}
    >
      <View style={{ flex: 1, gap: SPACE["1"] }}>{children}</View>
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

/** شريط أسفل الشاشة مثبّت (الاعتماد مع المبلغ). */
export function StickyBar({ children }: { children: ReactNode }) {
  const c = useColors();
  return (
    <View
      style={{
        padding: SPACE["4"],
        gap: SPACE["2"],
        backgroundColor: c.surfaceCard,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.border,
      }}
    >
      {children}
    </View>
  );
}

/** خطأ حقل بعقدة (يتّسع لرقم mono) بلون الخطر. */
export function ErrorText({ children }: { children: ReactNode }) {
  const c = useColors();
  return (
    <AppText variant="note" style={{ color: c.danger }} accessibilityLiveRegion="polite">
      {children}
    </AppText>
  );
}

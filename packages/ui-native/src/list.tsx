import type { StateCode } from "@sting/design";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "./text";
import { FONT, RADIUS, SPACE, TOUCH, useColors } from "./theme";

/**
 * قائمة صفوف داخل بطاقة الويب (حدّ شعري وزوايا 18). العنوان رأس داخل البطاقة بخط سفلي كما في الويب
 * (`home-decisions__head`)، و`tone` يصبغ البطاقة ورأسها بألوان إحدى الحالات (مثل «يحتاج قرارك»).
 */
export function GroupedList({
  title,
  tone,
  children,
}: {
  title?: string | undefined;
  tone?: StateCode | undefined;
  children: ReactNode;
}) {
  const c = useColors();
  const t = tone ? c.state[tone] : null;
  return (
    <View
      style={{
        marginBottom: SPACE["4"],
        backgroundColor: t ? t.bg : c.surfaceCard,
        borderWidth: 1,
        borderColor: t ? t.border : c.border,
        borderRadius: RADIUS.card,
        overflow: "hidden",
      }}
    >
      {title ? (
        <View
          style={{
            paddingHorizontal: SPACE["4"],
            paddingVertical: SPACE["2.5"],
            borderBottomWidth: 1,
            borderBottomColor: t ? t.border : c.border,
            backgroundColor: t ? "transparent" : c.surfaceSunken,
          }}
        >
          <AppText
            variant="note"
            accessibilityRole="header"
            style={{ fontFamily: FONT.bold, color: t ? t.fg : c.inkStrong }}
          >
            {title}
          </AppText>
        </View>
      ) : null}
      {children}
    </View>
  );
}

/**
 * الصف: عنوان ووصف على البداية، وقيمة على النهاية (رقم بخط mono عادةً). الصف كله هدف لمس ≥ 52.
 * يقابل صفوف الجداول والقوائم في الويب — الجدول يصير قائمة صفوف على الهاتف (§٢.٢).
 */
export function ListRow({
  title,
  subtitle,
  trailing,
  onPress,
  last = false,
}: {
  title: string;
  subtitle?: string | undefined;
  trailing?: ReactNode;
  onPress?: (() => void) | undefined;
  last?: boolean;
}) {
  const c = useColors();
  const body = (
    <View
      style={{
        minHeight: subtitle ? 64 : TOUCH.row,
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
        {subtitle ? (
          <AppText variant="secondary" muted>
            {subtitle}
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

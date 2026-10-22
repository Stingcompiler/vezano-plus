import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { AppText } from "./text";
import { RADIUS, SPACE, TOUCH, useColors } from "./theme";

/**
 * بطاقة الويب (`acc-card` / `c-card`): سطح أبيض بحدّ شعري وزوايا 18، وعنوان اختياري داخلها. لا شريط
 * ملوّن ولا ظلّ ثقيل (دليل البطاقات §١٥٨). الشاشات تبني محتواها داخلها كما في الويب.
 */
export function Card({
  title,
  lead,
  children,
}: {
  title?: string | undefined;
  lead?: string | undefined;
  children?: ReactNode;
}) {
  const c = useColors();
  return (
    <View
      style={{
        backgroundColor: c.surfaceCard,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: RADIUS.card,
        padding: SPACE["4"],
        gap: SPACE["3"],
        marginBottom: SPACE["4"],
      }}
    >
      {title ? (
        <View style={{ gap: SPACE["1"] }}>
          <AppText variant="title" accessibilityRole="header">
            {title}
          </AppText>
          {lead ? (
            <AppText variant="secondary" muted>
              {lead}
            </AppText>
          ) : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** خيار الويب (`acc-choice`): عنوان عريض ووصف، والمقترح منه (`primary`) بصبغة العلامة. */
export function Choice({
  title,
  note,
  primary = false,
  onPress,
}: {
  title: string;
  note?: string | undefined;
  primary?: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH.min,
        padding: SPACE["3"],
        gap: SPACE["1"],
        borderWidth: 1,
        borderRadius: RADIUS.card,
        borderColor: primary ? c.brandLine : c.border,
        backgroundColor: pressed ? c.surfaceSunken : primary ? c.brandTint : c.surfaceCard,
      })}
    >
      <AppText variant="bodyStrong" style={{ color: primary ? c.brandStrong : c.inkStrong }}>
        {title}
      </AppText>
      {note ? (
        <AppText variant="secondary" style={{ color: primary ? c.brandStrong : c.inkMuted }}>
          {note}
        </AppText>
      ) : null}
    </Pressable>
  );
}

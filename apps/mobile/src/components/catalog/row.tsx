import { AppText, SPACE, TOUCH, useColors } from "@sting/ui-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

/**
 * صف قائمة الكتالوج: عنوان وأسطر فرعية بأرقام mono داخلها (ما لا يقبله `ListRow` الذي يأخذ نصاً)،
 * وقيمة على النهاية. الصف كله هدف لمس ≥ 52 حين يُفتح.
 */
export function CatRow({
  title,
  lines,
  trailing,
  onPress,
  last = false,
  label,
}: {
  title: ReactNode;
  lines?: ReactNode;
  trailing?: ReactNode;
  onPress?: (() => void) | undefined;
  last?: boolean;
  label?: string | undefined;
}) {
  const c = useColors();
  const body = (
    <View
      style={{
        minHeight: TOUCH.row,
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
        <AppText variant="bodyStrong">{title}</AppText>
        {lines}
      </View>
      {trailing}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: pressed ? c.surfaceSunken : "transparent" })}
    >
      {body}
    </Pressable>
  );
}

/** سطر فرعي في صف (ثانوي خافت). */
export function Line({ children }: { children: ReactNode }) {
  return (
    <AppText variant="secondary" muted>
      {children}
    </AppText>
  );
}

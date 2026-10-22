import type { ReactNode } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "./text";
import { RADIUS, SPACE, useColors } from "./theme";

/**
 * C-FRAME للجوال: الأرضية، المناطق الآمنة، بطاقة الصفحة برأس العنوان كالويب، وسحب للتحديث اختياري. الرأس
 * والتبويبات يرسمها Expo Router؛ هذا جسم الشاشة. `data-screen`/`data-state` في الويب = `testID`
 * و`accessibilityHint` هنا لاختبارات المطابقة.
 */
export function Screen({
  screenId,
  state,
  title,
  onRefresh,
  refreshing = false,
  children,
}: {
  screenId: string;
  state: string;
  title?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  children: ReactNode;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      testID={screenId}
      accessibilityHint={state}
      style={{ flex: 1, backgroundColor: c.surfacePage }}
      contentContainerStyle={{
        padding: SPACE["4"],
        paddingBottom: SPACE["8"] + insets.bottom,
      }}
      refreshControl={
        onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined
      }
    >
      {title ? (
        // كبطاقة الصفحة في الويب (`acc-card` برأس `--tone`): العنوان في شريط مصبوغ بلون العلامة
        // داخل البطاقة، والمحتوى في جسمها
        <View
          style={{
            backgroundColor: c.surfaceCard,
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: RADIUS.card,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              paddingHorizontal: SPACE["4"],
              paddingVertical: SPACE["3.5"],
              backgroundColor: c.brandTint,
              borderBottomWidth: 1,
              borderBottomColor: c.brandLine,
            }}
          >
            <AppText variant="title" accessibilityRole="header">
              {title}
            </AppText>
          </View>
          <View style={{ padding: SPACE["4"] }}>{children}</View>
        </View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "./text";
import { RADIUS, SPACE, useColors } from "./theme";

/**
 * مكوّن #7 `Sheet`: ورقة سفلية للاختيار والتأكيد والإدخال القصير (منطقة الإبهام) — بدل حوارات الويب.
 * تُغلق بالستارة أو زرّ الرجوع في أندرويد؛ المحتوى يتمرّر والمفاتيح لا تغطّيه.
 */
export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "flex-end" }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          onPress={onClose}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }}
        />
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: c.surfacePage,
            borderTopStartRadius: RADIUS.sheet,
            borderTopEndRadius: RADIUS.sheet,
            maxHeight: "85%",
            paddingBottom: insets.bottom,
          }}
        >
          <View style={{ padding: SPACE["4"], paddingBottom: SPACE["2"] }}>
            <AppText variant="title" accessibilityRole="header">
              {title}
            </AppText>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: SPACE["4"], paddingTop: SPACE["2"] }}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

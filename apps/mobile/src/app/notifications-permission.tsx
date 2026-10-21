import { AppText, Button, GroupedList, Screen, SPACE, StateView } from "@sting/ui-native";
import { useRouter } from "expo-router";
import { Linking, View } from "react-native";

import { Row } from "@/components/ops/ui";
import { OPS } from "@/features/ops/texts";

/**
 * NAT-03 — إذن الإشعارات الأصلي والروابط العميقة (قرار المالك 2026-10-17؛ يستبدل `/notify` = WEB-02).
 * `expo-notifications` غير مثبَّتة في هذا الإصدار (لا اعتماديات جديدة)، فالشاشة تشرح السبب قبل أي طلب
 * وتعرض حالة «غير مفعّلة بعد» صادقة؛ طلب الإذن وتسجيل رمز الجهاز للخادم يُوصَلان حين تُضاف الوحدة.
 * الروابط العميقة (`vezanoplus://`) يعالجها التطبيق أصلاً. رفض الإذن لا يمنع شيئاً: الصندوق يعمل.
 */
export default function NotificationsPermission() {
  const router = useRouter();
  return (
    <Screen screenId="NAT-03" state="ready" title={OPS.permTitle}>
      <StateView state="ready" title={OPS.permNotEnabled}>
        <AppText variant="secondary">{OPS.permBody}</AppText>
        <AppText variant="note">{OPS.permNote}</AppText>
        <AppText variant="note">{OPS.permBuild}</AppText>
      </StateView>
      <GroupedList>
        <Row title={OPS.permLinks} last />
      </GroupedList>
      <View style={{ gap: SPACE["3"] }}>
        <Button label={OPS.permOpenInbox} onPress={() => router.push("/notify/inbox")} />
        <Button
          variant="secondary"
          label={OPS.permSettings}
          onPress={() => void Linking.openSettings()}
        />
      </View>
    </Screen>
  );
}

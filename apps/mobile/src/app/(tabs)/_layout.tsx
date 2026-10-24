import { tx, mtx } from "@sting/texts";
import { FONT, useColors } from "@sting/ui-native";
import { Redirect, Tabs } from "expo-router";
import { BarChart3, Ellipsis, House, ShoppingCart, Users } from "lucide-react-native";

import { useSession } from "@/lib/session";

const NAV = "shared:app-core/nav.ts";

/**
 * شريط التبويب (خطة الجوال §٢.٢): أربعة تبويبات أساسية + «المزيد». الترتيب هنا ترتيب المالك؛ ترتيب
 * كل دور (المدير، الكاشير، أمين المخزن) يأتي مع الجلسة في M1 — والدور يرتّب ولا يُخفي شيئاً (قرار المالك).
 * التسميات حرفياً من بنود تنقّل الويب.
 */
export default function TabsLayout() {
  const c = useColors();
  const { state } = useSession();
  // التبويبات بجلسة نشطة على جهاز مجهّز وحدها (0005 §١٧٢–§١٧٣)
  if (state.status === "booting") return null;
  // 401 بعد فشل الاستئناف: ACC-08 (العمل محفوظ) لا الترحيب
  if (state.status === "anonymous" && state.expired) return <Redirect href="/session-expired" />;
  if (state.status === "anonymous") return <Redirect href="/welcome" />;
  if (state.status === "selecting") return <Redirect href="/select-org" />;
  if (state.status === "locked") return <Redirect href="/lock" />;
  if (!state.setupDone || !state.deviceId) return <Redirect href="/setup-device" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.brandPrimary,
        tabBarInactiveTintColor: c.inkMuted,
        tabBarStyle: { backgroundColor: c.surfaceCard, borderTopColor: c.border },
        tabBarLabelStyle: { fontFamily: FONT.medium, fontSize: 12 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: tx(NAV, "الرئيسية"), tabBarIcon: ({ color }) => <House color={color} /> }}
      />
      <Tabs.Screen
        name="pos"
        options={{
          title: tx(NAV, "نقطة البيع"),
          tabBarIcon: ({ color }) => <ShoppingCart color={color} />,
        }}
      />
      <Tabs.Screen
        name="parties"
        options={{
          title: tx(NAV, "العملاء والذمم"),
          tabBarIcon: ({ color }) => <Users color={color} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: tx(NAV, "التقارير"),
          tabBarIcon: ({ color }) => <BarChart3 color={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: mtx("more"), tabBarIcon: ({ color }) => <Ellipsis color={color} /> }}
      />
    </Tabs>
  );
}

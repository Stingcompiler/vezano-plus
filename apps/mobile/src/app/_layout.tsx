import "@/lib/crypto";

import { useColors } from "@sting/ui-native";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import IBMPlexMonoMedium from "@sting/design/fonts/IBMPlexMono-Medium.ttf";
import IBMPlexMonoRegular from "@sting/design/fonts/IBMPlexMono-Regular.ttf";
import IBMPlexMonoSemiBold from "@sting/design/fonts/IBMPlexMono-SemiBold.ttf";
import ReemKufi from "@sting/design/fonts/ReemKufi[wght].ttf";
import TajawalBold from "@sting/design/fonts/Tajawal-Bold.ttf";
import TajawalMedium from "@sting/design/fonts/Tajawal-Medium.ttf";
import TajawalRegular from "@sting/design/fonts/Tajawal-Regular.ttf";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { BrandBar } from "@/components/brand-bar";
import { BackgroundSync } from "@/lib/background-sync";
import { SessionProvider } from "@/lib/session";

void SplashScreen.preventAutoHideAsync();

/**
 * جذر التطبيق: الخطوط من `@sting/design/fonts` (محمّلة داخل التطبيق — يعمل بلا اتصال)، والعربية من
 * اليمين مفروضة بإعداد `expo-localization` في app.json (`forcesRTL`). الجلسة من `SessionProvider` (0005 §١٧٢)؛ القفل والجهاز في خطوة لاحقة من M1.
 */
export default function RootLayout() {
  const [loaded] = useFonts({
    "Tajawal-Regular": TajawalRegular,
    "Tajawal-Medium": TajawalMedium,
    "Tajawal-Bold": TajawalBold,
    "IBMPlexMono-Regular": IBMPlexMonoRegular,
    "IBMPlexMono-Medium": IBMPlexMonoMedium,
    "IBMPlexMono-SemiBold": IBMPlexMonoSemiBold,
    ReemKufi,
  });
  useEffect(() => {
    if (loaded) void SplashScreen.hideAsync();
  }, [loaded]);
  if (!loaded) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SessionProvider>
          <BackgroundSync />
          <StatusBar style="auto" />
          <AppStack />
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * المكدّس الجذري: كل شاشة تحت ترويسة العلامة كما في الويب، وفيها «→ عودة» حين توجد شاشة سابقة —
 * بدل سهم النظام الصغير بلا نصّ الذي لم يُرَ زرَّ رجوع (المالك، 0005 §٢٠٠). الترويسة تتكفّل بمسافة شريط الحالة.
 */
function AppStack() {
  const c = useColors();
  return (
    <Stack
      screenOptions={{
        header: ({ navigation, back }) => (
          <BrandBar onBack={back ? () => navigation.goBack() : undefined} />
        ),
        contentStyle: { backgroundColor: c.surfacePage },
      }}
    />
  );
}

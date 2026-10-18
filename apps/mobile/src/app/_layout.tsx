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

import { SessionProvider } from "@/lib/session";

void SplashScreen.preventAutoHideAsync();

/**
 * جذر التطبيق: الخطوط من `@sting/design/fonts` (محمّلة داخل التطبيق — يعمل بلا اتصال)، والعربية من
 * اليمين مفروضة بإعداد `expo-localization` في app.json (`forcesRTL`). الجلسة من `SessionProvider` (0005 §١٧٢)؛ القفل والجهاز في خطوة لاحقة من M1.
 */
export default function RootLayout() {
  const c = useColors();
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
          <StatusBar style="auto" />
          <Stack
            screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.surfacePage } }}
          >
            {/* الشاشات المدفوعة فوق التبويبات: سهم رجوع وحده — العنوان الكبير في جسم الشاشة */}
            {["search", "sync", "onboarding"].map((name) => (
              <Stack.Screen
                key={name}
                name={name}
                options={{
                  headerShown: true,
                  headerTitle: "",
                  headerBackButtonDisplayMode: "minimal",
                  headerShadowVisible: false,
                  headerStyle: { backgroundColor: c.surfacePage },
                  headerTintColor: c.brandPrimary,
                }}
              />
            ))}
          </Stack>
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

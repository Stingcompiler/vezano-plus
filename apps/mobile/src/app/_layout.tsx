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

import { BackgroundSync } from "@/lib/background-sync";
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
          <BackgroundSync />
          <StatusBar style="auto" />
          <Stack
            screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.surfacePage } }}
          >
            {/* الشاشات المدفوعة فوق التبويبات: سهم رجوع وحده — العنوان الكبير في جسم الشاشة */}
            {[
              "search",
              "sync",
              "onboarding",
              "device",
              "printer",
              "pos/discount",
              "pos/customer",
              "pos/pay",
              "pos/pay-credit",
              "pos/pay-mixed",
              "pos/receipt/[id]/index",
              "pos/receipt/[id]/problem",
              "pos/invoices/index",
              "pos/invoices/[id]/index",
              "pos/invoices/[id]/return",
              "pos/duplicates",
              "shifts/open",
              "shifts/current",
              "shifts/movements",
              "shifts/close",
              "shifts/review",
              "parties/suppliers",
              "parties/new",
              "parties/[id]/index",
              "parties/[id]/opening",
              "parties/[id]/statement/index",
              "parties/[id]/statement/share",
              "parties/[id]/payment",
              "parties/[id]/merge",
              "parties/receipts/[receiptId]/correct",
              "catalog/index",
              "catalog/new",
              "catalog/[id]/index",
              "catalog/[id]/units",
              "catalog/[id]/price",
              "catalog/import",
              "catalog/groups",
              "inventory/index",
              "inventory/items/[id]/index",
              "inventory/items/[id]/damage",
              "inventory/openings",
              "inventory/receive",
              "inventory/count/index",
              "inventory/count/[id]/review",
              "inventory/transfers/index",
              "inventory/transfers/new",
              "inventory/transfers/[id]/receive",
            ].map((name) => (
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

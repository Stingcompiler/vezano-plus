import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  Chip,
  FONT,
  ROW_RTL,
  SPACE,
  StateView,
  ThemedText as Text,
} from "@sting/ui-native";
import type { LocalSale } from "@sting/sync-core";
import { useRouter } from "expo-router";
import { View } from "react-native";

import type { PushResult } from "@/lib/pos";

const T = "POS-05";

/** وسائل الدفع كشرائح (POS-05/06/07): نقداً · آجل · مختلط — الانتقال بينها لا يفقد السلة. */
export function PayMethods({ current }: { current: "cash" | "credit" | "mixed" }) {
  const router = useRouter();
  return (
    <View style={{ flexDirection: ROW_RTL, gap: SPACE["2"], marginBottom: SPACE["3"] }}>
      <Chip
        label={tx("POS-01", "نقداً")}
        on={current === "cash"}
        onPress={() => router.replace("/pos/pay")}
      />
      <Chip
        label={tx("POS-06", "آجلاً على")}
        on={current === "credit"}
        onPress={() => router.replace("/pos/pay-credit")}
      />
      <Chip
        label={tx("POS-07", "مختلط بلا اتصال").slice(0, 5)}
        on={current === "mixed"}
        onPress={() => router.replace("/pos/pay-mixed")}
      />
    </View>
  );
}

/**
 * ما بعد الحفظ (POS-05/06/07 success|saved_local): «النجاح بعد الحفظ لا بعد الطباعة». يعرض رقم الفاتورة
 * وحالة الرفع صادقةً — مؤكَّد خادمياً، أو محفوظ على الجهاز وينتظر دوره، أو فشل الرفع بعد الحفظ.
 */
export function SaleDone({ sale, push }: { sale: LocalSale; push: PushResult }) {
  const router = useRouter();
  const synced = push === "synced";
  return (
    <View style={{ gap: SPACE["3"] }}>
      <StateView
        state={synced ? "success" : "saved_local"}
        title={synced ? tx(T, "اكتمل البيع") : tx(T, "حُفظ على الجهاز")}
      >
        <AppText variant="secondary">
          {tx(T, "النجاح بعد الحفظ")}
          {tx(
            T,
            "· لا بعد الطباعة. فشل الطابعة بعده لا يلغي البيع: «أعد الطباعة» تُخرج نسخة بنفس الرقم لا بيعاً جديداً.",
          )}
        </AppText>
        <AppText variant="bodyStrong">
          {tx(T, "رقم الفاتورة")}{" "}
          <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>
            {sale.invoice_number}
          </Text>
        </AppText>
        {push === "failed" ? (
          <AppText variant="note">{tx("POS-07", "فشل الرفع بعد الحفظ")}</AppText>
        ) : null}
      </StateView>
      <Button
        label={tx(T, "طباعة الإيصال")}
        financial
        onPress={() => router.replace({ pathname: "/pos/receipt/[id]", params: { id: sale.id } })}
      />
      <Button
        label={tx(T, "بيع جديد")}
        variant="secondary"
        onPress={() => router.replace("/pos")}
      />
    </View>
  );
}

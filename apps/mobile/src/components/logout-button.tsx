import { countPending } from "@sting/app-core";
import { tx } from "@sting/texts";
import { AppText, Button, ROW_RTL, SPACE, StateView, ThemedText as Text } from "@sting/ui-native";
import { FONT } from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { resetTo } from "@/lib/nav";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const K = "shared:features/home/logout-button.tsx";

/**
 * تسجيل الخروج كزرّ الويب (`logout-button.tsx`، 0005 §١٢٢): خطوتان — الأولى تعرض ما سيبقى على الجهاز
 * (العمل غير المرفوع يبقى ويُرفع عند الدخول التالي)، والثانية تخرج ثم الدخول بكلمة المرور. في «المزيد»
 * كما في أسفل قائمة الويب (0005 §٢٠٢).
 */
export function LogoutButton() {
  const router = useRouter();
  const { state, signOut } = useSession();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(0);
  if (state.status !== "active" && state.status !== "locked") return null;

  const ask = async () => {
    const storage = await getStorage();
    setPending(await countPending(storage).catch(() => 0));
    setConfirming(true);
  };
  const logout = () => {
    signOut();
    resetTo(router, "/login");
  };

  if (!confirming) {
    return <Button label={tx(K, "تسجيل الخروج")} variant="secondary" onPress={() => void ask()} />;
  }
  return (
    <StateView state="ready" title={tx(K, "تأكيد الخروج")}>
      {pending > 0 ? (
        <View style={{ flexDirection: ROW_RTL, flexWrap: "wrap", gap: SPACE["1"] }}>
          <Text style={{ fontFamily: FONT.mono }}>{String(pending)}</Text>
          <AppText variant="secondary">
            {tx(K, "عملية لم تُرفع بعد — تبقى على الجهاز وتُرفع عند الدخول التالي.")}
          </AppText>
        </View>
      ) : (
        <AppText variant="secondary">{tx(K, "كل عملك مرفوع. الجهاز يبقى مُجهَّزاً.")}</AppText>
      )}
      <Button label={tx(K, "اخرج")} variant="danger" onPress={logout} />
      <Button label={tx(K, "إلغاء")} variant="quiet" onPress={() => setConfirming(false)} />
    </StateView>
  );
}

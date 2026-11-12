import { tx } from "@sting/texts";
import { AppText, Button, SPACE } from "@sting/ui-native";
import { useState } from "react";
import { View } from "react-native";

import { M } from "@/components/catalog/parts";
import { useSession } from "@/lib/session";

const F = "shared:features/catalog/internal-barcode.tsx";

/**
 * «أنشئ باركوداً داخلياً» (0005 §٢٦٩) — مرآة الويب: الخادم يعطي الرقم التالي من عدّاد المنشأة
 * (EAN-13 بالبادئة 20) فيُملأ به الحقل. يظهر والحقل فارغ فقط؛ الفشل (الشبكة) يُقال ولا يمسّ الحقل.
 */
export function GenerateBarcodeButton({
  onCode,
  disabledReason,
}: {
  onCode: (code: string) => void;
  disabledReason?: string | undefined;
}) {
  const { api } = useSession();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const generate = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const { data, response } = await api.POST("/api/catalog/barcode/generate");
      const code = (data as { barcode?: string } | undefined)?.barcode;
      if (!response.ok || !code) throw new Error("generate_failed");
      onCode(code);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: SPACE["2"], marginBottom: SPACE["3"] }}>
      <Button
        label={tx(F, "أنشئ باركوداً داخلياً")}
        variant="secondary"
        onPress={() => void generate()}
        loading={busy}
        disabledReason={disabledReason}
      />
      {failed ? (
        <AppText variant="note" accessibilityRole="alert">
          {tx(F, "تعذّر إنشاء الباركود — حاول مرة أخرى")}
        </AppText>
      ) : null}
    </View>
  );
}

/** تحت الحقل حين يحمل باركوداً داخلياً: لا يصلح خارج المتجر. */
export function InternalBarcodeNote({ value }: { value: string }) {
  if (!/^20[0-9]{11}$/.test(value.trim())) return null;
  return (
    <AppText variant="note" muted style={{ marginBottom: SPACE["2"] }}>
      {tx(F, "باركود داخلي لمتجرك — يبدأ بـ")} <M>20</M> {tx(F, "ولا يصلح خارج المتجر")}
    </AppText>
  );
}

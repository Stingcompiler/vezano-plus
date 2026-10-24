import { mtx } from "@sting/texts";
import { AppText, Button, GroupedList, ListRow, Screen, StateView } from "@sting/ui-native";

import { printReceipt } from "@/lib/receipt-print";

/**
 * NAT-02 — الطابعة (خطة الجوال M2). يستبدل `/print` في الويب. الطباعة تمرّ بنظام الهاتف (AirPrint وخدمة
 * الطباعة في أندرويد) أو بحفظ PDF ومشاركته؛ والطابعات الحرارية بالبلوتوث لم تُفعَّل بعد وتُقال صراحةً بدل
 * وعد مبهم (لا قائمة عتاد معتمدة قبل تجربة فعلية). فشل الطابعة لا يلغي بيعاً أبداً.
 */
export default function Printer() {
  return (
    <Screen screenId="NAT-02" state="ready" title={mtx("printerTitle")}>
      <GroupedList title={mtx("printerSystem")}>
        <ListRow title={mtx("printerSystemBody")} last />
      </GroupedList>
      <Button
        label={mtx("printerTest")}
        variant="secondary"
        onPress={() =>
          void printReceipt(
            `<html dir="rtl"><body style="font-family:sans-serif;padding:16px"><h3 style="text-align:center">${mtx("printerTest")}</h3></body></html>`,
          )
        }
      />
      <StateView state="phase_locked" title={mtx("printerBluetoothTitle")}>
        <AppText variant="secondary">{mtx("printerBluetoothBody")}</AppText>
      </StateView>
    </Screen>
  );
}

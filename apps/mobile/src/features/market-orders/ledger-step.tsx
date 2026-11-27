import { Button } from "@sting/ui-native";

import { Note, Stack } from "@/components/market-orders/parts";
import { tOf } from "@/features/market-orders/texts";
import type { Ledger } from "@/features/market-orders/types";

const t = tOf("ORD-05");

/**
 * M-01 (كالويب `LedgerStep`): الاستلام في السوق لا يُدخل المخزون — الخطوة التالية التحويل إن رُبط
 * المورد، وإلا الربط؛ وحين M3 غير مفعَّل يُقال ذلك صراحةً.
 */
export function LedgerStep({
  ledger,
  shipmentId,
  onGo,
}: {
  ledger: Ledger;
  shipmentId: string;
  onGo: (href: string) => void;
}) {
  if (!ledger.m3)
    return (
      <Note>
        {t("ربط السوق بدفترك غير مفعَّل لمنشأتك بعد، فأدخِل البضاعة مخزونك بمستند شراء.")}
      </Note>
    );
  if (ledger.supplier_linked)
    return (
      <Button
        label={t("أدخِل المخزون الآن")}
        financial
        onPress={() => onGo(`/market/link/receipts?shipment=${encodeURIComponent(shipmentId)}`)}
      />
    );
  return (
    <Stack>
      <Note>
        {t(
          "لإدخال البضاعة المخزون: اربط المورد بمنشأته، ثم طابق الأصناف، ثم حوّل الاستلام إلى مستند شراء.",
        )}
      </Note>
      <Button
        label={t("اربط المورد")}
        variant="secondary"
        onPress={() => onGo("/market/link/parties")}
      />
    </Stack>
  );
}

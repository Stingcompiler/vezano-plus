import type { StateCode } from "@sting/design";
import { Button, StateView } from "@sting/ui-native";

import { MS_TEXTS } from "@/features/market-seller/texts";

/**
 * فشل الجلب بلا لقطة محفوظة (القاعدة 7): انقطاع ← offline، 403 ← permission_denied، غيره ← server_error.
 * مع لقطة قديمة لا يظهر شيء هنا (الشاشة تعرض اللقطة بحالة `stale` وملاحظة «من آخر جلب»).
 */
export function FetchFail({
  net,
  hasData,
  onRetry,
}: {
  net: StateCode | null;
  hasData: boolean;
  onRetry: () => void;
}) {
  if (hasData || (net !== "offline" && net !== "server_error" && net !== "permission_denied"))
    return null;
  const title =
    net === "permission_denied"
      ? MS_TEXTS.denied
      : net === "server_error"
        ? MS_TEXTS.serverError
        : MS_TEXTS.loadFailed;
  return (
    <StateView state={net} title={title}>
      <Button label={MS_TEXTS.retry} variant="secondary" onPress={onRetry} />
    </StateView>
  );
}

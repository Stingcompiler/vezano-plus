import { tx } from "@sting/texts";
import { AppText, StateView } from "@sting/ui-native";

/** رابط لا أثر له (404): نصّ PUB-04 «الرابط لم يعد صالحاً» الذي يحوّل إليه الويب (`/link-expired`). */
export function LinkExpired() {
  return (
    <StateView state="expired" title={tx("PUB-04", "الرابط لم يعد صالحاً")}>
      <AppText variant="secondary">
        {tx("PUB-04", "اطلب رابطاً جديداً ممن أرسله إليك — لا نعرف مُرسِله من هنا.")}
      </AppText>
    </StateView>
  );
}

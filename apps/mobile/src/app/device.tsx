import { countPending } from "@sting/app-core";
import { mtx, tx } from "@sting/texts";
import {
  AppText,
  Button,
  FONT,
  GroupedList,
  ListRow,
  Screen,
  SPACE,
  StateView,
} from "@sting/ui-native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Text } from "react-native";

import { shareLocalBackup } from "@/lib/local-backup";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

/** أكبر معلّق يُسمح معه بتطبيق تحديث OTA — فوقه يُمنع (خطة الجوال: NAT-04). */
export const OTA_PENDING_LIMIT = 0;

function N({ children }: { children: string | number }) {
  return <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>{String(children)}</Text>;
}

/**
 * NAT-04 — الجهاز: النسخة الاحتياطية والتحديث والأسرار (خطة الجوال M1؛ 0005 §١٩٢). يستبدل `/sync/update`
 * و`/sync/storage` في الويب. «لا يُطبَّق تحديث على جهاز بعمليات غير مرفوعة بلا نسخة»: هنا يُمنع التحديث
 * ما دام هناك معلّق، والنسخة المحلية متاحة دائماً بلا اتصال. الأسرار في expo-secure-store وتُمحى بالخروج.
 */
export default function DeviceScreen() {
  const router = useRouter();
  const { signOut } = useSession();
  const [pending, setPending] = useState(0);
  const [exported, setExported] = useState<number | null>(null);

  useEffect(() => {
    void getStorage().then((s) => countPending(s).then(setPending));
  }, []);

  const blocked = pending > OTA_PENDING_LIMIT;
  return (
    <Screen screenId="NAT-04" state={blocked ? "pending_sync" : "ready"} title={mtx("deviceTitle")}>
      <GroupedList>
        <ListRow
          title={mtx("deviceVersion")}
          trailing={<N>{Constants.expoConfig?.version ?? "—"}</N>}
          last
        />
      </GroupedList>

      <GroupedList title={mtx("deviceBackupTitle")}>
        <ListRow title={mtx("deviceBackupBody")} last />
      </GroupedList>
      <Button
        label={mtx("deviceBackupAction")}
        variant="secondary"
        onPress={() => void shareLocalBackup().then(setExported)}
      />
      {exported !== null ? (
        <AppText variant="note" muted style={{ marginTop: SPACE["2"] }}>
          <N>{exported}</N> {mtx("deviceBackupDone")}
        </AppText>
      ) : null}

      <GroupedList title={mtx("deviceUpdateTitle")}>
        <ListRow title={blocked ? mtx("deviceUpdateBlocked") : mtx("deviceUpdateOk")} last />
      </GroupedList>
      {blocked ? (
        <StateView state="pending_sync" title={tx("SYS-01", "معلّق")}>
          <AppText variant="secondary">
            <N>{pending}</N> {tx("SYS-01", "عمليات معلّقة")}
          </AppText>
          <Button
            label={tx("SYS-01", "مركز الاتصال والمزامنة")}
            onPress={() => router.push("/sync")}
          />
        </StateView>
      ) : null}

      <GroupedList title={mtx("deviceSecretsTitle")}>
        <ListRow title={mtx("deviceSecretsBody")} last />
      </GroupedList>
      <Button
        label={mtx("deviceSignOut")}
        variant="danger"
        disabledReason={blocked ? mtx("deviceUpdateBlocked") : undefined}
        onPress={() => {
          signOut();
          router.replace("/welcome");
        }}
      />
    </Screen>
  );
}

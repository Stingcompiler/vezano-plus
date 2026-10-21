import { tx } from "@sting/texts";
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
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Text } from "react-native";

import { shareLocalBackup } from "@/lib/local-backup";
import { getStorage } from "@/lib/storage";

const T = "ACC-08";
type State = "expired" | "saved_local" | "offline";

const KIND_LABEL: Record<string, string> = {
  sale_invoice: tx(T, "فواتير بيع لم تُرفع"),
  receipt: tx(T, "سندات قبض"),
  cash_movement: tx(T, "حركة صندوق"),
};

interface Pending {
  readonly total: number;
  readonly byKind: readonly { readonly kind: string; readonly n: number }[];
}

function N({ children }: { children: string | number }) {
  return <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>{String(children)}</Text>;
}

/**
 * ACC-08 — انتهاء الجلسة (خطة الجوال M1؛ 0005 §١٩٢). «لا تنتهي جلسةٌ على عملٍ لم يُرفع»: العمل باقٍ
 * على الجهاز، لا يُرفع بجلسة منتهية ولا يُمحى. يُعرض حين يردّ الخادم 401 بعد فشل الاستئناف (حارس
 * التبويبات). إعادة الدخول تعيد إلى الرئيسية والرفع التلقائي (BackgroundSync) يرفع المعلّق باسم
 * صاحبه — فلا مرحلة رفع منفصلة هنا كالويب. بلا اتصال: تصدير نسخة محلية فقط.
 */
export default function SessionExpired() {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [exported, setExported] = useState<number | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    void (async () => {
      const storage = await getStorage();
      const ops = await storage.read(async (t) => [
        ...(await t.listOperationsByState("local")),
        ...(await t.listOperationsByState("pending")),
      ]);
      const counts = new Map<string, number>();
      for (const op of ops) counts.set(op.kind, (counts.get(op.kind) ?? 0) + 1);
      setPending({ total: ops.length, byKind: [...counts].map(([kind, n]) => ({ kind, n })) });
      setShiftOpen(Boolean(await storage.read((t) => t.getMeta("shift.open"))));
    })();
    void fetch(`${process.env.EXPO_PUBLIC_API_URL ?? ""}/api/health`)
      .then(() => setOnline(true))
      .catch(() => setOnline(false));
  }, []);

  const n = pending?.total ?? 0;
  const state: State = !online ? "offline" : n > 0 ? "saved_local" : "expired";
  const reauth = () => router.replace("/login");
  const exportBackup = async () => setExported(await shareLocalBackup());

  return (
    <Screen
      screenId={T}
      state={state}
      title={state === "saved_local" ? tx(T, "جلستك انتهت — وعملك محفوظ") : tx(T, "انتهت جلستك")}
    >
      {state === "offline" ? (
        <StateView state="offline" title={tx(T, "انتهت الجلسة وأنت بلا اتصال")}>
          <AppText variant="secondary">
            {tx(
              T,
              "لا يمكن التحقق بلا شبكة. الجلسة منتهية والعمل محفوظ ومعلّق، والجهاز مقفل على شاشة واحدة.",
            )}
          </AppText>
          <Button label={tx(T, "صدّر نسخة محلية")} onPress={() => void exportBackup()} />
        </StateView>
      ) : null}

      {state === "expired" ? (
        <>
          <AppText variant="secondary" muted style={{ marginBottom: SPACE["4"] }}>
            {tx(T, "سجّل الدخول مجدداً لمتابعة المزامنة.")}
          </AppText>
          <GroupedList title={tx(T, "حالة عملك الآن")}>
            <ListRow
              title={tx(T, "عمليات محفوظة محلياً")}
              trailing={
                <AppText>
                  <N>{n}</N> · {tx(T, "آمنة")}
                </AppText>
              }
              last={!shiftOpen}
            />
            {shiftOpen ? (
              <ListRow
                title={tx(T, "الوردية المفتوحة")}
                trailing={<AppText>{tx(T, "مستمرة")}</AppText>}
                last={false}
              />
            ) : null}
            <ListRow
              title={tx(T, "الرفع إلى الخادم")}
              trailing={<AppText>{tx(T, "متوقف")}</AppText>}
              last
            />
          </GroupedList>
          <AppText variant="note" muted style={{ marginBottom: SPACE["4"] }}>
            {tx(T, "لم يُفقد شيء. البيع المحلي يستمر بعد إعادة الدخول، والعمليات")} <N>{n}</N>{" "}
            {tx(T, "تُرفع تلقائياً. لن نطلب منك إعادة إدخالها.")}
          </AppText>
        </>
      ) : null}

      {state === "saved_local" ? (
        <>
          <GroupedList title={tx(T, "على هذا الجهاز ولم يُرفع بعد")}>
            {(pending?.byKind ?? []).map((k, i, all) => (
              <ListRow
                key={k.kind}
                title={KIND_LABEL[k.kind] ?? k.kind}
                trailing={<N>{k.n}</N>}
                last={i === all.length - 1}
              />
            ))}
          </GroupedList>
          <AppText variant="secondary" style={{ marginBottom: SPACE["4"] }}>
            {tx(T, "أعِد التحقق ليُرفع كل ذلك باسمك.")}{" "}
            <Text style={{ fontFamily: FONT.bold }}>{tx(T, "لا نمسح شيئاً")}</Text>
            {tx(T, ": العمل باقٍ على الجهاز حتى لو أغلقتَ التطبيق أو انتظرتَ أياماً.")}
          </AppText>
        </>
      ) : null}

      {state !== "offline" ? (
        <>
          <Button
            label={
              state === "saved_local" ? tx(T, "أعد التحقق وارفع") : tx(T, "إعادة تسجيل الدخول")
            }
            financial
            onPress={reauth}
          />
          <Button
            label={
              state === "saved_local" ? tx(T, "صدّر نسخة أولاً") : tx(T, "تصدير نسخة محلية أولاً")
            }
            variant="secondary"
            onPress={() => void exportBackup()}
          />
        </>
      ) : null}

      {exported !== null ? (
        <AppText variant="note" muted style={{ marginTop: SPACE["3"] }}>
          <N>{exported}</N> {tx(T, "محفوظ محلياً")}
        </AppText>
      ) : null}
    </Screen>
  );
}

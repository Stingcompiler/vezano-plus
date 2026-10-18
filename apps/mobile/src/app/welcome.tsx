import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, ListRow, Screen, SPACE, StateView } from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { useSession } from "@/lib/session";
import { openOnWeb } from "@/lib/web";

const T = "ACC-01";

/**
 * ACC-01 — الترحيب واختيار الدخول أو إنشاء منشأة (خطة الجوال M1). الخيارات الثلاثة صفوف كبيرة
 * بنصوص الويب حرفياً؛ إنشاء الحساب يفتح الويب حتى تُبنى خطوات التسجيل على الجوال (§٢.٤).
 * بلا اتصال أو خادم متعطّل: الحالة بنصّ الويب و«أعد المحاولة».
 */
export default function Welcome() {
  const router = useRouter();
  const { api } = useSession();
  const [state, setState] = useState<"loading" | "ready" | "offline" | "server_error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .GET("/api/health")
      .then(({ response }) => {
        if (!cancelled) setState(response.ok ? "ready" : "server_error");
      })
      // فشل الشبكة نفسه = بلا اتصال (لا ردّ من الخادم إطلاقاً)
      .catch(() => {
        if (!cancelled) setState("offline");
      });
    return () => {
      cancelled = true;
    };
  }, [api, attempt]);
  const retry = useCallback(() => {
    setState("loading");
    setAttempt((n) => n + 1);
  }, []);

  return (
    <Screen screenId={T} state={state} title={tx(T, "أهلاً بك في فيزانو بلص")}>
      {state === "offline" ? (
        <StateView state="offline" title={tx(T, "بلا اتصال")}>
          <AppText variant="secondary">
            {tx(T, "جهازٌ جديد لا يستطيع الدخول ولا الإنشاء: كلاهما يحتاج الخادم.")}
          </AppText>
          <Button label={tx(T, "أعد المحاولة")} onPress={retry} />
        </StateView>
      ) : null}
      {state === "server_error" ? (
        <StateView state="server_error" title={tx(T, "خطأ خادم")}>
          <AppText variant="secondary">{tx(T, "الخدمة لا تستجيب — العطب ليس عندك")}</AppText>
          <Button label={tx(T, "أعد المحاولة")} onPress={retry} />
          <Button
            label={tx(T, "حالة الخدمة")}
            variant="secondary"
            onPress={() => void openOnWeb("/status")}
          />
        </StateView>
      ) : null}
      {state === "ready" ? (
        <View style={{ gap: SPACE["4"] }}>
          <AppText variant="secondary" muted>
            {tx(T, "اختر ما جاء بك. الاختيار يحدّد نوع حسابك ولا يُغيَّر لاحقاً بضغطة.")}
          </AppText>
          <GroupedList>
            <ListRow
              title={tx(T, "لي حساب — دخول")}
              subtitle={tx(T, "مالك أو موظف له عضوية في منشأة قائمة.")}
              onPress={() => router.push("/login")}
            />
            <ListRow
              title={tx(T, "أدير متجراً — إنشاء منشأة جديدة")}
              subtitle={tx(T, "حساب إدارة: نقاط بيع ومخزون ودفاتر. هذا ما يحتاجه صاحب المحل.")}
              onPress={() => router.push("/register")}
            />
            <ListRow
              title={tx(T, "أشتري من السوق باسم منشأتي")}
              subtitle={tx(
                T,
                "نفس حساب الإدارة. لا حساب سوق منفصل — منشأة واحدة تشتري وتبيع بدفتر واحد.",
              )}
              onPress={() => router.push("/login")}
              last
            />
          </GroupedList>
          <AppText variant="note" muted>
            {tx(T, "زبون محل وصلته رسالة؟ لا تحتاج حساباً هنا — افتح الرابط الذي وصلك مباشرة.")}
          </AppText>
        </View>
      ) : null}
    </Screen>
  );
}

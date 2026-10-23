import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  ROW_RTL,
  Screen,
  SPACE,
  StateView,
  TextField,
  useColors,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Image, View } from "react-native";

import icon from "../../assets/images/icon.png";

import { SignedInRedirect, resetTo } from "@/lib/nav";
import { useSession } from "@/lib/session";
import { openOnWeb } from "@/lib/web";

const T = "ACC-02";

/**
 * ACC-02 — الدخول (خطة الجوال M1). الحقول ولوحات مفاتيحها: المعرّف بريد أو هاتف، وكلمة المرور بزرّ
 * إظهار الحروف. رسالة واحدة للحالتين (لا تسريب لوجود الحساب)، وتأخير بعدّاد ظاهر بعد المحاولات
 * (429). الاستعادة تفتح الويب حتى تُبنى خطوتها هنا، وإنشاء الحساب في `register.tsx`. بعد الدخول: منشأة واحدة =
 * التبويبات، وأكثر = اختيار المنشأة (ACC-03).
 */
export default function Login() {
  const router = useRouter();
  const c = useColors();
  const { api, signIn } = useSession();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [offline, setOffline] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const submit = async () => {
    if (busy || wait > 0) return;
    setInvalid(false);
    setOffline(false);
    setBusy(true);
    try {
      const { data, error, response } = await api.POST("/api/auth/account/login", {
        body: { identifier, password },
      });
      if (response.status === 429) {
        setWait(
          Number((error as { retry_after_seconds?: number } | undefined)?.retry_after_seconds ?? 0),
        );
        setInvalid(true);
        return;
      }
      if (!response.ok || !data) {
        setInvalid(true);
        return;
      }
      const next = signIn(data);
      resetTo(router, next.status === "active" ? "/" : "/select-org");
    } catch {
      setOffline(true);
    } finally {
      setBusy(false);
    }
  };

  const state = offline ? "offline" : invalid ? "validation_error" : "ready";
  return (
    <Screen screenId={T} state={state}>
      <SignedInRedirect />
      {/* كالويب: الشعار فوق العنوان */}
      <Image
        source={icon}
        accessibilityIgnoresInvertColors
        style={{ width: 56, height: 56, borderRadius: 14, marginBottom: SPACE["3"] }}
      />
      <AppText variant="largeTitle" accessibilityRole="header" style={{ marginBottom: SPACE["2"] }}>
        {tx(T, "الدخول إلى فيزانو بلص")}
      </AppText>
      <AppText variant="secondary" muted style={{ marginBottom: SPACE["4"] }}>
        {tx(T, "حساب إدارة المتجر. زبون المحل يدخل من رابط المحل ولا يحتاج حساباً هنا.")}
      </AppText>
      {offline ? (
        <StateView state="offline" title={tx(T, "بلا اتصال")}>
          <AppText variant="secondary">{tx(T, "الدخول الأول يحتاج الخادم.")}</AppText>
        </StateView>
      ) : null}
      {invalid ? (
        <StateView state="validation_error" title={tx(T, "بيانات الدخول غير صحيحة")}>
          {wait > 0 ? (
            // الرقم بخط mono والكلمة العربية بجانبه لا داخله (لا حرف عربي داخل عنصر mono)
            <View
              style={{ flexDirection: ROW_RTL, alignItems: "baseline", gap: SPACE["1"] }}
              accessibilityLiveRegion="polite"
            >
              <AppText variant="money">{String(wait)}</AppText>
              <AppText variant="secondary">{tx(T, "ثانية")}</AppText>
            </View>
          ) : null}
          <Button
            label={tx(T, "نسيت كلمة المرور")}
            variant="quiet"
            onPress={() => void openOnWeb("/login")}
          />
          <Button
            label={tx(T, "ليس لديك حساب؟")}
            variant="quiet"
            onPress={() => router.push("/register")}
          />
        </StateView>
      ) : null}
      <TextField
        label={tx(T, "رقم الهاتف أو البريد")}
        testID="login-identifier"
        value={identifier}
        onChangeText={setIdentifier}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        textContentType="username"
        editable={!busy}
        required
      />
      <TextField
        label={tx(T, "كلمة المرور")}
        testID="login-password"
        value={password}
        onChangeText={setPassword}
        secure
        autoComplete="current-password"
        textContentType="password"
        editable={!busy}
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        required
      />
      {/* كالويب: «نسيت كلمة المرور» عند نهاية السطر (اليسار) */}
      <View style={{ alignItems: "flex-end", marginBottom: SPACE["3"] }}>
        <Button
          label={tx(T, "نسيت كلمة المرور")}
          variant="quiet"
          onPress={() => void openOnWeb("/login")}
        />
      </View>
      <Button
        label={tx(T, "دخول")}
        financial
        loading={busy}
        disabledReason={wait > 0 ? `${wait} ${tx(T, "ثانية")}` : undefined}
        onPress={() => void submit()}
      />
      {/* كالويب: فاصل ثم «ليس لديك حساب؟ أنشئ حساب متجر» في سطر واحد */}
      <View
        style={{
          marginTop: SPACE["6"],
          paddingTop: SPACE["3"],
          borderTopWidth: 1,
          borderTopColor: c.border,
          flexDirection: ROW_RTL,
          justifyContent: "center",
          alignItems: "center",
          gap: SPACE["1"],
        }}
      >
        <AppText variant="secondary" muted>
          {tx(T, "ليس لديك حساب؟")}
        </AppText>
        <Button
          label={tx(T, "أنشئ حساب متجر")}
          variant="quiet"
          onPress={() => router.push("/register")}
        />
      </View>
    </Screen>
  );
}

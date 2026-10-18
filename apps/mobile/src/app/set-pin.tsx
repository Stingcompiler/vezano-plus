import { storeVerifiers } from "@sting/sync-core";
import { mtx, tx } from "@sting/texts";
import { AppText, Button, Screen, SPACE, StateView, TextField } from "@sting/ui-native";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { goAfterSetup } from "@/lib/after-setup";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

/**
 * ضبط PIN بعد تجهيز الجهاز (0005 §١٧٣ — لا مقابل في الويب: لم يكن فيه طريق لضبط PIN). المستخدم يختار
 * ستة أرقام ويؤكد كلمة مروره؛ الخادم يحفظ متحققاً لا نصاً، ثم تُنزَّل متحققات الفرع ليعمل القفل بلا
 * شبكة. «لاحقاً» يكمل بلا رمز — والقفل حينها يقول ذلك ويعرض الدخول بكلمة المرور.
 */
export default function SetPin() {
  const router = useRouter();
  const { state, api, completeSetup } = useSession();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{
    field: "pin" | "confirm" | "password";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  if (state.status !== "active") return <Redirect href="/" />;

  const finish = () => {
    completeSetup();
    goAfterSetup(router);
  };

  const save = async () => {
    if (busy) return;
    if (!/^\d{6}$/.test(pin)) return setError({ field: "pin", text: mtx("pinInvalid") });
    if (pin !== confirm) return setError({ field: "confirm", text: mtx("pinMismatch") });
    setError(null);
    setBusy(true);
    try {
      const { response } = await api.POST("/api/account/pin", { body: { pin, password } });
      if (response.status === 403) {
        setError({ field: "password", text: mtx("pinPasswordInvalid") });
        return;
      }
      if (response.status === 400) {
        setError({ field: "pin", text: mtx("pinInvalid") });
        return;
      }
      if (!response.ok) return;
      // المتحقق الجديد إلى الجهاز — القفل يعمل بلا شبكة من الآن
      const { data } = await api.GET("/api/devices/verifiers");
      if (data) {
        await storeVerifiers(await getStorage(), { ...data, fetched_at: new Date().toISOString() });
      }
      finish();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      screenId="NAT-PIN"
      state={error ? "validation_error" : "ready"}
      title={mtx("pinSetTitle")}
    >
      <AppText variant="secondary" muted style={{ marginBottom: SPACE["4"] }}>
        {mtx("pinSetBody")}
      </AppText>
      {error?.field === "password" ? (
        <StateView state="validation_error" title={error.text} />
      ) : null}
      <TextField
        label={mtx("pinField")}
        value={pin}
        onChangeText={(v) => setPin(v.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        secure
        mono
        maxLength={6}
        error={error?.field === "pin" ? error.text : undefined}
        required
      />
      <TextField
        label={mtx("pinConfirm")}
        value={confirm}
        onChangeText={(v) => setConfirm(v.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        secure
        mono
        maxLength={6}
        error={error?.field === "confirm" ? error.text : undefined}
        required
      />
      <TextField
        label={tx("ACC-02", "كلمة المرور")}
        value={password}
        onChangeText={setPassword}
        secure
        autoComplete="current-password"
        textContentType="password"
        required
      />
      <Button label={mtx("pinSave")} financial loading={busy} onPress={() => void save()} />
      <View style={{ marginTop: SPACE["4"], alignItems: "center" }}>
        <Button label={mtx("pinLater")} variant="quiet" onPress={finish} />
      </View>
    </Screen>
  );
}

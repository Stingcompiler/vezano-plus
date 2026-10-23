import { isEmailLike, normalizeContactPhone, PASSWORD_MIN } from "@sting/app-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  FONT,
  Screen,
  SPACE,
  StateView,
  TextField,
  useColors,
  ThemedText as Text,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { API_URL, useSession } from "@/lib/session";

const T = "ACC-02";
type Step = "form" | "verify" | "password";

const MESSAGES: Record<string, string> = {
  name_required: tx(T, "اكتب اسمك — يظهر لفريقك في الأدوار والسجل."),
  identifier_required: tx(T, "اكتب بريدك."),
  phone_invalid: tx(T, "اكتب رقم واتساب صحيحاً — يتواصل منه فريق فيزانو معك عند الحاجة."),
  identifier_invalid: tx(T, "البريد غير صالح."),
  email_only: tx(T, "التسجيل بالبريد الإلكتروني حالياً — اكتب بريدك، وإليه يصل رمز التحقق."),
  resend_too_soon: tx(T, "طُلب رمز قبل قليل — انتظر ثم أعد المحاولة."),
  send_failed: tx(T, "تعذّر إرسال الرمز الآن. أعد المحاولة بعد قليل."),
  offline: tx(T, "لا اتصال — التسجيل يحتاج الشبكة مرة واحدة."),
  code_invalid: tx(T, "الرمز غير صحيح."),
  code_expired: tx(T, "انتهى الرمز — اطلب رمزاً جديداً."),
  password_short: tx(T, "كلمة المرور ثمانية أحرف على الأقل."),
  password_mismatch: tx(T, "كلمتا المرور غير متطابقتين."),
  account_exists: tx(T, "هذا المعرّف مسجَّل من قبل — ادخل بكلمة مرورك أو استعدها."),
  ticket_invalid: tx(T, "انتهت صلاحية التحقق — ابدأ من جديد."),
};

function N({ children }: { children: string | number }) {
  return <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>{String(children)}</Text>;
}

/**
 * ACC-02 — حساب جديد على الهاتف (خطة الجوال M1؛ 0005 §١٧٦). مكدّس بخطوات كالويب (`register-client.tsx`):
 * الاسم والبريد وواتساب ← رمز التحقق بغرض `register` ← كلمة المرور ← تذكرة اختيار بلا عضويات ←
 * إنشاء المنشأة (ACC-04). لوحة المفاتيح المناسبة لكل حقل، والرمز خانة رقمية واحدة بملء رمز النظام.
 */
export default function Register() {
  const router = useRouter();
  const { api, signIn } = useSession();
  const c = useColors();
  const [step, setStep] = useState<Step>("form");
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeLength, setCodeLength] = useState(6);
  const [ticket, setTicket] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  // بيئة التطوير فقط (G-02): حارس السيناريو يعيد آخر رمز؛ في الإنتاج 404 فلا يظهر شيء
  const [devCode, setDevCode] = useState<string | null>(null);

  const fetchDevCode = async (id: string) => {
    try {
      const r = await fetch(
        `${API_URL}/api/scenario/verification-code?identifier=${encodeURIComponent(id)}`,
      );
      setDevCode(r.ok ? (((await r.json()) as { code?: string }).code ?? null) : null);
    } catch {
      setDevCode(null);
    }
  };

  const requestCode = async () => {
    if (busy) return;
    setErr(null);
    if (!name.trim()) return setErr("name_required");
    if (!identifier.trim()) return setErr("identifier_required");
    // التسجيل بالبريد وحده حتى تُربط قناة الهاتف (0005 §١٤٩) — والخادم يفرضه أيضاً
    if (!isEmailLike(identifier)) return setErr("email_only");
    if (normalizeContactPhone(phone) === null) return setErr("phone_invalid");
    setBusy(true);
    try {
      const { data, error, response } = await api.POST("/api/auth/verify/request", {
        body: { identifier: identifier.trim(), purpose: "register" },
      });
      if (response.status === 202 && data) {
        setCodeLength(data.policy.code_length);
        setCode("");
        setStep("verify");
        void fetchDevCode(identifier.trim());
        return;
      }
      const detail = (error as { detail?: string } | undefined)?.detail ?? "";
      setErr(
        ["identifier_invalid", "email_only", "resend_too_soon"].includes(detail)
          ? detail
          : "send_failed",
      );
    } catch {
      setErr("offline");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (busy || code.length < codeLength) return;
    setErr(null);
    setBusy(true);
    try {
      const { data, error, response } = await api.POST("/api/auth/verify/confirm", {
        body: { identifier: identifier.trim(), purpose: "register", code },
      });
      if (response.ok && data) {
        setTicket(data.verified_ticket);
        setStep("password");
        return;
      }
      const body = error as { detail?: string; attempts_left?: number } | undefined;
      if (body?.detail === "code_invalid") setAttemptsLeft(body.attempts_left ?? null);
      setErr(body?.detail === "code_expired" ? "code_expired" : "code_invalid");
    } catch {
      setErr("offline");
    } finally {
      setBusy(false);
    }
  };

  const register = async () => {
    if (busy) return;
    setErr(null);
    if (password.length < PASSWORD_MIN) return setErr("password_short");
    if (password !== password2) return setErr("password_mismatch");
    setBusy(true);
    try {
      const { data, error, response } = await api.POST("/api/auth/account/register", {
        body: { verified_ticket: ticket, password, display_name: name.trim(), phone: phone.trim() },
      });
      if (response.status === 201 && data) {
        // تذكرة اختيار بلا عضويات ← إنشاء المنشأة بها
        signIn({ select_ticket: data.select_ticket ?? "", memberships: data.memberships ?? [] });
        router.replace("/create-org");
        return;
      }
      const detail = (error as { detail?: string } | undefined)?.detail ?? "";
      // الرقم يُصحَّح في خطوته الأولى — لا حقل له في خطوة كلمة المرور
      if (detail === "phone_invalid") setStep("form");
      setErr(detail === "account_exists" || detail === "phone_invalid" ? detail : "ticket_invalid");
    } catch {
      setErr("offline");
    } finally {
      setBusy(false);
    }
  };

  const state = busy
    ? "saving"
    : err
      ? err === "offline"
        ? "offline"
        : "validation_error"
      : "ready";
  const error = err ? (
    <StateView
      state={err === "offline" ? "offline" : "validation_error"}
      title={MESSAGES[err] ?? err}
    >
      {err === "account_exists" ? (
        <Button
          label={tx(T, "لي حساب — دخول")}
          variant="quiet"
          onPress={() => router.replace("/login")}
        />
      ) : null}
    </StateView>
  ) : null;

  // شريط الخطوات: «1 من 3» بالأرقام mono والكلمة بجانبها
  const stepNo = step === "form" ? 1 : step === "verify" ? 2 : 3;

  return (
    <Screen
      screenId={T}
      state={state}
      title={
        step === "form"
          ? tx(T, "حساب جديد في فيزانو بلص")
          : step === "verify"
            ? tx(T, "أدخل رمز التحقق")
            : tx(T, "اختر كلمة مرور")
      }
    >
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 1, max: 3, now: stepNo }}
        style={{ flexDirection: "row", gap: SPACE["2"], marginBottom: SPACE["4"] }}
      >
        {[1, 2, 3].map((n) => (
          <View
            key={n}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: n <= stepNo ? c.brandPrimary : c.border,
            }}
          />
        ))}
      </View>

      {step === "form" ? (
        <>
          <AppText variant="secondary" muted style={{ marginBottom: SPACE["4"] }}>
            {tx(
              T,
              "حساب إدارة المتجر: بعده تُنشئ منشأتك وفرعها الأول وتبدأ التجربة. زبون المحل لا يحتاج حساباً هنا.",
            )}
          </AppText>
          {error}
          <TextField
            label={tx(T, "اسمك")}
            value={name}
            onChangeText={setName}
            autoComplete="name"
            textContentType="name"
            editable={!busy}
            required
          />
          <TextField
            label={tx(T, "بريدك")}
            hint={tx(T, "إليه يصل رمز التحقق، وبه تدخل لاحقاً.")}
            placeholder="name@example.com"
            value={identifier}
            onChangeText={setIdentifier}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            editable={!busy}
            required
          />
          <TextField
            label={tx(T, "رقم واتساب")}
            hint={tx(T, "يتواصل منه فريق فيزانو معك عند الحاجة — لا رسائل تسويقية.")}
            placeholder="0912345678"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            mono
            editable={!busy}
            required
          />
          <Button
            label={tx(T, "أرسل رمز التحقق")}
            financial
            loading={busy}
            onPress={() => void requestCode()}
          />
          <View style={{ marginTop: SPACE["4"], alignItems: "center" }}>
            <Button
              label={tx(T, "لي حساب — دخول")}
              variant="quiet"
              onPress={() => router.replace("/login")}
            />
          </View>
        </>
      ) : null}

      {step === "verify" ? (
        <>
          <AppText variant="secondary" muted style={{ marginBottom: SPACE["4"] }}>
            {tx(T, "أرسلنا رمزاً إلى")} <N>{identifier.trim()}</N>
            {tx(T, ". أدخله لتأكيد أن المعرّف لك.")}
          </AppText>
          {error}
          {devCode ? (
            <StateView state="ready" title={tx(T, "بيئة تطوير — لا مزوّد إرسال بعد")}>
              <AppText variant="secondary">
                {tx(T, "الرمز الذي كان سيصلك:")} <N>{devCode}</N>
              </AppText>
              <Button
                label={tx(T, "املأ الرمز")}
                variant="secondary"
                onPress={() => setCode(devCode)}
              />
            </StateView>
          ) : null}
          <TextField
            label={tx(T, "رمز التحقق")}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, codeLength))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={codeLength}
            mono
            editable={!busy}
            error={
              attemptsLeft !== null && err === "code_invalid"
                ? `${tx(T, "خطأ تحقق —")} ${attemptsLeft}`
                : undefined
            }
            required
          />
          <View style={{ gap: SPACE["2"] }}>
            <Button
              label={tx(T, "تأكيد الرمز")}
              loading={busy}
              disabledReason={code.length < codeLength ? tx(T, "أكمل الرمز") : undefined}
              onPress={() => void confirm()}
            />
            <Button
              label={tx(T, "إرسال رمز جديد")}
              variant="secondary"
              onPress={() => void requestCode()}
            />
            <Button label={tx(T, "غيّر المعرّف")} variant="quiet" onPress={() => setStep("form")} />
          </View>
        </>
      ) : null}

      {step === "password" ? (
        <>
          <AppText variant="secondary" muted style={{ marginBottom: SPACE["4"] }}>
            {tx(T, "تحقّق المعرّف")} <N>{identifier.trim()}</N>
            {tx(T, ". كلمة المرور ثمانية أحرف على الأقل — تدخل بها على أي جهاز.")}
          </AppText>
          {error}
          <TextField
            label={tx(T, "كلمة المرور")}
            value={password}
            onChangeText={setPassword}
            secure
            autoComplete="new-password"
            textContentType="newPassword"
            editable={!busy}
            required
          />
          <TextField
            label={tx(T, "تأكيد كلمة المرور")}
            value={password2}
            onChangeText={setPassword2}
            secure
            autoComplete="new-password"
            textContentType="newPassword"
            editable={!busy}
            required
          />
          <Button
            label={tx(T, "أنشئ الحساب وتابع إلى المنشأة")}
            financial
            loading={busy}
            onPress={() => void register()}
          />
        </>
      ) : null}
    </Screen>
  );
}

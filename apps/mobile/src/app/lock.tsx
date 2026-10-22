import {
  attemptUnlock,
  type DeviceVerifiers,
  PIN_LOCK_POLICY,
  readPinLock,
  readVerifiers,
} from "@sting/sync-core";
import { mtx, tx } from "@sting/texts";
import {
  AppText,
  Button,
  Mono,
  RADIUS,
  ROW_RTL,
  Screen,
  SPACE,
  StateView,
  TOUCH,
  useColors,
} from "@sting/ui-native";
import { Redirect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import { noblePbkdf2 } from "@/lib/kdf";
import { SECRET_KEYS, secrets } from "@/lib/secrets";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "ACC-07";
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"] as const;

/**
 * ACC-07 — القفل المحلي (خطة الجوال M1؛ 0005 §١٧٣). لوحة أرقام كبيرة (لمس 56)، والتحقق محلي بنفس
 * خوارزمية الخادم (`attemptUnlock` من sync-core بمشتقّ يعمل على الهاتف) بلا شبكة. خمس محاولات خاطئة
 * تقفل 15 دقيقة. الفتح لصاحب الجلسة وحده؛ وبعد إغلاق التطبيق يدوّر رمز الجهاز فتعود الجلسة بلا كلمة مرور.
 */
export default function Lock() {
  const router = useRouter();
  const { state, unlock, signOut } = useSession();
  const c = useColors();
  const [device, setDevice] = useState<DeviceVerifiers | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(0);
  const [wait, setWait] = useState(0);
  const [otherUser, setOtherUser] = useState("");
  const [revoked, setRevoked] = useState(false);
  const [preferUser, setPreferUser] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const storage = await getStorage();
      const [v, lock, lastUser] = await Promise.all([
        readVerifiers(storage),
        readPinLock(storage),
        secrets()
          .get(SECRET_KEYS.userId)
          .catch(() => null),
      ]);
      if (cancelled) return;
      setDevice(v);
      setPreferUser(state.userId ?? lastUser);
      if (lock.lockedUntil) {
        const left = Math.ceil((new Date(lock.lockedUntil).getTime() - Date.now()) / 1000);
        if (left > 0) setWait(left);
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [state.userId]);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const pinLength = device?.pin_length ?? 6;

  const submit = useCallback(
    async (candidate: string) => {
      setBusy(true);
      try {
        const r = await attemptUnlock(await getStorage(), candidate, undefined, {
          kdf: noblePbkdf2,
          preferUserId: preferUser,
        });
        setPin("");
        if (r.kind === "unlocked") {
          // جلسة حيّة لمستخدم آخر: لا يفتحها رمز غيره (تسليم الوردية طريق التبديل)
          if (state.tokens && state.userId && r.user.user_id !== state.userId) {
            setOtherUser(r.user.display_name);
            return;
          }
          const out = await unlock(r.user.user_id);
          if (out === "revoked") {
            setRevoked(true);
            return;
          }
          router.replace("/");
          return;
        }
        setOtherUser("");
        if (r.kind === "wrong") setFailed(r.failed);
        if (r.kind === "locked") {
          setFailed(PIN_LOCK_POLICY.maxAttempts);
          setWait(Math.ceil((new Date(r.until).getTime() - Date.now()) / 1000));
        }
        if (r.kind === "revoked" || r.kind === "no_verifiers") setRevoked(true);
      } finally {
        setBusy(false);
      }
    },
    [preferUser, router, state.tokens, state.userId, unlock],
  );

  const press = (k: (typeof KEYS)[number]) => {
    if (busy || wait > 0 || !k) return;
    if (k === "del") return setPin((p) => p.slice(0, -1));
    const next = (pin + k).slice(0, pinLength);
    setPin(next);
    if (next.length === pinLength) void submit(next);
  };

  if (state.status === "anonymous") return <Redirect href="/welcome" />;

  const toPassword = () => {
    signOut();
    router.replace("/login");
  };

  const screenState = revoked ? "permission_denied" : failed > 0 ? "validation_error" : "ready";
  const user =
    device?.verifiers.find((v) => v.user_id === preferUser) ?? device?.verifiers[0] ?? null;

  return (
    <Screen screenId={T} state={screenState} title={tx(T, "فيزانو بلص")}>
      {user ? (
        <AppText variant="bodyStrong" style={{ marginBottom: SPACE["1"] }}>
          {user.display_name}
        </AppText>
      ) : null}
      <AppText variant="secondary" muted style={{ marginBottom: SPACE["4"] }}>
        {tx(T, "هذا قفل محلي لا تسجيل دخول. يعمل بلا شبكة ولا يُنشئ جلسة خادمية جديدة.")}
      </AppText>

      {loaded && !device?.verifiers.length ? (
        <StateView state="empty" title={tx(T, "لا رمز PIN محفوظ على هذا الجهاز")}>
          <AppText variant="secondary">
            {tx(T, "القفل يحتاج رمزاً نُزّل عند تجهيز الجهاز. ادخل بكلمة المرور ثم جهّز الجهاز.")}
          </AppText>
        </StateView>
      ) : null}

      {revoked ? (
        <StateView
          state="permission_denied"
          title={tx(T, "الرمز صحيح — لكن وصولك إلى هذا الجهاز سُحب")}
        >
          <AppText variant="secondary">
            {tx(T, "إن كان له عملٌ معلّق على هذا الجهاز فله تصديره أو طلب استرداده")}
          </AppText>
        </StateView>
      ) : null}

      {otherUser ? (
        <StateView
          state="permission_denied"
          title={`${otherUser} ${tx(T, "— الجلسة المفتوحة لغيره")}`}
        >
          <AppText variant="secondary">
            {tx(T, "الفتح لصاحب الجلسة وحده. التبديل بين المستخدمين يمر بتسليم الوردية.")}
          </AppText>
        </StateView>
      ) : null}

      {failed > 0 && wait <= 0 ? (
        <StateView state="validation_error" title={tx(T, "محاولة خاطئة —")}>
          <View style={{ flexDirection: ROW_RTL, gap: SPACE["1"], alignItems: "baseline" }}>
            <Mono>{failed}</Mono>
            <AppText variant="secondary">{tx(T, "من")}</AppText>
            <Mono>{PIN_LOCK_POLICY.maxAttempts}</Mono>
          </View>
          <AppText variant="secondary">{tx(T, "بعد الخامسة يُقفل الجهاز")}</AppText>
        </StateView>
      ) : null}

      {wait > 0 ? (
        <StateView state="validation_error" title={tx(T, "بعد الخامسة يُقفل الجهاز")}>
          <View style={{ flexDirection: ROW_RTL, gap: SPACE["1"], alignItems: "baseline" }}>
            <Mono>{wait}</Mono>
            <AppText variant="secondary">{tx(T, "ثانية")}</AppText>
          </View>
          <AppText variant="secondary">
            {tx(T, "دقيقة. لا يُحذف شيء ولا تُرسل عمليات، والمالك يستطيع فتحه من شاشة الأجهزة.")}
          </AppText>
        </StateView>
      ) : null}

      {device?.verifiers.length ? (
        <>
          {/* خانات الرمز — نقاط لا أرقام */}
          <View
            accessibilityLabel={`${pin.length} / ${pinLength}`}
            style={{
              flexDirection: ROW_RTL,
              justifyContent: "center",
              gap: SPACE["3"],
              marginVertical: SPACE["4"],
            }}
          >
            {Array.from({ length: pinLength }, (_, i) => (
              <View
                key={i}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  backgroundColor: i < pin.length ? c.brandPrimary : c.border,
                }}
              />
            ))}
          </View>
          {busy ? (
            <View style={{ alignItems: "center", marginBottom: SPACE["3"] }}>
              <ActivityIndicator accessibilityLabel={mtx("lockChecking")} />
            </View>
          ) : null}
          <View
            style={{
              flexDirection: ROW_RTL,
              flexWrap: "wrap",
              justifyContent: "center",
              gap: SPACE["3"],
            }}
          >
            {KEYS.map((k, i) =>
              k ? (
                <Pressable
                  key={`${k}-${i}`}
                  accessibilityRole="button"
                  accessibilityLabel={k === "del" ? tx(T, "حذف") : k}
                  disabled={busy || wait > 0}
                  onPress={() => press(k)}
                  style={({ pressed }) => ({
                    width: 88,
                    height: TOUCH.financial + 8,
                    borderRadius: RADIUS.button,
                    borderWidth: 1,
                    borderColor: c.border,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: pressed ? c.surfaceSunken : c.surfaceCard,
                    opacity: busy || wait > 0 ? 0.5 : 1,
                  })}
                >
                  {k === "del" ? (
                    <AppText variant="bodyStrong">{tx(T, "حذف")}</AppText>
                  ) : (
                    <Mono>{k}</Mono>
                  )}
                </Pressable>
              ) : (
                <View key={`blank-${i}`} style={{ width: 88, height: TOUCH.financial + 8 }} />
              ),
            )}
          </View>
        </>
      ) : null}

      <View style={{ marginTop: SPACE["6"], alignItems: "center" }}>
        <Button
          label={tx(T, "نسيت الرمز؟ ادخل بكلمة المرور")}
          variant="quiet"
          onPress={toPassword}
        />
      </View>
    </Screen>
  );
}

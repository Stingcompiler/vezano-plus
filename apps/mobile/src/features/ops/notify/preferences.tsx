import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  Screen,
  SPACE,
  StateView,
  TextField,
  TOUCH,
  useColors,
} from "@sting/ui-native";
import { useCallback, useEffect, useState } from "react";
import { Switch, View } from "react-native";

import { N, Strong } from "@/components/ops/ui";
import { call, detailOf } from "@/features/ops/net";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "NOT-02";
type State = "ready" | "validation_error" | "offline" | "success";

export interface Prefs {
  operational: { in_app: boolean; sms: boolean };
  account: { in_app: boolean; email: boolean };
  marketing: { in_app: boolean; email: boolean };
}
interface Payload {
  prefs: Prefs;
  destination_email: string;
  sms_balance: { remaining: number; quota: number };
  counts: { in_app: number; sms: number; email: number };
  updated_at: string;
  is_owner: boolean;
}

export const PREFS_PENDING = "not.prefs_pending";

export const countsOf = (p: Prefs) => ({
  in_app: Number(p.operational.in_app) + Number(p.account.in_app) + Number(p.marketing.in_app),
  sms: Number(p.operational.sms),
  email: Number(p.account.email) + Number(p.marketing.email),
});

function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  const c = useColors();
  return (
    <View
      style={{
        minHeight: TOUCH.row,
        paddingHorizontal: SPACE["4"],
        paddingVertical: SPACE["2"],
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE["3"],
      }}
    >
      <View style={{ flex: 1 }}>
        <AppText>{label}</AppText>
        {hint ? (
          <AppText variant="secondary" muted>
            {hint}
          </AppText>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={checked}
        onValueChange={onChange}
        trackColor={{ true: c.brandPrimary, false: c.border }}
      />
    </View>
  );
}

/**
 * NOT-02 — تفضيلات التنبيه (نظير `preferences-client.tsx`): التشغيلي داخل التطبيق غير قابل للإطفاء؛
 * الرسائل النصية تُكلِّف فنعرض الرصيد؛ قناة بلا وجهة لا تُحفظ؛ بلا اتصال تُحفظ محلياً وتُرفع لاحقاً
 * وتسري محلياً فوراً؛ بعد الحفظ نقول ما صار فعّالاً بالعدّ.
 */
export function PreferencesScreen() {
  const { api } = useSession();
  const c = useColors();
  const [server, setServer] = useState<Payload | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Payload["counts"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingLocal, setPendingLocal] = useState(false);

  const load = useCallback(async () => {
    const r = await call<Payload>(() => api.GET("/api/notifications/preferences", {}));
    if (!r.ok || !r.data) return;
    setServer(r.data);
    setPrefs(r.data.prefs);
    setEmail(r.data.destination_email);
  }, [api]);

  const flushPending = useCallback(async () => {
    const storage = await getStorage();
    const raw = await storage.read((t) => t.getMeta(PREFS_PENDING));
    if (!raw) return;
    const body = JSON.parse(raw) as { prefs: Prefs; email: string };
    const r = await call(
      () => api.PUT("/api/notifications/preferences", { body: body as never }) as never,
    );
    if (r.ok || r.status === 400) {
      await storage.transaction((t) => t.putMeta(PREFS_PENDING, ""));
      setPendingLocal(false);
    }
  }, [api]);

  useEffect(() => {
    void (async () => {
      try {
        const storage = await getStorage();
        const raw = await storage.read((t) => t.getMeta(PREFS_PENDING));
        if (raw) {
          const local = JSON.parse(raw) as { prefs: Prefs; email: string };
          setPrefs(local.prefs);
          setEmail(local.email);
          setPendingLocal(true);
        }
      } catch {
        /* بلا تخزين */
      }
      await flushPending().catch(() => undefined);
      await load();
    })();
  }, [flushPending, load]);

  const set = (cat: keyof Prefs, ch: string, on: boolean) => {
    setSaved(null);
    setError(null);
    setPrefs((p) => (p ? { ...p, [cat]: { ...p[cat], [ch]: on } } : p));
  };

  const keepLocal = async (p: Prefs) => {
    const storage = await getStorage();
    await storage.transaction((t) => t.putMeta(PREFS_PENDING, JSON.stringify({ prefs: p, email })));
    setPendingLocal(true);
  };

  const save = async () => {
    if (!prefs || busy) return;
    setBusy(true);
    setSaved(null);
    setError(null);
    try {
      if ((prefs.account.email || prefs.marketing.email) && !email.trim()) {
        setError("channel_without_destination");
        return;
      }
      const r = await call<Payload>(() =>
        api.PUT("/api/notifications/preferences", { body: { prefs, email } as never }),
      );
      if (r.status === 400) {
        setError(detailOf(r.error));
        return;
      }
      if (!r.ok || !r.data) {
        await keepLocal(prefs);
        return;
      }
      setPendingLocal(false);
      setServer(r.data);
      setPrefs(r.data.prefs);
      setSaved(r.data.counts);
    } finally {
      setBusy(false);
    }
  };

  const state: State = error
    ? "validation_error"
    : pendingLocal
      ? "offline"
      : saved
        ? "success"
        : "ready";
  const paidOn = prefs ? prefs.operational.sms : false;
  const now = prefs ? countsOf(prefs) : null;

  return (
    <Screen screenId={T} state={state} title={tx(T, "الإشعارات")}>
      <AppText variant="section">{tx(T, "تفضيلات التنبيه")}</AppText>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "التشغيلي غير قابل للإطفاء لأنه يخصّ مالك وذمم.")}
      </AppText>

      {state === "validation_error" ? (
        <StateView state="validation_error" title={tx(T, "قناة بلا وجهة")}>
          <AppText variant="secondary">{tx(T, "فُعّل تنبيه البريد ولا بريد في الحساب.")}</AppText>
          <AppText variant="secondary">
            <Strong>{tx(T, "لا نحفظ تفضيلاً معطّلاً")}</Strong>{" "}
            {tx(T, "· نطلب البريد هنا في مكانه.")}
          </AppText>
        </StateView>
      ) : null}
      {state === "offline" ? (
        <StateView state="offline" title={tx(T, "حُفظ محلياً")}>
          <AppText variant="secondary">
            {tx(T, "التفضيلات تُحفظ على الجهاز وتُرفع لاحقاً؛ تسري محلياً فوراً.")}
          </AppText>
          <AppText variant="secondary">
            <Strong>{tx(T, "الحدّ المُعلن")}</Strong>{" "}
            {tx(T, "· التنبيهات الخادمية تتبع التفضيل القديم حتى يُرفع.")}
          </AppText>
        </StateView>
      ) : null}
      {state === "success" && saved ? (
        <StateView state="success" title={tx(T, "حُفظت")}>
          <AppText variant="secondary">
            <N>{saved.in_app}</N> {tx(T, "تنبيهات على التطبيق ·")} <N>{saved.email}</N>{" "}
            {tx(T, "بالبريد ·")} <N>{saved.sms}</N> {tx(T, "برسالة نصية.")}
          </AppText>
        </StateView>
      ) : null}

      {prefs ? (
        <>
          <GroupedList>
            <View
              style={{
                minHeight: TOUCH.row,
                paddingHorizontal: SPACE["4"],
                paddingVertical: SPACE["2"],
                flexDirection: "row",
                alignItems: "center",
                gap: SPACE["3"],
              }}
            >
              <View style={{ flex: 1 }}>
                <AppText>{tx(T, "تنبيهات التشغيل — داخل التطبيق")}</AppText>
                <AppText variant="secondary" muted>
                  {tx(T, "ورديات وذمم ومزامنة وطلبات. تخصّ مالك، فلا تُطفأ.")}
                </AppText>
              </View>
              <AppText variant="note" style={{ color: c.state.synced.fg }}>
                {tx(T, "دائم")}
              </AppText>
            </View>
            <SwitchRow
              label={tx(T, "تنبيهات التشغيل — رسالة نصية")}
              hint={tx(T, "للحالات الحرجة فقط: وردية مهجورة، فشل مزامنة يتجاوز يوماً.")}
              checked={prefs.operational.sms}
              onChange={(on) => set("operational", "sms", on)}
            />
            <SwitchRow
              label={tx(T, "إشعارات حسابية — الاشتراك والفواتير")}
              hint={tx(T, "تذكير التجديد وحالة الدفع")}
              checked={prefs.account.in_app}
              onChange={(on) => set("account", "in_app", on)}
            />
            <SwitchRow
              label={tx(T, "إشعارات حسابية بالبريد")}
              checked={prefs.account.email}
              onChange={(on) => set("account", "email", on)}
            />
            <SwitchRow
              label={tx(T, "عروض ومنتجات المنصة")}
              hint={tx(T, "إطفاؤها لا يؤثر على أي شيء تشغيلي")}
              checked={prefs.marketing.in_app}
              onChange={(on) => set("marketing", "in_app", on)}
            />
            <SwitchRow
              label={tx(T, "عروض المنصة بالبريد")}
              checked={prefs.marketing.email}
              onChange={(on) => set("marketing", "email", on)}
            />
          </GroupedList>
          {!prefs.marketing.in_app ? (
            <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
              {tx(T, "موقوف")}
            </AppText>
          ) : null}

          {paidOn && server ? (
            <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
              <Strong>{tx(T, "الرسائل النصية تُكلِّف.")}</Strong>{" "}
              {tx(
                T,
                "نعرض رصيد الرسائل المتبقي عند تفعيل أي قناة مدفوعة، ولا نرسل عبرها إلا ما اخترتَه صراحة. المتبقي",
              )}{" "}
              <N>{server.sms_balance.remaining}</N> {tx(T, "من")} <N>{server.sms_balance.quota}</N>{" "}
              {tx(T, "هذا الشهر.")}
            </AppText>
          ) : null}

          {prefs.account.email || prefs.marketing.email || error ? (
            <TextField
              label={tx(T, "البريد للتنبيهات")}
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                setError(null);
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              mono
              required
              error={
                error === "channel_without_destination"
                  ? tx(T, "لا بريد في الحساب — أدخله هنا")
                  : error === "email_invalid"
                    ? tx(T, "بريد غير صالح")
                    : undefined
              }
            />
          ) : null}
          {now ? (
            <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
              {tx(T, "فعّال الآن:")} <N>{now.in_app}</N> {tx(T, "على التطبيق ·")} <N>{now.email}</N>{" "}
              {tx(T, "بالبريد ·")} <N>{now.sms}</N> {tx(T, "نصية")}
            </AppText>
          ) : null}
          <Button label={tx(T, "حفظ")} onPress={() => void save()} loading={busy} />
        </>
      ) : null}
    </Screen>
  );
}

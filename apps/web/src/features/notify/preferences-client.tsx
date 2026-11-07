"use client";

import { Button, Frame, Notice, Status, SwitchField, TextField } from "@sting/ui-web";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "./notify.css";
import { AppNav } from "@/features/home/app-nav";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";

type State = "ready" | "validation_error" | "offline" | "success";

// 0005 §٢١٦: «push» = إشعار فوري على الأجهزة المشتركة — اختياري في النوع لأن تفضيلاً محفوظاً
// محلياً قبل الإضافة قد لا يحمله
interface Prefs {
  operational: { in_app: boolean; sms: boolean; push?: boolean };
  account: { in_app: boolean; email: boolean; push?: boolean };
  marketing: { in_app: boolean; email: boolean; push?: boolean };
}

interface Payload {
  prefs: Prefs;
  quiet_hours?: boolean;
  destination_email: string;
  sms_balance: { remaining: number; quota: number };
  counts: { in_app: number; sms: number; email: number };
  updated_at: string;
  is_owner: boolean;
}

const PENDING = "not.prefs_pending";

const countsOf = (p: Prefs) => ({
  in_app: Number(p.operational.in_app) + Number(p.account.in_app) + Number(p.marketing.in_app),
  sms: Number(p.operational.sms),
  email: Number(p.account.email) + Number(p.marketing.email),
});

/**
 * NOT-02 — تفضيلات التنبيه (17-D12 ready · 36-D28 validation_error/offline/success): قناتان
 * ونوعان؛ التشغيلي داخل التطبيق غير قابل للإطفاء لأنه يخصّ مالك وذمم؛ الرسائل النصية تُكلِّف فنعرض
 * الرصيد المتبقي؛ قناة بلا وجهة لا تُحفظ؛ بلا اتصال تُحفظ محلياً وتُرفع وتسري محلياً فوراً؛ بعد الحفظ
 * نقول ما صار فعّالاً بالعدّ (§١١.٦).
 */
export function PreferencesClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [server, setServer] = useState<Payload | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Payload["counts"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingLocal, setPendingLocal] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/notifications/preferences", {});
    const body = data as unknown as Payload | undefined;
    if (!response.ok || !body) return;
    setServer(body);
    setPrefs(body.prefs);
    setEmail(body.destination_email);
    setQuiet(Boolean(body.quiet_hours));
  }, []);

  const flushPending = useCallback(async () => {
    const raw = await getStorage().read((tx) => tx.getMeta(PENDING));
    if (!raw) return;
    // مراجعة 2026-11-08: ساعات الهدوء تُرفع مع التفضيل المحفوظ محلياً، لا تضيع
    const body = JSON.parse(raw) as { prefs: Prefs; email: string; quiet_hours?: boolean };
    const { response } = await api().PUT("/api/notifications/preferences", {
      body: body as never,
    });
    if (response.ok || response.status === 400) {
      await getStorage().transaction((tx) => tx.putMeta(PENDING, ""));
      setPendingLocal(false);
    }
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fnotify%2Fpreferences");
      return;
    }
    void (async () => {
      try {
        const raw = await getStorage().read((tx) => tx.getMeta(PENDING));
        if (raw) {
          const local = JSON.parse(raw) as { prefs: Prefs; email: string; quiet_hours?: boolean };
          setPrefs(local.prefs);
          setEmail(local.email);
          if (local.quiet_hours !== undefined) setQuiet(local.quiet_hours);
          setPendingLocal(true);
        }
      } catch {
        /* بلا تخزين */
      }
      await load().catch(() => undefined);
    })();
  }, [router, load]);

  useEffect(() => {
    if (online)
      void flushPending()
        .then(load)
        .catch(() => undefined);
  }, [online, flushPending, load]);

  const set = (cat: keyof Prefs, ch: string, on: boolean) => {
    setSaved(null);
    setError(null);
    setPrefs((p) => (p ? { ...p, [cat]: { ...p[cat], [ch]: on } } : p));
  };

  const save = async () => {
    if (!prefs || busy) return;
    setBusy(true);
    setSaved(null);
    setError(null);
    const wantsEmail = prefs.account.email || prefs.marketing.email;
    if (wantsEmail && !email.trim()) {
      setError("channel_without_destination");
      setBusy(false);
      return;
    }
    try {
      if (!online) {
        // بلا اتصال: تُحفظ على الجهاز وتُرفع لاحقاً؛ تسري محلياً فوراً
        await getStorage().transaction((tx) =>
          tx.putMeta(PENDING, JSON.stringify({ prefs, email, quiet_hours: quiet })),
        );
        setPendingLocal(true);
        return;
      }
      const { data, error, response } = await api().PUT("/api/notifications/preferences", {
        body: { prefs, email, quiet_hours: quiet } as never,
      });
      if (response.status === 400) {
        setError((error as unknown as { detail: string }).detail);
        return;
      }
      const body = data as unknown as Payload | undefined;
      if (!response.ok || !body) {
        await getStorage().transaction((tx) =>
          tx.putMeta(PENDING, JSON.stringify({ prefs, email, quiet_hours: quiet })),
        );
        setPendingLocal(true);
        return;
      }
      setServer(body);
      setPrefs(body.prefs);
      setQuiet(Boolean(body.quiet_hours));
      setSaved(body.counts);
    } catch {
      await getStorage().transaction((tx) =>
        tx.putMeta(PENDING, JSON.stringify({ prefs, email, quiet_hours: quiet })),
      );
      setPendingLocal(true);
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

  return (
    <Frame title="الإشعارات" nav={<AppNav currentId="prefs" />} footer={null}>
      <div className="sys sys--wide sys--cols not" data-screen="NOT-02" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">تفضيلات التنبيه</h2>
            <span className="cat-head__hint">التشغيلي غير قابل للإطفاء لأنه يخصّ مالك وذمم.</span>
          </div>
          <div className="acc-card__body">
            {state === "validation_error" ? (
              <Notice kind="warning" title="قناة بلا وجهة">
                <p className="acc-lead">فُعّل تنبيه البريد ولا بريد في الحساب.</p>
                <p className="acc-lead">
                  <strong>لا نحفظ تفضيلاً معطّلاً</strong> · نطلب البريد هنا في مكانه.
                </p>
              </Notice>
            ) : null}
            {state === "offline" ? (
              <Notice kind="offline" title="حُفظ محلياً">
                <p className="acc-lead">
                  التفضيلات تُحفظ على الجهاز وتُرفع لاحقاً؛ تسري محلياً فوراً.
                </p>
                <p className="acc-lead">
                  <strong>الحدّ المُعلن</strong> · التنبيهات الخادمية تتبع التفضيل القديم حتى يُرفع.
                </p>
              </Notice>
            ) : null}
            {state === "success" && saved ? (
              <Notice kind="success" title="حُفظت">
                <p className="acc-lead">
                  <span className="sting-mono">{saved.in_app}</span> تنبيهات على التطبيق ·{" "}
                  <span className="sting-mono">{saved.email}</span> بالبريد ·{" "}
                  <span className="sting-mono">{saved.sms}</span> برسالة نصية.
                </p>
              </Notice>
            ) : null}

            {prefs ? (
              <div className="cat-form">
                <section className="not-pref" aria-label="تنبيهات التشغيل — داخل التطبيق">
                  <div className="not-pref__row">
                    <div>
                      <strong>تنبيهات التشغيل — داخل التطبيق</strong>
                      <p className="acc-choice__note">
                        ورديات وذمم ومزامنة وطلبات. تخصّ مالك، فلا تُطفأ.
                      </p>
                    </div>
                    <Status state="synced" label="دائم" />
                  </div>
                </section>
                <section className="not-pref" aria-label="تنبيهات التشغيل — رسالة نصية">
                  <SwitchField
                    label="تنبيهات التشغيل — رسالة نصية"
                    hint="للحالات الحرجة فقط: وردية مهجورة، فشل مزامنة يتجاوز يوماً."
                    checked={prefs.operational.sms}
                    onChange={(on) => set("operational", "sms", on)}
                  />
                  {paidOn && server ? (
                    <p className="acc-choice__note">
                      <strong>الرسائل النصية تُكلِّف.</strong> نعرض رصيد الرسائل المتبقي عند تفعيل
                      أي قناة مدفوعة، ولا نرسل عبرها إلا ما اخترتَه صراحة. المتبقي{" "}
                      <span className="sting-mono">{server.sms_balance.remaining}</span> من{" "}
                      <span className="sting-mono">{server.sms_balance.quota}</span> هذا الشهر.
                    </p>
                  ) : null}
                </section>
                <section className="not-pref" aria-label="إشعارات حسابية — الاشتراك والفواتير">
                  <SwitchField
                    label="إشعارات حسابية — الاشتراك والفواتير"
                    hint="تذكير التجديد وحالة الدفع"
                    checked={prefs.account.in_app}
                    onChange={(on) => set("account", "in_app", on)}
                  />
                  <SwitchField
                    label="إشعارات حسابية بالبريد"
                    checked={prefs.account.email}
                    onChange={(on) => set("account", "email", on)}
                  />
                </section>
                <section className="not-pref" aria-label="عروض ومنتجات المنصة">
                  <SwitchField
                    label="عروض ومنتجات المنصة"
                    hint="إطفاؤها لا يؤثر على أي شيء تشغيلي"
                    checked={prefs.marketing.in_app}
                    onChange={(on) => set("marketing", "in_app", on)}
                  />
                  {!prefs.marketing.in_app ? <Status state="expired" label="موقوف" /> : null}
                  <SwitchField
                    label="عروض المنصة بالبريد"
                    checked={prefs.marketing.email}
                    onChange={(on) => set("marketing", "email", on)}
                  />
                </section>
                {/* 0005 §٢١٦ — الإشعار الفوري: يصل الجهاز ولو كان التطبيق مغلقاً */}
                <section className="not-pref" aria-label="الإشعارات الفورية">
                  <div className="not-pref__row">
                    <div>
                      <strong>الإشعارات الفورية</strong>
                      <p className="acc-choice__note">
                        تصل الأجهزة التي فُعّلت عليها ولو كان التطبيق مغلقاً، بعنوان عام بلا أسماء
                        ولا مبالغ.
                      </p>
                    </div>
                  </div>
                  <div className="acc-links">
                    <Link href="/notify" className="c-btn c-btn--secondary">
                      فعّلها على هذا الجهاز
                    </Link>
                  </div>
                  <SwitchField
                    label="فوري — التشغيل"
                    checked={prefs.operational.push ?? true}
                    onChange={(on) => set("operational", "push", on)}
                  />
                  <SwitchField
                    label="فوري — الاشتراك والفواتير"
                    checked={prefs.account.push ?? true}
                    onChange={(on) => set("account", "push", on)}
                  />
                  <SwitchField
                    label="فوري — عروض المنصة"
                    checked={prefs.marketing.push ?? false}
                    onChange={(on) => set("marketing", "push", on)}
                  />
                  <SwitchField
                    label="ساعات الهدوء"
                    hint="من 11 مساءً إلى 7 صباحاً لا يصل إلا ما يحتاج تصرّفاً منك."
                    checked={quiet}
                    onChange={(on) => {
                      setSaved(null);
                      setQuiet(on);
                    }}
                  />
                </section>
                {prefs.account.email || prefs.marketing.email || error ? (
                  <TextField
                    label="البريد للتنبيهات"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setError(null);
                    }}
                    error={
                      error === "channel_without_destination"
                        ? "لا بريد في الحساب — أدخله هنا"
                        : error === "email_invalid"
                          ? "بريد غير صالح"
                          : undefined
                    }
                    required
                  />
                ) : null}
                <p className="acc-choice__note">
                  فعّال الآن: <span className="sting-mono">{countsOf(prefs).in_app}</span> على
                  التطبيق · <span className="sting-mono">{countsOf(prefs).email}</span> بالبريد ·{" "}
                  <span className="sting-mono">{countsOf(prefs).sms}</span> نصية
                </p>
                <div className="cat-form__actions">
                  <Button pos onClick={() => void save()} loading={busy}>
                    حفظ
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}

"use client";

/**
 * المزامنة في الخلفية (مراجعة 2026-10-19 B2/B3).
 *
 * - **جلسة الجهاز:** كل جلسة مستخدم جديدة (دخول، استئناف بعد إعادة التحميل، استئناف صامت بعد انتهاء
 *   الرمز) على جهاز مُجهَّز تُحوَّل إلى جلسة جهاز — وإلا رفض الخادم الرفع بـ403.
 * - **الرفع التلقائي:** كان الرفع يجري بعد كل عملية فقط، فما حُفظ بلا شبكة بقي معلّقاً حتى «محاولة
 *   رفع الآن». الآن: عند عودة الاتصال، وعند العودة إلى التبويب، وكل 30 ثانية ما دام هناك معلّق. يحترم
 *   الوقوف بعد ثلاث محاولات (`sync.halted`) — الاستئناف بعده يدوي كما يعلن SYS-01.
 */
import { useEffect, useRef } from "react";

import { useApp } from "@/lib/app-context";
import { hasLocalSetup } from "@/lib/device-setup";
import { renewDeviceSession, setDeviceAdopter } from "@/lib/device-session";
import { countPending, pushPending } from "@/lib/sync";

const PUSH_EVERY_MS = 30_000;

export function BackgroundSync() {
  const app = useApp();
  const appRef = useRef(app);
  appRef.current = app;
  const access = app.tokens?.access ?? null;
  const tenantId = app.session.tenantId;

  useEffect(() => {
    setDeviceAdopter((d) => appRef.current.setDevice(d));
    return () => setDeviceAdopter(null);
  }, []);

  // جلسة مستخدم جديدة على جهاز مُجهَّز ← جلسة جهاز
  useEffect(() => {
    if (!access || !tenantId) return;
    let cancelled = false;
    void (async () => {
      if (!cancelled && (await hasLocalSetup())) await renewDeviceSession();
    })();
    return () => {
      cancelled = true;
    };
  }, [access, tenantId]);

  // الرفع التلقائي
  useEffect(() => {
    if (!access || !tenantId) return;
    let busy = false;
    const tick = async () => {
      if (busy || !navigator.onLine || document.visibilityState === "hidden") return;
      busy = true;
      try {
        if ((await countPending()) > 0) await pushPending();
      } catch {
        /* الشبكة سقطت أثناء المحاولة — الدورة التالية تعيد */
      } finally {
        busy = false;
      }
    };
    const kick = () => void tick();
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", kick);
    const timer = setInterval(kick, PUSH_EVERY_MS);
    return () => {
      window.removeEventListener("online", kick);
      document.removeEventListener("visibilitychange", kick);
      clearInterval(timer);
    };
  }, [access, tenantId]);

  return null;
}

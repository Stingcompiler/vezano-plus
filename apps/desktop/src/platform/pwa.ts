/**
 * بديل `@/lib/pwa` في تطبيق الحاسوب: لا عامل خدمة داخل Tauri — الشاشات على قرص الجهاز أصلاً،
 * والتحديث عبر محدِّث التطبيق (DESK-01) لا عبر ذاكرة المتصفح. خارج Tauri: سلوك الويب كما هو.
 */
import * as web from "../../../web/src/lib/pwa";
import { inTauri } from "./tauri";

export * from "../../../web/src/lib/pwa";

/** داخل Tauri لا Web Push: شاشة الإشعارات تقول ذلك بدل «صلاحية مرفوضة» (0005 §٢٥٦). */
export function pushHost(): web.PushHost {
  return inTauri ? "desktop_app" : web.pushHost();
}

/*
 * Web Push داخل Tauri غير متاح: لا عامل خدمة (أعلاه) ولا خادم دفع للنافذة. لكن WebView2 في ويندوز
 * (Chromium) يعلن `Notification` و`PushManager` كالمتصفح، فكانت شاشة WEB-02 تعرض «تفعيل الإشعارات» ثم
 * «تعذّر الاشتراك عند المزوّد» (بلاغ المالك 2026-11-12، 0005 §٢٦٢). WKWebView في ماك لا يعلنهما، فكان
 * الخطأ على ويندوز وحده. داخل Tauri يُقال «غير مدعوم» صراحةً في كل نظام؛ إشعارات الحاسوب إشعارات نظام
 * من الوارد (DESK-05 · `inbox-notifier.tsx`).
 */
export function pushSupported(): boolean {
  return inTauri ? false : web.pushSupported();
}

export function pushPermission(): web.PushPermission {
  return inTauri ? "unsupported" : web.pushPermission();
}

export function requestPushPermission(): Promise<web.PushPermission> {
  return inTauri ? Promise.resolve("unsupported") : web.requestPushPermission();
}

export function currentPushSubscription(): Promise<web.PushKeys | null> {
  return inTauri ? Promise.resolve(null) : web.currentPushSubscription();
}

export function subscribePush(publicKey: string): Promise<web.PushKeys | null> {
  return inTauri ? Promise.resolve(null) : web.subscribePush(publicKey);
}

export function unsubscribePush(): Promise<void> {
  return inTauri ? Promise.resolve() : web.unsubscribePush();
}

export function registerServiceWorker(force = false): Promise<ServiceWorkerRegistration | null> {
  return inTauri ? Promise.resolve(null) : web.registerServiceWorker(force);
}

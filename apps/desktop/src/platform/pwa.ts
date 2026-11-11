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

export function registerServiceWorker(force = false): Promise<ServiceWorkerRegistration | null> {
  return inTauri ? Promise.resolve(null) : web.registerServiceWorker(force);
}

/**
 * بديل `@/lib/pwa` في تطبيق الحاسوب: لا عامل خدمة داخل Tauri — الشاشات على قرص الجهاز أصلاً،
 * والتحديث عبر محدِّث التطبيق (DESK-01) لا عبر ذاكرة المتصفح. خارج Tauri: سلوك الويب كما هو.
 */
import * as web from "../../../web/src/lib/pwa";
import { inTauri } from "./tauri";

export * from "../../../web/src/lib/pwa";

export function registerServiceWorker(force = false): Promise<ServiceWorkerRegistration | null> {
  return inTauri ? Promise.resolve(null) : web.registerServiceWorker(force);
}

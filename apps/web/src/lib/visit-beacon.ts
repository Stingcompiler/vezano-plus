import { apiBaseUrl } from "@/lib/api";

/**
 * عدّ زيارات الصفحات العامة (0005 §٢١٩): إشارة واحدة لكل مسار بلا كوكيز ولا تخزين محلي ولا معرّف.
 * لا تُرسل إن طلب المتصفح «عدم التتبّع» أو GPC، ولا من تطبيق سطح المكتب (ليس زائراً للموقع).
 * الخادم يستخرج الدولة من العنوان ثم يرميه.
 */
export function sendVisitBeacon(): void {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (nav.doNotTrack === "1" || nav.globalPrivacyControl === true) return;
  const { protocol, hostname } = window.location;
  if (protocol === "tauri:" || hostname.endsWith("tauri.localhost")) return;
  const referrer = document.referrer;
  const body = JSON.stringify({ url: window.location.href, referrer });
  const url = `${apiBaseUrl()}/api/public/beacon`;
  try {
    if (typeof nav.sendBeacon === "function" && nav.sendBeacon(url, body)) return;
    void fetch(url, { method: "POST", body, keepalive: true }).catch(() => undefined);
  } catch {
    // العدّ لا يكسر الصفحة أبداً
  }
}

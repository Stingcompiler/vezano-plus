import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * طبقة المنصة (docs/desktop/plan.md §٤): تعمل داخل نافذة Tauri وحدها. في متصفح عادي — مواصفات
 * Playwright على بناء الحاسوب — يبقى سلوك الويب كما هو، فالاختبار يقيس الشاشات نفسها.
 */
export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** الصفحات العامة تفتح في المتصفح لا داخل التطبيق (الخطة §٣). */
export const SITE = "https://plus.vezano.app";
export const PUBLIC_PREFIXES = ["/legal", "/plans", "/status", "/demo"] as const;

export function isPublicPath(path: string): boolean {
  return PUBLIC_PREFIXES.some(
    (p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`),
  );
}

/** رابط يخرج من التطبيق: عنوان كامل بغير أصل التطبيق، أو صفحة عامة. يعيد العنوان الذي يُفتح، أو null. */
export function externalTarget(href: string, appOrigin: string): string | null {
  if (/^(mailto|tel|https?):/i.test(href)) {
    try {
      const u = new URL(href);
      if (u.origin === appOrigin)
        return isPublicPath(u.pathname) ? `${SITE}${u.pathname}${u.search}` : null;
    } catch {
      return null;
    }
    return href;
  }
  if (href.startsWith("/") && isPublicPath(href)) return `${SITE}${href}`;
  return null;
}

export const openExternal = (url: string) => openUrl(url);

export const secrets = {
  get: (key: "refresh") => invoke<string | null>("secret_get", { key }),
  set: (key: "refresh", value: string) => invoke<void>("secret_set", { key, value }),
  delete: (key: "refresh") => invoke<void>("secret_delete", { key }),
};

/** نظام الجهاز لفروق الواجهة في CSS (`[data-os]`) — ماك أو ويندوز (الخطة §٤.١). */
export function detectOs(ua: string): "mac" | "win" | "other" {
  if (/Mac OS X|Macintosh/i.test(ua)) return "mac";
  if (/Windows/i.test(ua)) return "win";
  return "other";
}

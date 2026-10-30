import { externalTarget, openExternal } from "./tauri";

/**
 * داخل Tauri: أي رابط يخرج من التطبيق (موقع آخر، بريد، الصفحات العامة) يفتح في المتصفح الافتراضي،
 * و`window.open` كذلك — لا نافذة ويب ثانية داخل التطبيق.
 */
export function installExternalLinks(): void {
  document.addEventListener(
    "click",
    (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement)) return;
      const target = externalTarget(a.getAttribute("href") ?? "", location.origin);
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      void openExternal(target);
    },
    true,
  );
  window.open = ((url?: string | URL) => {
    const href = url ? String(url) : "";
    const target = externalTarget(href, location.origin) ?? (href.startsWith("/") ? null : href);
    if (target) void openExternal(target);
    return null;
  });
}

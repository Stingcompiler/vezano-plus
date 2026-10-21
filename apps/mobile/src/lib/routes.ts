/**
 * خريطة شاشات الويب → مساراتها الأصلية على الهاتف (الإطلاق التدريجي، خطة الجوال §٢.٤). ما له صفّ هنا
 * يُفتح داخل التطبيق، وما سواه على الويب. الصفوف تُضاف مع كل شاشة تُبنى؛ المسار الديناميكي بنمط
 * `:param` يُحوَّل إلى نظيره في expo-router.
 */
interface Row {
  readonly web: RegExp;
  readonly native: (m: RegExpMatchArray) => string;
}

const exact = (web: string, native = web): Row => ({
  web: new RegExp(`^${web.replace(/[/]/g, "\\/")}$`),
  native: () => native,
});
const param = (web: string, native: (id: string) => string): Row => ({
  web: new RegExp(`^${web.replace(/[/]/g, "\\/").replace(":id", "([^/]+)")}$`),
  native: (m) => native(m[1] ?? ""),
});

export const ROUTES: readonly Row[] = [
  exact("/"),
  exact("/sync"),
  exact("/search"),
  exact("/onboarding"),
  exact("/sync/update", "/device"),
  exact("/sync/storage", "/device"),
  param("/invite/:id", (id) => `/invite/${id}`),
];

/** المسار الأصلي لعنوان ويب، أو null إن لم تُبنَ شاشته بعد. */
export function nativeRoute(href: string): string | null {
  const path = href.split("?")[0] ?? href;
  for (const r of ROUTES) {
    const m = path.match(r.web);
    if (m) return r.native(m);
  }
  return null;
}

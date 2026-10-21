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
  // M2 — البيع والورديات والأصلية (0005 §١٩٣)
  exact("/pos"),
  exact("/pos/discount"),
  exact("/pos/customer"),
  exact("/pos/pay"),
  exact("/pos/pay/credit", "/pos/pay-credit"),
  exact("/pos/pay/mixed", "/pos/pay-mixed"),
  exact("/pos/invoices"),
  exact("/pos/duplicates"),
  param("/pos/receipt/:id", (id) => `/pos/receipt/${id}`),
  param("/pos/receipt/:id/problem", (id) => `/pos/receipt/${id}/problem`),
  param("/pos/invoices/:id", (id) => `/pos/invoices/${id}`),
  param("/pos/invoices/:id/return", (id) => `/pos/invoices/${id}/return`),
  exact("/shifts/open"),
  exact("/shifts/current"),
  exact("/shifts/movements"),
  exact("/shifts/close"),
  exact("/shifts/review"),
  exact("/print", "/printer"),
  // M3 — العملاء والكتالوج (0005 §١٩٤)
  exact("/parties"),
  exact("/parties/suppliers"),
  exact("/parties/new"),
  param("/parties/:id", (id) => `/parties/${id}`),
  param("/parties/:id/opening", (id) => `/parties/${id}/opening`),
  param("/parties/:id/statement", (id) => `/parties/${id}/statement`),
  param("/parties/:id/statement/share", (id) => `/parties/${id}/statement/share`),
  param("/parties/:id/payment", (id) => `/parties/${id}/payment`),
  param("/parties/:id/merge", (id) => `/parties/${id}/merge`),
  param("/parties/receipts/:id/correct", (id) => `/parties/receipts/${id}/correct`),
  exact("/catalog"),
  exact("/catalog/new"),
  exact("/catalog/import"),
  exact("/catalog/groups"),
  param("/catalog/:id", (id) => `/catalog/${id}`),
  param("/catalog/:id/units", (id) => `/catalog/${id}/units`),
  param("/catalog/:id/price", (id) => `/catalog/${id}/price`),
  exact("/inventory"),
  exact("/inventory/openings"),
  exact("/inventory/opening", "/inventory/openings"),
  exact("/inventory/receive"),
  exact("/inventory/count"),
  exact("/inventory/transfers"),
  exact("/inventory/transfers/new"),
  param("/inventory/items/:id", (id) => `/inventory/items/${id}`),
  param("/inventory/items/:id/damage", (id) => `/inventory/items/${id}/damage`),
  param("/inventory/count/:id/review", (id) => `/inventory/count/${id}/review`),
  param("/inventory/transfers/:id/receive", (id) => `/inventory/transfers/${id}/receive`),
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

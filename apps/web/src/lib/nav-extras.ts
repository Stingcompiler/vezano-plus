import { NAV_GROUPS, type NavItem } from "@sting/app-core";

/**
 * نقطة امتداد للتنقل: الويب يعرض العناصر كما هي. تطبيق الحاسوب يربط هذا الاسم ببديله
 * (apps/desktop/src/platform/nav-extras.ts) فيستبدل شاشات المتصفح (الطابعة عبر البلوتوث، تثبيت PWA،
 * تحديث عامل الخدمة) بشاشاته الأصلية DESK — بلا نسخة ثانية من القائمة (0005 §٢٠٨).
 */
/** متجر التطبيقات (0005 §٢١٥): للويب وحده — الجوال لا ينزّل مثبِّتات، وتطبيق الحاسوب يتحدّث ذاتياً. */
const APPS: NavItem = {
  id: "apps",
  label: "متجر التطبيقات",
  href: "/org/apps",
  group: NAV_GROUPS.device,
};

export function adaptNavItems(items: readonly NavItem[]): readonly NavItem[] {
  const at = items.findIndex((i) => i.id === "install");
  return at < 0 ? [...items, APPS] : [...items.slice(0, at), APPS, ...items.slice(at)];
}

import type { NavItem } from "@sting/app-core";

/**
 * نقطة امتداد للتنقل: الويب يعرض العناصر كما هي. تطبيق الحاسوب يربط هذا الاسم ببديله
 * (apps/desktop/src/platform/nav-extras.ts) فيستبدل شاشات المتصفح (الطابعة عبر البلوتوث، تثبيت PWA،
 * تحديث عامل الخدمة) بشاشاته الأصلية DESK — بلا نسخة ثانية من القائمة (0005 §٢٠٨).
 */
export function adaptNavItems(items: readonly NavItem[]): readonly NavItem[] {
  return items;
}

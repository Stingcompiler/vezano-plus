import { expect, type Page } from "@playwright/test";

import { clickInDrawer } from "./nav";

/** أقسام مساحة المشغّل كما تظهر في القائمة (0005 §١١٣). */
export const PLATFORM_SECTIONS = [
  "النظرة العامة",
  "الإشعارات",
  "الرسائل",
  "مراجعة الدفع",
  "المستأجرون",
  "الاستحقاقات",
  "الباقات والتسعير",
  "متجر التطبيقات",
  "طلبات التحقُّق",
  "البلاغات",
  "الخلافات",
  "الإعلانات",
  "الإرسال",
  "طلبات الجولة",
  "لوحة الاكتساب",
  "الصحة",
  "النسخ",
  "المشغّلون",
  "سجل التدقيق",
] as const;

/**
 * الانتقال إلى قسم في مساحة المشغّل: على ≥ 834 القائمة جانبية ثابتة، وعلى الهاتف درج يُفتح
 * بزرّ «القائمة» أولاً (الروابط في DOM دائماً — الفتح للنقر لا للقراءة).
 */
export async function goSection(page: Page, name: string) {
  await clickInDrawer(page, async () => {
    const nav = page.getByRole("navigation", { name: "أقسام المشغّل" });
    const link = nav.getByRole("link", { name, exact: true, includeHidden: true });
    await link.waitFor({ state: "attached", timeout: 10_000 });
    // 0005 §٢١٢: المجموعات تُطوى — مجموعة القسم المطويّة تُفتح قبل النقر كما يفعل المشغّل
    if (!(await link.isVisible())) {
      const section = nav
        .locator(".c-nav__section")
        .filter({ has: page.getByRole("link", { name, exact: true, includeHidden: true }) });
      if (await section.count())
        await section.first().locator(".c-nav__group--toggle").click({ timeout: 10_000 });
    }
    await link.click({ timeout: 10_000 });
  });
}

/**
 * دخول المشغّل يقود إلى «النظرة العامة» (0005 §١٣٨)؛ المواصفات المبنية على قائمة المستأجرين تنتقل
 * إليها من القائمة كما يفعل المشغّل.
 */
export async function landOnTenants(page: Page) {
  await expect(page).toHaveURL(/\/platform$/);
  await goSection(page, "المستأجرون");
  await expect(page).toHaveURL(/\/platform\/tenants$/);
}

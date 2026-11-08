import { expect, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { goSection } from "./platform-nav";
import { json } from "./pos-invoices-fixtures";

/** PLT-19 — تحليلات زوار الموقع العام (0005 §٢١٩): المدّة، والمقارنة بالفترة السابقة، والدول بأسمائها،
 *  ومسار التحويل، والجدول البديل للمخطط، وحالة «لا زيارات». */

const day = (i: number) => `2026-11-0${i + 2}`;
const REPORT = {
  range: { days: 7, from: day(0), to: day(6) },
  totals: { views: 64, visitors: 30, prev_views: 40, prev_visitors: 20 },
  daily: Array.from({ length: 7 }, (_, i) => ({ day: day(i), views: 8 + i, visitors: 3 + i })),
  countries: [
    { key: "SD", visitors: 22, views: 50 },
    { key: "SA", visitors: 5, views: 9 },
    { key: "", visitors: 3, views: 5 },
  ],
  pages: [
    { key: "/", visitors: 25, views: 40 },
    { key: "/plans", visitors: 10, views: 14 },
  ],
  sources: [
    { key: "", visitors: 18, views: 40 },
    { key: "facebook", visitors: 12, views: 24 },
  ],
  devices: [
    { key: "mobile", visitors: 24, views: 50 },
    { key: "desktop", visitors: 6, views: 14 },
  ],
  funnel: [
    { key: "visitors", label: "زاروا الموقع", value: 30 },
    { key: "signup", label: "فتحوا صفحة التسجيل", value: 6 },
    { key: "stores", label: "أنشؤوا متجراً", value: 3 },
    { key: "paid", label: "دفعوا أول اشتراك", value: 1 },
  ],
  geo_ready: true,
  retention_days: 400,
};

test.describe("تحليلات الزوار", () => {
  test("PLT-19: الزوار والدول ومسار التحويل، ثم مدّة بلا زيارات", async ({ page }, info) => {
    const asked: string[] = [];
    await page.route("**/api/platform/login", (route) =>
      route.fulfill(
        json(200, { access: "op", refresh: "r", session_id: "s", display_name: "هدى — تشغيل" }),
      ),
    );
    await page.route("**/api/platform/analytics?*", (route) => {
      const days = new URL(route.request().url()).searchParams.get("days") ?? "";
      asked.push(days);
      if (days === "90") {
        return route.fulfill(
          json(200, {
            ...REPORT,
            range: { days: 90, from: "2026-08-11", to: "2026-11-08" },
            totals: { views: 0, visitors: 0, prev_views: 0, prev_visitors: 0 },
            daily: [],
            countries: [],
            pages: [],
            sources: [],
            devices: [],
            geo_ready: false,
          }),
        );
      }
      return route.fulfill(json(200, REPORT));
    });
    await page.goto("/platform/login");
    await page.getByLabel("بريد المشغّل").fill("ops.huda@sting.internal");
    await page.getByLabel("كلمة المرور").fill("very-secret-ops");
    await page.getByRole("button", { name: "دخول مساحة المشغّل" }).click();
    await expect(page).toHaveURL(/\/platform$/);
    await goSection(page, "تحليلات الزوار");
    await expect(page).toHaveURL(/\/platform\/analytics$/);
    const root = page.locator('[data-screen="PLT-19"]');
    await expect(root).toHaveAttribute("data-state", "ready");
    await expectFrame(page, info, {
      screenId: "PLT-19",
      state: "ready",
      texts: [
        "زوار الموقع العام",
        "الزوار يومياً",
        "مسار التحويل",
        "فتحوا صفحة التسجيل",
        "دفعوا أول اشتراك",
        "مباشر",
        "هاتف",
        "غير معروفة",
        "IP Geolocation by DB-IP",
      ],
    });
    // المقارنة بالفترة السابقة نصاً، والدولة باسمها العربي، والتحويل نسبة
    await expect(root.getByText("أكثر من الفترة السابقة 50%")).toBeVisible();
    await expect(root.getByText("السودان", { exact: true })).toBeVisible();
    await expect(root.getByText("10%", { exact: true })).toBeVisible();
    // المخطط له جدول بديل بالأرقام نفسها
    await root.getByText("عرض الأرقام جدولاً").click();
    await expect(root.getByRole("cell", { name: day(6) })).toBeVisible();
    // مدّة بلا زيارات: حالة فارغة صريحة وتنبيه قاعدة الدول
    await root.getByRole("button", { name: /90/ }).click();
    await expect(root).toHaveAttribute("data-state", "empty");
    await expect(root.getByText("لا زيارات في هذه المدّة")).toBeVisible();
    await expect(root.getByText("قاعدة الدول غير محمَّلة")).toBeVisible();
    // يُطلب التقرير بالمدّة المختارة (React يحمّل مرتين في التطوير — العدد ليس المقصود)
    expect([...new Set(asked)]).toEqual(["7", "90"]);
  });
});

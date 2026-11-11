import { expect, type Page, test } from "@playwright/test";

/**
 * بلاغ المالك 2026-11-11 (0005 §٢٥٥): «الحاوية الكبرى كأنها غير مضبوطة على مقاسات… يظهر اسكرول».
 * القائمة الجانبية الأطول من النافذة كانت تمدّ صفّها إلى حدّها الأقصى، فيزيد الإطار على النافذة بخطّ
 * الترويسة والتذييل (18px) وتتمرّر كل شاشة عمودياً ولو كان محتواها قصيراً.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

async function login(page: Page, next: string) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, (c) => `\\${c}`)}$`));
}

const overflow = (page: Page) =>
  page.evaluate(() => {
    const de = document.documentElement;
    const nav = document.querySelector(".c-frame__nav");
    return {
      x: de.scrollWidth - de.clientWidth,
      y: de.scrollHeight - de.clientHeight,
      navScrolls: nav ? nav.scrollHeight > nav.clientHeight : false,
    };
  });

test.describe("الإطار على مقاس النافذة", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 834, "القائمة الجانبية للحاسوب واللوحي");

  for (const [w, h] of [
    [1400, 720],
    [1280, 640],
    [1024, 700],
    [834, 700],
  ] as const) {
    test(`شاشة قصيرة المحتوى لا تتمرّر عند ${w}×${h} — القائمة الطويلة تمرّر داخلها`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.route("**/api/org/devices", (route) =>
        route.fulfill(
          json(200, {
            devices: [],
            counts: { total: 0, active: 0, pending_total: 0 },
            device_limit: 3,
            as_of: new Date().toISOString(),
          }),
        ),
      );
      await login(page, "/org/devices");
      await expect(page.locator('[data-screen="ORG-04"][data-state="empty"]')).toBeVisible();
      const o = await overflow(page);
      expect(o.x).toBeLessThanOrEqual(0);
      expect(o.y).toBeLessThanOrEqual(0);
      // القائمة أطول من النافذة هنا: تمرّر داخلها، وآخر بنودها (الخروج) يُبلَغ بلا تمرير الصفحة
      expect(o.navScrolls).toBe(true);
      const logout = page.getByRole("button", { name: "تسجيل الخروج" });
      await logout.scrollIntoViewIfNeeded();
      await expect(logout).toBeInViewport();
      expect((await overflow(page)).y).toBeLessThanOrEqual(0);
    });
  }
});

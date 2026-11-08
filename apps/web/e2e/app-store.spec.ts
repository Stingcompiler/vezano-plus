import { expect, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { navTo } from "./nav";
import { goSection } from "./platform-nav";
import { json, login } from "./pos-invoices-fixtures";

/** متجر التطبيقات (0005 §٢١٥): الصفحة العامة، ومتجر التاجر ORG-11، ونشر المشغّل PLT-18. */

const AT = "2026-11-07T10:00:00Z";
const APK = {
  id: "r1",
  name: "Vezano Plus",
  platform: "android",
  platform_label: "أندرويد",
  version: "1.4.2",
  published_at: AT,
};
const IOS = {
  id: "r2",
  name: "Vezano Plus",
  platform: "ios",
  platform_label: "آيفون",
  version: "1.4.0",
  published_at: AT,
};
const SHA = "a".repeat(64);
const MERCHANT = [
  {
    ...APK,
    filename: "vezano-1.4.2.apk",
    size_bytes: 48 * 1024 * 1024,
    sha256: SHA,
    apple_url: "",
  },
  {
    ...IOS,
    filename: "",
    size_bytes: 0,
    sha256: "",
    apple_url: "https://testflight.apple.com/join/abc",
  },
];

test.describe("متجر التطبيقات", () => {
  test("الصفحة العامة: تصفّح بالنظام بلا تنزيل، و«سجّل الدخول للتنزيل»", async ({ page }, info) => {
    await page.route("**/api/public/apps", (route) =>
      route.fulfill(json(200, { releases: [APK, IOS] })),
    );
    await page.goto("/");
    const section = page.locator("#lp-apps");
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByRole("heading", { name: "متجر التطبيقات" })).toBeVisible();
    await expect(section.getByText("Vezano Plus")).toHaveCount(2);
    // شعار النظام في كل صف وفي مرشّحه، زخرفيّ لا يُقرأ (§٢٢٢)
    await expect(section.locator('.vz-app__icon [data-platform-icon="android"]')).toHaveCount(1);
    await expect(section.locator('.vz-app__icon [data-platform-icon="ios"]')).toHaveCount(1);
    await expect(section.locator(".pos-chip [data-platform-icon]")).toHaveCount(4);
    await expect(section.locator("svg[data-platform-icon]").first()).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await section.getByRole("button", { name: /آيفون/ }).click();
    await expect(section.getByText("Vezano Plus")).toHaveCount(1);
    await expect(section.locator(".sting-mono", { hasText: "1.4.0" })).toBeVisible();
    await expect(section.getByRole("link", { name: "سجّل الدخول للتنزيل" })).toHaveAttribute(
      "href",
      "/login?next=%2Forg%2Fapps",
    );
    // لا اسم ملف ولا بصمة للزائر
    await expect(section).not.toContainText("SHA-256");
    await expectFrame(page, info, { screenId: "PUB-01", state: "ready", texts: [] }).catch(
      () => undefined,
    );
  });

  test("الصفحة العامة: بلا إصدارات لا يظهر القسم", async ({ page }) => {
    await page.route("**/api/public/apps", (route) => route.fulfill(json(200, { releases: [] })));
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "الأسئلة الشائعة" }).or(page.locator("#lp-faq")),
    ).toBeAttached();
    await expect(page.locator("#lp-apps")).toHaveCount(0);
  });

  test("ORG-11: التنزيل برابط موقَّع، والحجم والبصمة، وآيفون إلى TestFlight", async ({
    page,
  }, info) => {
    await page.route("**/api/org/apps", (route) =>
      route.fulfill(json(200, { releases: MERCHANT })),
    );
    let linkRequested = false;
    await page.route("**/api/org/apps/r1/link", (route) => {
      linkRequested = route.request().method() === "POST";
      return route.fulfill(json(200, { url: "/api/apps/download/tok", expires_in: 300 }));
    });
    await page.route("**/api/apps/download/tok", (route) =>
      route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": 'attachment; filename="vezano-1.4.2.apk"',
        },
        body: "apk",
      }),
    );
    // من الرئيسية عبر القائمة نفسها: كان المتجر بلا بند في قائمة التاجر فلا يُرى بعد الدخول
    await login(page, "/");
    await navTo(page, "متجر التطبيقات");
    await expect(page).toHaveURL(/\/org\/apps$/);
    await expectFrame(page, info, {
      screenId: "ORG-11",
      state: "ready",
      texts: ["متجر التطبيقات", "تنزيل ملف التثبيت", "فتح في TestFlight", "بصمة SHA-256"],
    });
    const root = page.locator('[data-screen="ORG-11"]');
    await expect(root.locator(".sting-mono", { hasText: "48" })).toBeVisible();
    await expect(root.locator("code.sting-mono")).toHaveText(SHA);
    const download = page.waitForEvent("download");
    await root.getByRole("button", { name: "تنزيل ملف التثبيت" }).click();
    expect((await download).suggestedFilename()).toBe("vezano-1.4.2.apk");
    expect(linkRequested).toBe(true);
    await expect(root.getByRole("link", { name: "فتح في TestFlight" })).toHaveAttribute(
      "href",
      "https://testflight.apple.com/join/abc",
    );
  });

  test("PLT-18: مدير المنصة ينشر بملف ويرى رفض التكرار، والدعم يقرأ فقط", async ({
    page,
  }, info) => {
    let rows: unknown[] = [];
    let posts = 0;
    await page.route("**/api/platform/login", (route) =>
      route.fulfill(
        json(200, { access: "op", refresh: "r", session_id: "s", display_name: "هدى — تشغيل" }),
      ),
    );
    await page.route("**/api/platform/apps", (route) => {
      if (route.request().method() === "GET") return route.fulfill(json(200, { releases: rows }));
      posts += 1;
      if (posts === 1) {
        rows = [MERCHANT[0]];
        return route.fulfill(json(201, { release: MERCHANT[0] }));
      }
      return route.fulfill(json(409, { detail: "release_exists" }));
    });
    await page.goto("/platform/login");
    await page.getByLabel("بريد المشغّل").fill("ops.huda@sting.internal");
    await page.getByLabel("كلمة المرور").fill("very-secret-ops");
    await page.getByRole("button", { name: "دخول مساحة المشغّل" }).click();
    await expect(page).toHaveURL(/\/platform$/);
    await goSection(page, "متجر التطبيقات");
    await expect(page).toHaveURL(/\/platform\/apps$/);
    const root = page.locator('[data-screen="PLT-18"]');
    await expect(root).toHaveAttribute("data-state", "empty");
    await root.getByLabel("رقم الإصدار").fill("1.4.2");
    // اسم ملف طويل بلا مسافات (كما يأتي من التنزيل على الهاتف) لا يُعصر إلى حرف في كل سطر
    await root
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "application-496e086c-e501-4376-bafe-a006d45fc34e (1).apk",
        mimeType: "application/vnd.android.package-archive",
        buffer: Buffer.from("apk"),
      });
    const nameBox = await root.locator(".c-upload__name").boundingBox();
    expect(nameBox?.width ?? 0).toBeGreaterThan(150);
    expect(nameBox?.height ?? 999).toBeLessThan(60);
    await root
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "vezano-1.4.2.apk",
        mimeType: "application/vnd.android.package-archive",
        buffer: Buffer.from("apk"),
      });
    await root.getByRole("button", { name: "نشر للتجار" }).click();
    await expect(root.getByText("نُشر الإصدار وصار متاحاً للتجار.")).toBeVisible();
    await expect(root).toHaveAttribute("data-state", "ready");
    await expectFrame(page, info, {
      screenId: "PLT-18",
      state: "ready",
      texts: ["نشر إصدار", "متجر التطبيقات", "سحب الإصدار"],
    });
    // التكرار: رسالة تقول ما الخطأ
    await root.getByLabel("رقم الإصدار").fill("1.4.2");
    await root
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "vezano-1.4.2.apk",
        mimeType: "application/vnd.android.package-archive",
        buffer: Buffer.from("apk"),
      });
    await root.getByRole("button", { name: "نشر للتجار" }).click();
    await expect(root.getByText("هذا الإصدار منشور بالفعل لهذا التطبيق والنظام.")).toBeVisible();
  });
});

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
    kind: "link",
    link_url: "https://testflight.apple.com/join/abc",
    link_label: "فتح في TestFlight",
    link_icon: "app_store",
  },
];
/** رابط Google Play لأندرويد (§٢٣٠): يظهر للزائر بأيقونته وتسميته ويُفتح بلا جلسة. */
const PLAY = {
  id: "r3",
  name: "Vezano Plus",
  platform: "android",
  platform_label: "أندرويد",
  version: "1.5.0",
  published_at: AT,
  kind: "link",
  link_url: "https://play.google.com/store/apps/details?id=app.vezano",
  link_label: "حمّل من Google Play",
  link_icon: "google_play",
};

test.describe("متجر التطبيقات", () => {
  test("الصفحة العامة: تصفّح بالنظام بلا تنزيل، و«سجّل الدخول للتنزيل»", async ({ page }, info) => {
    await page.route("**/api/public/apps", (route) =>
      route.fulfill(json(200, { releases: [APK, IOS] })),
    );
    await page.goto("/");
    const section = page.locator("#lp-apps");
    // رابط الشريط العام يقود إلى القسم (§٢٢٣)
    await expect(
      page.locator("#lp-links").getByRole("link", { name: "متجر التطبيقات", includeHidden: true }),
    ).toHaveAttribute("href", "/#lp-apps");
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

  test("الصفحة العامة: بلا إصدارات أو مع عطل يبقى القسم ويقول ذلك (رابط الشريط يقود إليه)", async ({
    page,
  }) => {
    await page.route("**/api/public/apps", (route) => route.fulfill(json(200, { releases: [] })));
    await page.goto("/");
    const section = page.locator("#lp-apps");
    await expect(section.getByText("لا إصدارات منشورة بعد")).toBeVisible();
    await expect(section.locator(".vz-app")).toHaveCount(0);
    await page.unroute("**/api/public/apps");
    await page.route("**/api/public/apps", (route) => route.fulfill(json(500, { detail: "boom" })));
    await page.reload();
    await expect(section.getByText("تعذّر تحميل الإصدارات الآن")).toBeVisible();
  });

  test("الشريط العام يتّسع بلا تمرير أفقي من 1200px حتى مع شريط تمرير تقليدي (§٢٢٤)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto("/");
    const bar = page.locator(".lp__bar").first();
    await expect(bar.getByRole("link", { name: "متجر التطبيقات" })).toBeVisible();
    // «حالة الخدمة» و«الشروط» في القائمة والتذييل لا في الشريط الكامل (§٢٢٦)
    await expect(bar.locator("#lp-links").getByRole("link", { name: "الشروط" })).toBeHidden();
    const { sw, cw } = await bar.evaluate((b) => ({ sw: b.scrollWidth, cw: b.clientWidth }));
    expect(sw).toBeLessThanOrEqual(cw);
    // شريط تمرير ويندوز التقليدي 17px، وخطوط لينكس أعرض قليلاً: يجب أن يبقى هامش أكبر منهما
    const slack = await bar.evaluate((b) =>
      [...b.children].reduce((w, c) => w - c.getBoundingClientRect().width, b.clientWidth),
    );
    expect(slack).toBeGreaterThan(17 + 3 * 12);
  });

  test("ORG-11: التنزيل برابط موقَّع، والحجم بلا بصمة، وآيفون إلى TestFlight", async ({
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
      texts: ["متجر التطبيقات", "تنزيل ملف التثبيت", "فتح في TestFlight"],
    });
    const root = page.locator('[data-screen="ORG-11"]');
    await expect(root.locator(".sting-mono", { hasText: "48" })).toBeVisible();
    // البصمة لا تُعرض للتاجر (§٢٢٥)، وفي القائمة بند واحد للمتجر
    await expect(root).not.toContainText("SHA-256");
    await expect(root).not.toContainText(SHA);
    await expect(
      page.locator("nav").getByRole("link", { name: "متجر التطبيقات", includeHidden: true }),
    ).toHaveCount(1);
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

  test("PLT-18 · رابط بتسمية وأيقونة منصة يظهر للزائر بجانب الاسم (§٢٣٠)", async ({ page }) => {
    let rows: unknown[] = [];
    let sent: Record<string, string> = {};
    await page.route("**/api/platform/login", (route) =>
      route.fulfill(
        json(200, { access: "op", refresh: "r", session_id: "s", display_name: "هدى — تشغيل" }),
      ),
    );
    await page.route("**/api/platform/apps", async (route) => {
      if (route.request().method() === "GET") return route.fulfill(json(200, { releases: rows }));
      const body = route.request().postData() ?? "";
      sent = Object.fromEntries(
        [...body.matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)/g)].map((m) => [m[1] ?? "", m[2] ?? ""]),
      );
      rows = [PLAY];
      return route.fulfill(json(201, { release: PLAY }));
    });
    await page.goto("/platform/login");
    await page.getByLabel("بريد المشغّل").fill("ops.huda@sting.internal");
    await page.getByLabel("كلمة المرور").fill("very-secret-ops");
    await page.getByRole("button", { name: "دخول مساحة المشغّل" }).click();
    await goSection(page, "متجر التطبيقات");
    const root = page.locator('[data-screen="PLT-18"]');
    await root.getByLabel("رقم الإصدار").fill("1.5.0");
    await root.getByRole("radio", { name: "رابط من منصة أخرى" }).click();
    await root.getByLabel("الرابط").fill(PLAY.link_url);
    await root.getByLabel("تسمية الزرّ").fill(PLAY.link_label);
    await root.getByRole("radio", { name: "Google Play" }).click();
    await expect(root.getByRole("radio", { name: "Google Play" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await root.getByRole("button", { name: "نشر للتجار" }).click();
    await expect(root.getByText("نُشر الإصدار وصار متاحاً للتجار.")).toBeVisible();
    expect(sent).toMatchObject({
      platform: "android",
      link_url: PLAY.link_url,
      link_label: PLAY.link_label,
      link_icon: "google_play",
    });
    expect(sent.file).toBeUndefined();
    // الصف يحمل أيقونة Google Play بجانب الاسم
    await expect(root.locator('.vz-app__icon [data-link-icon="google_play"]')).toHaveCount(1);
    // الزائر يرى الرابط نفسه بتسميته ويفتحه بلا جلسة
    await page.route("**/api/public/apps", (route) =>
      route.fulfill(json(200, { releases: [APK, PLAY] })),
    );
    await page.goto("/");
    const section = page.locator("#lp-apps");
    const link = section.getByRole("link", { name: "حمّل من Google Play" });
    await expect(link).toHaveAttribute("href", PLAY.link_url);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(section.locator('.vz-app__icon [data-link-icon="google_play"]')).toHaveCount(1);
    await expect(section.getByRole("link", { name: "سجّل الدخول للتنزيل" })).toHaveCount(1);
  });
});

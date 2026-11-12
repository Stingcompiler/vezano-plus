import { expect, type Page, test } from "@playwright/test";

import { goSection, landOnTenants } from "./platform-nav";

/**
 * 0005 §٢٦٣ — بلاغ المالك 2026-11-12: حفظ إعلان عام في الإنتاج أظهر «لم يُحفظ» ونصّ الخادم
 * الإنجليزي `Given token not valid for any token type`. رمز وصول المشغّل يعيش 15 دقيقة في الذاكرة
 * ولم يكن يُجدَّد، فكل طلب بعد ربع ساعة على الشاشة يُرفض 401 `token_not_valid`. الإصلاح: عميل
 * المشغّل يستأنف من الـCookie مرة ويعيد الطلب نفسه، وفشل الاستئناف وحده يقود إلى الدخول؛ ونصّ الخادم
 * الخام لا يظهر للمشغّل أبداً.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const EXPIRED = {
  detail: "Given token not valid for any token type",
  code: "token_not_valid",
  messages: [
    {
      token_class: "AccessToken",
      token_type: "access",
      message: "Token is expired",
    },
  ],
};

const ANN = (o: Record<string, unknown> = {}) => ({
  id: "a1",
  kind: "general",
  kind_label: "إعلان عام",
  title: "ترحيب",
  body: "إدارة فيزانو ترحب بكم.",
  audience: "all",
  audience_label: "كل المتاجر",
  starts_at: "2026-11-20T06:00:00Z",
  ends_at: "2026-11-21T06:00:00Z",
  status: "draft",
  status_label: "مسودة",
  audience_count: 0,
  created_by_name: "طيب — تشغيل",
  scheduled_at: "",
  cancelled_by_name: "",
  ...o,
});

async function operatorLogin(page: Page) {
  await page.route("**/api/platform/login", (route) =>
    route.fulfill(
      json(200, { access: "op", refresh: "r", session_id: "s", display_name: "طيب — تشغيل" }),
    ),
  );
  await page.route("**/api/platform/tenants**", (route) =>
    route.fulfill(
      json(200, {
        tenants: [],
        total: 0,
        shown: 0,
        active_count: 0,
        filter: "all",
        q: "",
        access_rule: "",
        fetched_at: new Date().toISOString(),
      }),
    ),
  );
  await page.route("**/api/platform/announcements/preview", (route) =>
    route.fulfill(
      json(200, { targeted: 3, segments: [], promise_outside_plan: false, outside_count: 0 }),
    ),
  );
  await page.goto("/platform/login");
  await page.getByLabel("بريد المشغّل").fill("ops.tayeb@sting.internal");
  await page.getByLabel("كلمة المرور").fill("very-secret-ops");
  await page.getByRole("button", { name: "دخول مساحة المشغّل" }).click();
  await landOnTenants(page);
}

async function fillGeneral(page: Page) {
  await goSection(page, "الإعلانات");
  await expect(page).toHaveURL(/\/platform\/announcements$/);
  await page.getByRole("button", { name: "إعلان عام", exact: true }).click();
  await page.getByLabel("العنوان").fill("ترحيب");
  await page.getByLabel("النص المعروض للتاجر").fill("إدارة فيزانو ترحب بكم.");
}

test.describe("PLT-04 — جلسة المشغّل بعد ربع ساعة", () => {
  test("رمز الوصول منتهٍ عند الحفظ: يُستأنف من الـCookie ويُعاد الحفظ نفسه بالرمز الجديد", async ({
    page,
  }) => {
    const posts: string[] = [];
    let resumed = 0;
    await page.route("**/api/platform/resume", (route) => {
      resumed += 1;
      return route.fulfill(json(200, { access: "op2", display_name: "طيب — تشغيل" }));
    });
    await page.route("**/api/platform/announcements", (route) => {
      if (route.request().method() === "GET")
        return route.fulfill(json(200, { announcements: [], now: new Date().toISOString() }));
      const auth = route.request().headers()["authorization"] ?? "";
      posts.push(auth);
      // الرمز الأول («op») انتهى عمره كما في الإنتاج؛ الجديد من الاستئناف مقبول
      if (auth !== "Bearer op2") return route.fulfill(json(401, EXPIRED));
      const b = route.request().postDataJSON() as { title: string; body: string };
      return route.fulfill(json(201, { announcement: ANN({ title: b.title, body: b.body }) }));
    });
    await operatorLogin(page);
    await fillGeneral(page);
    await page.getByRole("button", { name: "حفظ", exact: true }).click();

    const root = page.locator('[data-screen="PLT-04"]');
    await expect(root).toContainText("تم الحفظ");
    expect(posts).toEqual(["Bearer op", "Bearer op2"]);
    expect(resumed).toBe(1);
    await expect(root).not.toContainText("لم يُحفظ");
    await expect(page.locator("body")).not.toContainText("Given token not valid");
  });

  test("الاستئناف نفسه مرفوض (سقف الثماني ساعات أو جلسة مُبطَلة): إلى الدخول بوجهة العودة — لا نصّ إنجليزي", async ({
    page,
  }) => {
    await page.route("**/api/platform/resume", (route) =>
      route.fulfill(json(401, { detail: "session_expired" })),
    );
    await page.route("**/api/platform/announcements", (route) => {
      if (route.request().method() === "GET")
        return route.fulfill(json(200, { announcements: [], now: new Date().toISOString() }));
      return route.fulfill(json(401, EXPIRED));
    });
    await operatorLogin(page);
    await fillGeneral(page);
    await page.getByRole("button", { name: "حفظ", exact: true }).click();

    await expect(page).toHaveURL(/\/platform\/login\?next=%2Fplatform%2Fannouncements$/);
    await expect(page.getByRole("button", { name: "دخول مساحة المشغّل" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Given token not valid");
  });

  test("ردّ خادم بنصّ لا تعرفه الشاشة: رسالة عربية عامة لا النصّ الخام", async ({ page }) => {
    await page.route("**/api/platform/announcements", (route) => {
      if (route.request().method() === "GET")
        return route.fulfill(json(200, { announcements: [], now: new Date().toISOString() }));
      return route.fulfill(json(500, { detail: "A server error occurred." }));
    });
    await operatorLogin(page);
    await fillGeneral(page);
    await page.getByRole("button", { name: "حفظ", exact: true }).click();

    const root = page.locator('[data-screen="PLT-04"]');
    await expect(root).toContainText("لم يُحفظ");
    await expect(root).toContainText("تعذّر الحفظ — حاول مرة أخرى بعد لحظات.");
    await expect(root).not.toContainText("A server error occurred.");
  });
});

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

/**
 * 0005 §٢٧١ — طلبات المشغّل خارج `platformApi()`: تحليلات الزوار (fetch بمعامل لا يصفه العقد) ورفع
 * إصدار في متجر التطبيقات (XMLHttpRequest لتقدّم الرفع) وسحبه. كانت تقود إلى الدخول عند أول 401.
 */
const REPORT = {
  range: { days: 7, from: "2026-11-05", to: "2026-11-11" },
  totals: { views: 64, visitors: 30, prev_views: 40, prev_visitors: 20 },
  daily: [{ day: "2026-11-11", views: 64, visitors: 30 }],
  countries: [{ key: "SD", visitors: 22, views: 50 }],
  pages: [{ key: "/", visitors: 25, views: 40 }],
  sources: [{ key: "", visitors: 18, views: 40 }],
  devices: [{ key: "mobile", visitors: 24, views: 50 }],
  funnel: [{ key: "visitors", label: "زاروا الموقع", value: 30 }],
  geo_ready: true,
  retention_days: 400,
};
const RELEASE = {
  id: "r1",
  name: "Vezano Plus",
  platform: "android",
  platform_label: "أندرويد",
  version: "1.4.2",
  published_at: "2026-11-07T10:00:00Z",
};

/** الرمز الأول («op») انتهى عمره؛ الاستئناف يعطي «op2». يعيد العدّاد ليُفحص. */
async function expiredFirstToken(page: Page) {
  const seen = { resumed: 0 };
  await page.route("**/api/platform/resume", (route) => {
    seen.resumed += 1;
    return route.fulfill(json(200, { access: "op2", display_name: "طيب — تشغيل" }));
  });
  return seen;
}
const fresh = (route: { request(): { headers(): Record<string, string> } }) =>
  route.request().headers()["authorization"] === "Bearer op2";

test.describe("طلبات المشغّل خارج العقد المكتوب — جلسة بعد ربع ساعة", () => {
  test("PLT-19: تحليلات الزوار تُستأنف وتُعاد بدل التحويل إلى الدخول", async ({ page }) => {
    const seen = await expiredFirstToken(page);
    const auths: string[] = [];
    await page.route("**/api/platform/analytics?*", (route) => {
      auths.push(route.request().headers()["authorization"] ?? "");
      return route.fulfill(fresh(route) ? json(200, REPORT) : json(401, EXPIRED));
    });
    await operatorLogin(page);
    await goSection(page, "تحليلات الزوار");
    const root = page.locator('[data-screen="PLT-19"]');
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(page).toHaveURL(/\/platform\/analytics$/);
    // React في التطوير يشغّل أثر التحميل مرتين: الترتيب هو المفحوص — المنتهي أولاً ثم الجديد
    expect(auths[0]).toBe("Bearer op");
    expect(auths.at(-1)).toBe("Bearer op2");
    expect(auths.indexOf("Bearer op2")).toBeGreaterThan(auths.lastIndexOf("Bearer op"));
    expect(seen.resumed).toBeGreaterThanOrEqual(1);
  });

  test("PLT-18: رفع إصدار بعد انتهاء الرمز يُستأنف ويُعاد الرفع نفسه، والسحب كذلك", async ({
    page,
  }) => {
    const seen = await expiredFirstToken(page);
    let rows: unknown[] = [];
    const posts: string[] = [];
    await page.route("**/api/platform/apps", (route) => {
      if (route.request().method() === "GET") return route.fulfill(json(200, { releases: rows }));
      posts.push(route.request().headers()["authorization"] ?? "");
      if (!fresh(route)) return route.fulfill(json(401, EXPIRED));
      rows = [RELEASE];
      return route.fulfill(json(201, { release: RELEASE }));
    });
    const removes: string[] = [];
    await page.route("**/api/platform/apps/r1/remove", (route) => {
      removes.push(route.request().headers()["authorization"] ?? "");
      rows = [];
      return route.fulfill(json(200, { releases: [] }));
    });
    await operatorLogin(page);
    await goSection(page, "متجر التطبيقات");
    await expect(page).toHaveURL(/\/platform\/apps$/);
    const root = page.locator('[data-screen="PLT-18"]');
    await expect(root).toHaveAttribute("data-state", "empty");
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
    await expect(root.getByText("نُشر الإصدار وصار متاحاً للتجار.")).toBeVisible();
    await expect(page).toHaveURL(/\/platform\/apps$/);
    expect(posts).toEqual(["Bearer op", "Bearer op2"]);
    expect(seen.resumed).toBe(1);

    // السحب بالرمز الجديد مباشرة (لا 401 ثانٍ)
    page.once("dialog", (d) => void d.accept());
    await root.getByRole("button", { name: "سحب الإصدار" }).first().click();
    await expect(root.getByText("سُحب الإصدار.")).toBeVisible();
    expect(removes).toEqual(["Bearer op2"]);
  });
});

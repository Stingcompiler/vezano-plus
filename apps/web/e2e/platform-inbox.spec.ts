import { expect, type Page, test } from "@playwright/test";

import { goSection, landOnTenants } from "./platform-nav";

/**
 * PLT-15/16 (0005 §١٩٠) — وارد فريق المنصة: الإشعارات (منشأة بانتظار الاعتماد، إيصال، رسالة…) وعدّادها
 * في القائمة، ورسائل الدعم الواردة من المنشآت ومعالجتها. النصوص من عند المنفّذ (لا إطار مرسوم).
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

async function operatorLogin(page: Page) {
  await page.route("**/api/platform/login", (route) =>
    route.fulfill(
      json(200, { access: "op", refresh: "r", session_id: "s", display_name: "هدى — تشغيل" }),
    ),
  );
  await page.route(/\/api\/platform\/tenants(\?.*)?$/, (route) =>
    route.fulfill(
      json(200, {
        tenants: [],
        total: 0,
        shown: 0,
        active_count: 0,
        filter: "all",
        q: "",
        access_rule: "قراءة بيانات مستأجر تحتاج تذكرة دعم مفتوحة منه.",
        fetched_at: new Date().toISOString(),
      }),
    ),
  );
  await page.goto("/platform/login");
  await page.getByLabel("بريد المشغّل").fill("ops.huda@sting.internal");
  await page.getByLabel("كلمة المرور").fill("very-secret-ops");
  await page.getByRole("button", { name: "دخول مساحة المشغّل" }).click();
  await landOnTenants(page);
}

const notice = (o: Record<string, unknown>) => ({
  id: "n1",
  kind: "tenant_pending",
  kind_label: "منشأة بانتظار الاعتماد",
  title: "منشأة جديدة بانتظار الاعتماد: بقالة الواحة",
  body: "لا تجربة ولا جهاز قبل اعتمادك.",
  href: "/platform/tenants",
  tenant_name: "بقالة الواحة",
  created_at: minutesAgo(5),
  read: false,
  read_by_name: "",
  ...o,
});

test.describe("PLT-15/16", () => {
  test("الإشعارات: عدّاد في القائمة، قائمة بجديدها، تعليم مقروء باسم المشغّل", async ({ page }) => {
    let notices = [
      notice({}),
      notice({
        id: "n2",
        kind: "proof",
        kind_label: "إيصال دفع",
        title: "إيصال دفع جديد TRX-9",
        body: "الشهر — بانتظار المراجعة",
        href: "/platform/proofs",
        created_at: minutesAgo(40),
      }),
    ];
    const reads: unknown[] = [];
    await page.route(/\/api\/platform\/notices(\?.*)?$/, (route) => {
      const unread = notices.filter((n) => !n.read).length;
      return route.fulfill(json(200, { unread, new_messages: 2, notices }));
    });
    await page.route("**/api/platform/notices/read", (route) => {
      const body = route.request().postDataJSON() as { ids?: string[] };
      reads.push(body);
      notices = notices.map((n) =>
        !body.ids || body.ids.includes(n.id)
          ? { ...n, read: true, read_by_name: "هدى — تشغيل" }
          : n,
      );
      const unread = notices.filter((n) => !n.read).length;
      return route.fulfill(json(200, { unread, new_messages: 2, notices }));
    });
    await operatorLogin(page);
    // العدّادان في القائمة قبل فتح أي قسم
    const nav = page.getByRole("navigation", { name: "أقسام المشغّل" });
    await expect(nav.getByRole("link", { name: /الإشعارات/ })).toContainText("2");
    await expect(nav.getByRole("link", { name: /الرسائل/ })).toContainText("2");
    await goSection(page, "الإشعارات 2 جديد");
    await expect(page).toHaveURL(/\/platform\/notices$/);
    const root = page.locator('[data-screen="PLT-15"]');
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(root).toContainText("منشأة جديدة بانتظار الاعتماد: بقالة الواحة");
    await expect(root).toContainText("إيصال دفع جديد TRX-9");
    await expect(root.locator(".plt-notice--new")).toHaveCount(2);
    // تعليم واحد مقروءاً
    await root.getByRole("button", { name: "علّمه مقروءاً" }).first().click();
    await expect(root.locator(".plt-notice--new")).toHaveCount(1);
    expect(reads[0]).toEqual({ ids: ["n1"] });
    await expect(root).toContainText("قرأه هدى — تشغيل");
    // تعليم الكل
    await root.getByRole("button", { name: "علّم الكل مقروءاً" }).click();
    await expect(root.locator(".plt-notice--new")).toHaveCount(0);
    expect(reads[1]).toEqual({});
  });

  test("الرسائل: رسالة دعم واردة ← تفاصيلها التقنية ← تمّت المعالجة بملاحظة", async ({ page }) => {
    const base = {
      id: "m1",
      reference: "SUP-261021-0001",
      tenant_name: "بقالة الواحة",
      from_name: "سالم",
      app_version: "1.4.2",
      note: "الطابعة لا تتصل",
      created_at: minutesAgo(12),
      handled: false,
      handled_by_name: "",
      handled_at: "",
      handled_note: "",
    };
    let message = base;
    const handles: unknown[] = [];
    await page.route(/\/api\/platform\/notices(\?.*)?$/, (route) =>
      route.fulfill(json(200, { unread: 0, new_messages: message.handled ? 0 : 1, notices: [] })),
    );
    await page.route(/\/api\/platform\/messages(\?.*)?$/, (route) => {
      const filter = new URL(route.request().url()).searchParams.get("status") ?? "new";
      const rows = filter === "all" || (filter === "new") === !message.handled ? [message] : [];
      return route.fulfill(
        json(200, { filter, new_count: message.handled ? 0 : 1, messages: rows }),
      );
    });
    await page.route("**/api/platform/messages/m1", (route) =>
      route.fulfill(json(200, { ...message, payload: { app_version: "1.4.2", errors: [] } })),
    );
    await page.route("**/api/platform/messages/m1/handle", (route) => {
      handles.push(route.request().postDataJSON());
      message = {
        ...message,
        handled: true,
        handled_by_name: "هدى — تشغيل",
        handled_at: new Date().toISOString(),
        handled_note: "أُعيد ضبط الطابعة",
      };
      return route.fulfill(json(200, { ...message, payload: { app_version: "1.4.2" } }));
    });
    await operatorLogin(page);
    await goSection(page, "الرسائل 1 جديد");
    await expect(page).toHaveURL(/\/platform\/messages$/);
    const root = page.locator('[data-screen="PLT-16"]');
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(root).toContainText("SUP-261021-0001");
    await expect(root).toContainText("بقالة الواحة");
    await expect(root).toContainText("الطابعة لا تتصل");
    await root.getByRole("button", { name: "افتح" }).click();
    const detail = root.getByRole("region", { name: "تفاصيل الرسالة" });
    await expect(detail.locator("pre")).toContainText('"app_version": "1.4.2"');
    await detail.getByLabel("ملاحظة المعالجة").fill("أُعيد ضبط الطابعة");
    await detail.getByRole("button", { name: "تمّت المعالجة" }).click();
    await expect(detail).toContainText("هدى — تشغيل — أُعيد ضبط الطابعة");
    expect(handles[0]).toEqual({ note: "أُعيد ضبط الطابعة" });
    // لم تعد «جديدة»
    await expect(root.getByText("لا رسائل جديدة")).toBeVisible();
    await root.getByRole("button", { name: /تمّت معالجتها/ }).click();
    await expect(root).toContainText("SUP-261021-0001");
  });
});

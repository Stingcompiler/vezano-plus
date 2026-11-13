import { expect, type Page, test } from "@playwright/test";

import { goSection, landOnTenants } from "./platform-nav";

/**
 * PLT-21 (0005 §٢٦٤) — «الملاحظات» في الوارد: ملاحظات التجار بعدّادها، التصفية بالحالة والنوع، وتغيير
 * الحالة مع ردّ يصل المرسل. نصوص من عند المنفّذ (لا إطار مرسوم) — toContainText.
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

async function operatorLogin(page: Page, newFeedback = 0) {
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
  await page.route(/\/api\/platform\/notices(\?.*)?$/, (route) =>
    route.fulfill(
      json(200, { unread: 0, new_messages: 0, new_feedback: newFeedback, notices: [] }),
    ),
  );
  await page.goto("/platform/login");
  await page.getByLabel("بريد المشغّل").fill("ops.huda@sting.internal");
  await page.getByLabel("كلمة المرور").fill("very-secret-ops");
  await page.getByRole("button", { name: "دخول مساحة المشغّل" }).click();
  await landOnTenants(page);
}

const item = (o: Record<string, unknown>) => ({
  id: "f1",
  source: "merchant",
  has_attachment: true,
  attachment_name: "screen.png",
  contact_email: "",
  tenant_id: "t1",
  tenant_name: "بقالة الواحة",
  reference: "FB-261112-0001",
  kind: "suggestion",
  kind_label: "اقتراح",
  text: "تقرير مبيعات حسب الساعة",
  contact_ok: true,
  from_name: "سميرة ع.",
  screen: "SYS-11",
  platform: "mobile",
  app_version: "1.4.2",
  status: "new",
  status_label: "جديدة",
  reply: "",
  updated_by_name: "",
  updated_at: "",
  created_at: minutesAgo(5),
  ...o,
});

test.describe("PLT-21", () => {
  test("القائمة بعدّادها، التصفية، والحالة مع الردّ", async ({ page }) => {
    let items = [
      item({}),
      item({
        id: "f2",
        reference: "FB-261112-0002",
        kind: "problem",
        kind_label: "مشكلة",
        text: "الطابعة تطبع سطراً فارغاً",
        platform: "web",
        contact_ok: false,
      }),
    ];
    const queries: string[] = [];
    const updates: unknown[] = [];
    await page.route(/\/api\/platform\/feedback(\?.*)?$/, (route) => {
      const url = new URL(route.request().url());
      queries.push(url.search);
      const kind = url.searchParams.get("kind") ?? "";
      const st = url.searchParams.get("status") ?? "open";
      const shown = items.filter(
        (i) =>
          (!kind || i.kind === kind) &&
          (st === "all" ||
            (st === "open" ? ["new", "studying"].includes(i.status) : i.status === st)),
      );
      const counts = { new: 0, studying: 0, done: 0, declined: 0 } as Record<string, number>;
      for (const i of items) counts[i.status] = (counts[i.status] ?? 0) + 1;
      return route.fulfill(json(200, { filter: st, kind, counts, items: shown }));
    });
    await page.route(/\/api\/platform\/feedback\/t1\/f1$/, (route) => {
      const body = route.request().postDataJSON() as { status: string; reply: string };
      updates.push(body);
      items = items.map((i) =>
        i.id === "f1"
          ? {
              ...i,
              status: body.status,
              status_label: body.status === "done" ? "نُفّذت" : "قيد الدراسة",
              reply: body.reply,
              updated_by_name: "هدى — تشغيل",
            }
          : i,
      );
      return route.fulfill(json(200, items[0]));
    });
    await page.route(/\/api\/platform\/feedback\/t1\/f1\/attachment$/, (route) =>
      route.fulfill(
        json(200, {
          data_url:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
          name: "screen.png",
        }),
      ),
    );
    await operatorLogin(page, 2);
    const nav = page.getByRole("navigation", { name: "أقسام المشغّل" });
    await expect(nav.getByRole("link", { name: /الملاحظات/, includeHidden: true })).toContainText(
      "2",
    );
    await goSection(page, "الملاحظات 2 جديد");
    const root = page.locator('[data-screen="PLT-21"]');
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(root).toContainText("تقرير مبيعات حسب الساعة");
    await expect(root).toContainText("الطابعة تطبع سطراً فارغاً");
    await expect(root).toContainText("يقبل التواصل");
    await expect(root).toContainText("الجوال");

    await root.getByRole("button", { name: "مشكلة", exact: true }).click();
    await expect(root).not.toContainText("تقرير مبيعات حسب الساعة");
    await root.getByRole("button", { name: "كل الأنواع" }).click();

    await root
      .locator("li", { hasText: "FB-261112-0001" })
      .getByRole("button", { name: "افتح" })
      .click();
    await expect(root.getByRole("img", { name: "لقطة الشاشة المرفقة" })).toBeVisible();
    // 0005 §٢٧٣: الرابط `blob:` يفتحه المتصفح في تبويب؛ رابط `data:` كان يفتح تبويباً فارغاً
    await expect(root.locator("a.plt-fb-shot")).toHaveAttribute("href", /^blob:/);
    await root.getByLabel("ردّ الفريق").fill("سنضيفه في الإصدار القادم");
    await root.getByRole("radio", { name: "نُفّذت" }).check();
    await root.getByRole("button", { name: "احفظ وأبلغ المرسل" }).click();
    await expect(root).toContainText("حُفظ — يراه المرسل في «ملاحظاتي»");
    expect(updates).toEqual([{ status: "done", reply: "سنضيفه في الإصدار القادم" }]);
    // «نُفّذت» خرجت من «مفتوحة»
    await expect(root.locator("#plt-feedback-list")).not.toContainText("تقرير مبيعات حسب الساعة");
    await root.getByRole("button", { name: /^نُفّذت/ }).click();
    await expect(root.locator("#plt-feedback-list")).toContainText("تقرير مبيعات حسب الساعة");
    expect(queries.some((q) => q.includes("kind=problem"))).toBe(true);
  });

  test("الزوار (§٢٦٦): مصدر منفصل بعدّاده، بريد الزائر، وملاحظة داخلية", async ({ page }) => {
    const pub = item({
      id: "p1",
      source: "public",
      tenant_id: "",
      tenant_name: "بقالة الواحة",
      reference: "PF-261112-0001",
      kind: "shop",
      kind_label: "ملاحظة عن محل",
      text: "الأسعار غير ظاهرة",
      contact_ok: true,
      contact_email: "visitor@example.com",
      from_name: "",
      screen: "/portal/wahat",
      platform: "public",
      app_version: "",
    });
    const updates: unknown[] = [];
    await page.route(/\/api\/platform\/feedback(\?.*)?$/, (route) => {
      const src = new URL(route.request().url()).searchParams.get("source") ?? "merchant";
      return route.fulfill(
        json(200, {
          source: src,
          filter: "open",
          kind: "",
          counts: { new: 1, studying: 0, done: 0, declined: 0 },
          items: src === "public" ? [pub] : [item({})],
          new: { merchant: 1, public: 1 },
          summary: {
            merchant: { suggestion: 3, problem: 1, opinion: 0 },
            public: { platform: 0, site: 2, shop: 1 },
          },
        }),
      );
    });
    await page.route(/\/api\/platform\/feedback\/public\/p1$/, (route) => {
      updates.push(route.request().postDataJSON());
      return route.fulfill(
        json(200, {
          ...pub,
          status: "studying",
          status_label: "قيد الدراسة",
          emailed_at: new Date().toISOString(),
          email: "sent",
        }),
      );
    });
    await operatorLogin(page);
    await goSection(page, "الملاحظات");
    const root = page.locator('[data-screen="PLT-21"]');
    await expect(root).toContainText("تقرير مبيعات حسب الساعة");
    await expect(root).toContainText("آخر 30 يوماً: اقتراح 3 · مشكلة 1 · رأي 0");
    await root.getByRole("button", { name: /^الزوار/ }).click();
    await expect(root).toContainText(
      "آخر 30 يوماً: اقتراح للمنصة 0 · مشكلة في الموقع 2 · ملاحظة عن محل 1",
    );
    await expect(root).toContainText("خاصة بالفريق، لا تُنشر ولا تُرسل إلى المحل.");
    await expect(root.locator("#plt-feedback-list")).toContainText("الأسعار غير ظاهرة");
    await expect(root.locator("#plt-feedback-list")).toContainText("من زائر");
    await expect(root.getByRole("button", { name: "ملاحظة عن محل" })).toBeVisible();
    await root.getByRole("button", { name: "افتح" }).click();
    await expect(root).toContainText("visitor@example.com");
    await root.getByLabel("ملاحظة الفريق").fill("تواصلنا مع المحل");
    await root.getByRole("switch", { name: "أرسل الردّ إلى بريد الزائر" }).click();
    await root.getByRole("button", { name: "احفظ", exact: true }).click();
    await expect(root).toContainText("حُفظ وأُرسل الردّ إلى بريد الزائر");
    expect(updates).toEqual([{ status: "studying", reply: "تواصلنا مع المحل", email_reply: true }]);
  });

  test("empty", async ({ page }) => {
    await page.route(/\/api\/platform\/feedback(\?.*)?$/, (route) =>
      route.fulfill(
        json(200, {
          filter: "open",
          kind: "",
          counts: { new: 0, studying: 0, done: 0, declined: 0 },
          items: [],
        }),
      ),
    );
    await operatorLogin(page);
    await goSection(page, "الملاحظات");
    const root = page.locator('[data-screen="PLT-21"]');
    await expect(root).toHaveAttribute("data-state", "empty");
    await expect(root).toContainText("لا ملاحظات هنا");
  });
});

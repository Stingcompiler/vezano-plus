import { expect, type Page, test } from "@playwright/test";

import { goSection, landOnTenants } from "./platform-nav";

/**
 * فحص 2026-10-17 VP13 — سجل تدقيق المشغّلين: قسم في القائمة برابط حقيقي وعنوان تبويب، أفعال
 * بتسمية عربية ومن ومتى وأيّ مستأجر، تصفية بالفئة والمشغّل والمستأجر، وصفحة أقدم بالمؤشّر.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

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
  await page.goto("/platform/login");
  await page.getByLabel("بريد المشغّل").fill("ops.tayeb@sting.internal");
  await page.getByLabel("كلمة المرور").fill("very-secret-ops");
  await page.getByRole("button", { name: "دخول مساحة المشغّل" }).click();
  await landOnTenants(page);
}

const ENTRY = (o: Record<string, unknown>) => ({
  id: "e1",
  at: "2026-10-17T09:15:00+00:00",
  operator_id: "op1",
  operator_name: "طيب — تشغيل",
  tenant_id: "",
  tenant_name: "",
  action: "login",
  action_label: "دخول",
  detail: "",
  ticket_ref: "",
  ...o,
});
const BASE = {
  operators: [
    { id: "op1", name: "طيب — تشغيل" },
    { id: "op2", name: "سارة — دعم" },
  ],
  categories: [
    { code: "session", label: "الجلسات" },
    { code: "catalog", label: "الباقات والاستحقاقات" },
  ],
};

test("VP13: سجل التدقيق — رابط القسم وعنوانه، الأفعال بتسميتها، التصفية، والأقدم", async ({
  page,
}) => {
  const seen: URLSearchParams[] = [];
  await page.route("**/api/platform/audit**", (route) => {
    const q = new URL(route.request().url()).searchParams;
    seen.push(q);
    if (q.get("before"))
      return route.fulfill(
        json(200, {
          ...BASE,
          entries: [ENTRY({ id: "e9", action_label: "خروج", at: "2026-10-16T18:00:00+00:00" })],
          next_before: "",
          filters: { operator: "", category: "", tenant: "" },
        }),
      );
    const tenant = q.get("tenant") ?? "";
    const entries =
      q.get("category") === "catalog"
        ? [
            ENTRY({
              id: "e3",
              action: "plan.update",
              action_label: "تعديل باقة",
              detail: "فرع واحد",
            }),
          ]
        : tenant
          ? [
              ENTRY({
                id: "e2",
                action_label: "فتح سجل مستأجر",
                tenant_id: "t1",
                tenant_name: "بقالة النور",
              }),
            ]
          : [
              ENTRY({ id: "e1" }),
              ENTRY({
                id: "e2",
                action_label: "فتح سجل مستأجر",
                tenant_id: "t1",
                tenant_name: "بقالة النور",
                ticket_ref: "SUP-771",
              }),
            ];
    return route.fulfill(
      json(200, {
        ...BASE,
        entries,
        next_before: q.get("category") || tenant ? "" : "2026-10-17T09:15:00+00:00~e1",
        filters: { operator: "", category: q.get("category") ?? "", tenant },
      }),
    );
  });
  await operatorLogin(page);
  const link = page
    .getByRole("navigation", { name: "أقسام المشغّل" })
    .getByRole("link", { name: "سجل التدقيق", exact: true });
  await expect(link).toHaveAttribute("href", "/platform/audit");
  await goSection(page, "سجل التدقيق");
  await expect(page).toHaveURL(/\/platform\/audit$/);
  await expect(page).toHaveTitle(/سجل التدقيق · الإدارة/);
  const root = page.locator('[data-screen="PLT-AUDIT"]');
  await expect(root).toHaveAttribute("data-state", "ready");
  await expect(root).toContainText("فتح سجل مستأجر");
  await expect(root).toContainText("تذكرة SUP-771");
  // أقدم: صفحة تالية بالمؤشّر تُلحق ولا تستبدل
  await page.getByRole("button", { name: "أقدم" }).click();
  await expect(root).toContainText("خروج");
  await expect(root).toContainText("فتح سجل مستأجر");
  expect(seen.some((q) => q.get("before") === "2026-10-17T09:15:00+00:00~e1")).toBe(true);
  // المستأجر يصفّي به
  await root.getByRole("button", { name: "بقالة النور" }).first().click();
  await expect(root).toContainText("المستأجر: بقالة النور");
  await expect(root).not.toContainText("خروج");
  await page.getByRole("button", { name: "إزالة" }).click();
  // الفئة
  await page.getByRole("combobox", { name: "الفئة" }).selectOption("catalog");
  await expect(root).toContainText("تعديل باقة");
  await expect(root).toContainText("فرع واحد");
  await expect(root).not.toContainText("فتح سجل مستأجر");
});

test("VP13: تصفية بلا مطابق — «لا أفعال تطابق التصفية» ومخرج إزالتها", async ({ page }) => {
  await page.route("**/api/platform/audit**", (route) => {
    const q = new URL(route.request().url()).searchParams;
    return route.fulfill(
      json(200, {
        ...BASE,
        entries: q.get("operator") ? [] : [ENTRY({})],
        next_before: "",
        filters: { operator: q.get("operator") ?? "", category: "", tenant: "" },
      }),
    );
  });
  await operatorLogin(page);
  await goSection(page, "سجل التدقيق");
  await page.getByRole("combobox", { name: "المشغّل" }).selectOption("op2");
  const root = page.locator('[data-screen="PLT-AUDIT"]');
  await expect(root).toContainText("لا أفعال تطابق التصفية");
  await page.getByRole("button", { name: "أزل التصفية" }).click();
  await expect(root).toContainText("دخول");
});

import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * 0005 §٢٦٩ — الباركود الداخلي (المرحلة ١): زرّ «أنشئ باركوداً داخلياً» في CAT-02/CAT-03 يملأ الحقل
 * من عدّاد الخادم (EAN-13 بالبادئة 20)، والتوليد الجماعي في CAT-01 للمالك ومدير الفرع. النصوص غير
 * مرسومة (اعتمدها المالك) فتُفحص بـ`toContainText` لا `fromFrame`.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const UNITS = {
  units: [
    { id: "u-piece", code: "piece", name: "حبة", is_base: true, decimal_places: 0 },
    { id: "u-carton", code: "carton", name: "كرتون", is_base: false, decimal_places: 0 },
  ],
};

const listItem = (id: string, name: string, barcode: string) => ({
  id,
  name,
  name_normalized: name,
  group_id: "",
  group_name: "",
  base_unit_id: "u-piece",
  base_unit_code: "piece",
  base_unit_name: "حبة",
  units: [],
  barcode,
  sale_price_minor: "500",
  price_updated_at: new Date().toISOString(),
  aliases: [],
  is_active: true,
  deactivated_at: "",
  updated_at: new Date().toISOString(),
});

async function login(page: Page, next: string) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.route("**/api/catalog/units", (route) => route.fulfill(json(200, UNITS)));
  await page.route("**/api/catalog/groups", (route) =>
    route.fulfill(json(200, { group_count: 0, total_items: 0, groups: [] })),
  );
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/\//g, "\\/")}$`));
}

test.describe("الباركود الداخلي — CAT-02", () => {
  test("الزرّ يملأ الحقل من الخادم ثم يختفي، والملاحظة تقول إنه داخلي", async ({ page }, info) => {
    let calls = 0;
    await page.route("**/api/catalog/barcode/generate", (route) => {
      calls += 1;
      return route.fulfill(json(200, { barcode: "2000000000015" }));
    });
    await login(page, "/catalog/new");
    const root = page.locator('[data-screen="CAT-02"]');
    const field = root.locator('[data-field="barcode"] input');
    await expect(field).toHaveValue("");
    await root.getByRole("button", { name: "أنشئ باركوداً داخلياً" }).click();
    await expect(field).toHaveValue("2000000000015");
    expect(calls).toBe(1);
    await expect(root).toContainText("باركود داخلي لمتجرك — يبدأ بـ 20 ولا يصلح خارج المتجر");
    await expect(root.getByRole("button", { name: "أنشئ باركوداً داخلياً" })).toHaveCount(0);
    await expectFrame(page, info, {
      screenId: "CAT-02",
      state: "ready",
      texts: fromFrame("CAT-02", "ready", ["الباركود", "هوية لا اسم — لا يحمله صنفان"]),
    });
    // مسح الحقل يعيد الزرّ؛ باركود المصنع لا يُظهر الملاحظة
    await field.fill("6291041500213");
    await expect(root).not.toContainText("باركود داخلي لمتجرك");
    await expect(root.getByRole("button", { name: "أنشئ باركوداً داخلياً" })).toHaveCount(0);
    await field.fill("");
    await expect(root.getByRole("button", { name: "أنشئ باركوداً داخلياً" })).toBeVisible();
  });

  test("الفشل يُقال ولا يمسّ الحقل", async ({ page }) => {
    await page.route("**/api/catalog/barcode/generate", (route) =>
      route.fulfill(json(500, { detail: "server_error" })),
    );
    await login(page, "/catalog/new");
    const root = page.locator('[data-screen="CAT-02"]');
    await root.getByRole("button", { name: "أنشئ باركوداً داخلياً" }).click();
    await expect(root.getByRole("alert")).toContainText("تعذّر إنشاء الباركود — حاول مرة أخرى");
    await expect(root.locator('[data-field="barcode"] input')).toHaveValue("");
  });
});

test.describe("الباركود الداخلي — CAT-01 التوليد الجماعي", () => {
  test("المالك: العدد ثم الزرّ ثم دفعات حتى لا يبقى شيء", async ({ page }, info) => {
    let missing = 3;
    await page.route(/\/api\/catalog\/items(\?.*)?$/, (route) =>
      route.fulfill(
        json(200, {
          items: [
            listItem("i1", "عدس", missing ? "" : "2000000000015"),
            listItem("i2", "سكر", "6291041500213"),
          ],
          total: 2,
          all_total: 2,
          groups: [],
          offset: 0,
          can_assign_barcodes: true,
          missing_barcode_count: missing,
        }),
      ),
    );
    const batches: number[] = [];
    await page.route("**/api/catalog/barcode/assign-missing", (route) => {
      const assigned = Math.min(2, missing);
      missing -= assigned;
      batches.push(assigned);
      return route.fulfill(json(200, { assigned, remaining: missing }));
    });
    await login(page, "/catalog");
    const root = page.locator('[data-screen="CAT-01"]');
    await expect(root).toContainText("3 صنف بلا باركود");
    await root.getByRole("button", { name: "أنشئ باركوداً للأصناف التي بلا باركود" }).click();
    await expect(root).toContainText("أُنشئ باركود داخلي لـ 3 صنف");
    expect(batches).toEqual([2, 1]);
    await expect(
      root.getByRole("button", { name: "أنشئ باركوداً للأصناف التي بلا باركود" }),
    ).toHaveCount(0);
    await expectFrame(page, info, {
      screenId: "CAT-01",
      state: "ready",
      texts: fromFrame("CAT-01", "ready", ["الباركود"]),
    });
  });

  test("من لا يملكه لا يرى الزرّ", async ({ page }) => {
    await page.route(/\/api\/catalog\/items(\?.*)?$/, (route) =>
      route.fulfill(
        json(200, {
          items: [listItem("i1", "عدس", "")],
          total: 1,
          all_total: 1,
          groups: [],
          offset: 0,
          can_assign_barcodes: false,
          missing_barcode_count: 1,
        }),
      ),
    );
    await login(page, "/catalog");
    const root = page.locator('[data-screen="CAT-01"]');
    await expect(root).toContainText("عدس");
    await expect(root).not.toContainText("صنف بلا باركود");
  });
});

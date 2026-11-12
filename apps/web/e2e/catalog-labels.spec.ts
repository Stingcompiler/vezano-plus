import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { openSeedPage } from "./seed-page";

/**
 * 0005 §٢٧٠ — CAT-07 ملصقات الأصناف (المرحلة ٢ من الباركود الداخلي؛ لا إطار مرسوم، فالنصوص تُفحص
 * حرفياً من القرار لا بـ`fromFrame`). الكتالوج المحلي وحده؛ A4 وورق الإيصال بحوار الطباعة حين لا
 * طابعة BLE مجرَّبة.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const local = (id: string, name: string, barcode: string, units: unknown[] = []) => ({
  id,
  name,
  name_normalized: name,
  group_id: "",
  group_name: "",
  base_unit_id: "u-piece",
  base_unit_code: "piece",
  base_unit_name: "حبة",
  units,
  barcode,
  sale_price_minor: "1250",
  price_updated_at: new Date().toISOString(),
  aliases: [],
  is_active: true,
  deactivated_at: "",
  updated_at: new Date().toISOString(),
});

const ITEMS = [
  local("i1", "عدس أحمر", "2000000000015", [
    {
      unit_id: "u-carton",
      code: "carton",
      name: "كرتونة",
      factor_milli: "12000",
      barcode: "2000000000022",
    },
  ]),
  local("i2", "سكر", "6291000000142"), // خانة تحقق خاطئة → لا يُطبع
  local("i3", "بلا باركود", ""),
];

async function seed(page: Page, items: unknown[]) {
  await page.addInitScript(() => {
    const w = window as unknown as { __prints: number; print: () => void };
    w.__prints = 0;
    w.print = () => {
      w.__prints += 1;
    };
  });
  await openSeedPage(page);
  await page.evaluate(async (rows) => {
    const req = indexedDB.open("sting-bootstrap");
    const db = await new Promise<IDBDatabase>((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(new Error(String(req.error)));
    });
    await new Promise<void>((res) => {
      const tx = db.transaction(["projections"], "readwrite");
      for (const r of rows as { id: string }[])
        tx.objectStore("projections").put({ key: `entity:catalog.Item:${r.id}`, value: r });
      tx.oncomplete = () => res();
    });
    db.close();
  }, items);
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.route(/\/api\/catalog\/items(\?.*)?$/, (route) =>
    route.fulfill(
      json(200, {
        items,
        total: items.length,
        all_total: items.length,
        groups: [],
        offset: 0,
        can_assign_barcodes: false,
        missing_barcode_count: 0,
      }),
    ),
  );
}

async function login(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
}

const prints = (page: Page) =>
  page.evaluate(() => (window as unknown as { __prints: number }).__prints);

test.describe("CAT-07 ملصقات الأصناف", () => {
  test("ready: من بطاقة الصنف — وحداته محدَّدة، غير EAN-13 يُقال، وA4 بحوار الطباعة", async ({
    page,
  }, info) => {
    await seed(page, ITEMS);
    await login(page, "/catalog/labels?item=i1");
    const root = page.locator('[data-screen="CAT-07"][data-state="ready"]');
    await expect(root).toBeVisible();
    await expect(root).toContainText("1 باركود ليس EAN-13 — لا يُطبع هنا");
    await expect(root).toContainText("2 ملصق");
    await expect(root).not.toContainText("بلا باركود");
    const cells = root.locator(".cat-labels-page .cat-label");
    await expect(cells).toHaveCount(2);
    await expect(cells.first()).toContainText("2000000000015");
    await expect(cells.nth(1)).toContainText("عدس أحمر — كرتونة");
    // بلا سعر افتراضاً؛ المفتاح يضيفه بسعر الوحدة
    await expect(root.locator(".cat-label__price")).toHaveCount(0);
    await root.getByRole("switch", { name: "السعر على الملصق" }).click();
    await expect(root.locator(".cat-label__price").nth(1)).toContainText("150.00");
    await expectFrame(page, info, {
      screenId: "CAT-07",
      state: "ready",
      texts: ["ملصقات الأصناف", "المقاس", "السعر على الملصق", "اطبع ملصقات", "العدد"],
    });
    await root.getByRole("button", { name: "اطبع ملصقات" }).click();
    await expect.poll(() => prints(page)).toBe(1);
  });

  test("من قائمة الكتالوج: العدد يُكتب، والصفر يعطّل الطباعة بسببه، و58 مم بلا طابعة بحوار النظام", async ({
    page,
  }) => {
    await seed(page, ITEMS);
    await login(page, "/catalog");
    await page.locator('[data-screen="CAT-01"]').getByRole("link", { name: "اطبع ملصقات" }).click();
    const root = page.locator('[data-screen="CAT-07"][data-state="ready"]');
    await expect(root).toBeVisible();
    await expect(root).toContainText("0 ملصق");
    await expect(root).toContainText("اكتب عدداً لصنف واحد على الأقل");
    await root.getByLabel("العدد — عدس أحمر", { exact: true }).fill("3");
    await expect(root).toContainText("3 ملصق");
    await root.getByLabel("المقاس").selectOption("58");
    await expect(root.locator(".cat-labels-strip--58 .cat-label")).toHaveCount(3);
    await root.getByRole("button", { name: "اطبع ملصقات" }).click();
    await expect.poll(() => prints(page)).toBe(1);
  });

  test("empty: لا صنف بباركود EAN-13 — الطريق إلى الكتالوج", async ({ page }, info) => {
    await seed(page, [ITEMS[1], ITEMS[2]]);
    await login(page, "/catalog/labels");
    const root = page.locator('[data-screen="CAT-07"][data-state="empty"]');
    await expect(root).toBeVisible();
    await expectFrame(page, info, {
      screenId: "CAT-07",
      state: "empty",
      texts: ["لا صنف بباركود يُطبع", "الكتالوج"],
    });
  });
});

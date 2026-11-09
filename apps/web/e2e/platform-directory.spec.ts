import { expect, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { goSection } from "./platform-nav";
import { json } from "./pos-invoices-fixtures";

/** PLT-20 — جدول المستأجرين (0005 §٢٢٩): الدولة باسمها، والأجهزة، والفرز من الخادم، والترقيم. */

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const ROW = (o: Record<string, unknown>) => ({
  id: "t1",
  name: "بقالة النيل",
  country: "SD",
  country_at: ago(1),
  plan_label: "أساسي",
  plan_code: "single",
  status: "active",
  status_label: "نشط",
  devices_active: 3,
  devices_all: 4,
  branches: 2,
  users: 5,
  last_seen_at: ago(3),
  created_at: "2026-09-01T08:00:00Z",
  ...o,
});
const BODY = (rows: unknown[], o: Record<string, unknown> = {}) => ({
  tenants: rows,
  total: 42,
  shown: rows.length ? 42 : 0,
  devices_total: 97,
  countries: [
    { code: "SD", tenants: 30 },
    { code: "SA", tenants: 8 },
  ],
  unknown_country: 4,
  sort: "created",
  desc: true,
  q: "",
  country: "",
  page: { number: 1, size: 25, total: rows.length ? 42 : 0, pages: rows.length ? 2 : 1 },
  fetched_at: new Date().toISOString(),
  ...o,
});

test.describe("جدول المستأجرين", () => {
  test("PLT-20: الدولة والأجهزة في صفّ، والفرز والدولة والترقيم تُطلب من الخادم", async ({
    page,
  }, info) => {
    const asked: URLSearchParams[] = [];
    await page.route("**/api/platform/login", (route) =>
      route.fulfill(
        json(200, { access: "op", refresh: "r", session_id: "s", display_name: "هدى — تشغيل" }),
      ),
    );
    await page.route(/\/api\/platform\/tenants\/directory(\?.*)?$/, (route) => {
      const p = new URL(route.request().url()).searchParams;
      asked.push(p);
      if (p.get("q") === "لا شيء") return route.fulfill(json(200, BODY([])));
      return route.fulfill(
        json(
          200,
          BODY([
            ROW({}),
            ROW({
              id: "t2",
              name: "مخزن البركة",
              country: "",
              devices_active: 1,
              devices_all: 1,
              last_seen_at: "",
            }),
          ]),
        ),
      );
    });
    await page.goto("/platform/login");
    await page.getByLabel("بريد المشغّل").fill("ops.huda@sting.internal");
    await page.getByLabel("كلمة المرور").fill("very-secret-ops");
    await page.getByRole("button", { name: "دخول مساحة المشغّل" }).click();
    await expect(page).toHaveURL(/\/platform$/);
    await goSection(page, "جدول المستأجرين");
    await expect(page).toHaveURL(/\/platform\/directory$/);
    const root = page.locator('[data-screen="PLT-20"]');
    await expect(root).toHaveAttribute("data-state", "ready");
    await expectFrame(page, info, {
      screenId: "PLT-20",
      state: "ready",
      texts: [
        "جدول المستأجرين",
        "الدولة",
        "الأجهزة",
        "الفروع",
        "المستخدمون",
        "آخر نشاط",
        "السودان",
        "غير معروفة بعد",
        "لم يُستعمل بعد",
      ],
    });
    await expect(root.locator(".plt-dir__sum")).toContainText(
      "42 متجراً · 97 جهازاً نشطاً · 2 دول",
    );
    await expect(root.getByText("1 موقوف")).toBeVisible();
    // الطلب الأول: الأحدث تسجيلاً، صفحة أولى بحجم 25
    expect(asked[0]?.get("sort")).toBe("created");
    expect(asked[0]?.get("page_size")).toBe("25");
    // الدولة مرشّح من الخادم
    await root.getByLabel("الدولة").selectOption("SA");
    await expect.poll(() => asked.at(-1)?.get("country")).toBe("SA");
    // فرز «الأكثر أجهزة» يطلبه الخادم تنازلياً
    await root.getByLabel("الترتيب").selectOption("devices:desc");
    await expect
      .poll(() => `${asked.at(-1)?.get("sort")}:${asked.at(-1)?.get("dir")}`)
      .toBe("devices:desc");
    // الترقيم
    await root.getByRole("button", { name: "الصفحة 2" }).click();
    await expect.poll(() => asked.at(-1)?.get("page")).toBe("2");
    // لا نتيجة: الفراغ يقول ماذا تغيّر
    await root.getByLabel("ابحث باسم المتجر أو معرِّفه").fill("لا شيء");
    await expect(root).toHaveAttribute("data-state", "empty");
    await expect(root.getByText("لا متاجر تطابق البحث")).toBeVisible();
  });
});

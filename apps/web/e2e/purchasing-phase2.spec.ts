import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { openSeedPage } from "./seed-page";

/**
 * المشتريات والمخزون — المرحلة ٢ «إغلاق الدوائر» (0005 §٢٩٥): «حوّل إلى مستند شراء» من الاستلام
 * والاستلام على أمر مفتوح (I-02)، والحجر بأفعاله الثلاثة (I-06)، ومصير المرفوض (I-07)، و«استلم
 * الباقي» وقرار المالك على الفرق (I-08)، و«جلسات الجرد» (I-10). الشاشات الجديدة بلا إطار مرسوم:
 * نصوصها تُفحص حرفياً بـ`toContainText`/`texts` لا بـ`fromFrame`.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const ITEM = {
  id: "i1",
  name: "سكر أبيض",
  name_normalized: "سكر أبيض",
  group_id: "g-1",
  group_name: "بقالة",
  base_unit_id: "u-bag",
  base_unit_code: "bag",
  base_unit_name: "كيس",
  base_unit_decimal_places: 0,
  units: [
    {
      id: "iu-i1-carton",
      unit_id: "u-carton",
      code: "carton",
      name: "كرتونة",
      decimal_places: 0,
      factor_milli: "12000",
      barcode: "",
    },
  ],
  barcode: "",
  sale_price_minor: "10000",
  price_updated_at: "2026-09-01T10:00:00.000Z",
  alert_threshold_milli: "",
  aliases: [] as string[],
  is_active: true,
  deactivated_at: "",
  updated_at: "2026-09-01T10:00:00.000Z",
};

async function seed(page: Page, role: "owner" | "storekeeper" | "manager" = "owner") {
  await openSeedPage(page);
  await page.evaluate(
    async ({ role, item }) => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      await new Promise<void>((res) => {
        const tx = db.transaction(["meta", "projections"], "readwrite");
        const meta = tx.objectStore("meta");
        const proj = tx.objectStore("projections");
        meta.put({
          key: "device.registration",
          value: JSON.stringify({
            deviceId: "d1",
            prefix: "A2",
            branchId: "b1",
            branchCode: "KRT",
          }),
        });
        meta.put({ key: "sync_epoch", value: "epoch-A" });
        meta.put({
          key: "shift.context",
          value: JSON.stringify({
            branchId: "b1",
            branchName: "الرئيسي",
            branchCode: "KRT",
            deviceId: "d1",
            deviceName: "مخزن",
            devicePrefix: "A2",
            userId: "u1",
            userName: role === "owner" ? "عثمان" : "هبة",
            roleName: role === "owner" ? "مالك" : role === "manager" ? "مدير" : "أمين مخزن",
            roleCode: role,
          }),
        });
        proj.put({ key: `entity:catalog.Item:${item.id}`, value: item });
        tx.oncomplete = () => res();
      });
      db.close();
    },
    { role, item: ITEM },
  );
}

async function login(page: Page, next: string) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, (c) => `\\${c}`)}$`));
}

function pushRoute(page: Page, seen: Record<string, unknown>[]) {
  return page.route("**/api/sync/push", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      operations: { operation_id: string }[];
      request_id: string;
    };
    seen.push(...body.operations);
    return route.fulfill(
      json(200, {
        protocol_version: 1,
        sync_epoch: "epoch-A",
        request_id: body.request_id,
        results: body.operations.map((o) => ({
          operation_id: o.operation_id,
          status: "accepted",
          member_receipts: [],
        })),
        server_seq_high: "9",
      }),
    );
  });
}

const RECEIPT = {
  id: "r-1",
  receipt_number: "RCV-KRT-A2-26-000007",
  branch_id: "b1",
  branch_name: "الرئيسي",
  supplier_name: "مطاحن سيقا — وكيل",
  party_id: "sup-1",
  reference: "فاتورة 8841",
  user_name: "هبة",
  occurred_at: new Date().toISOString(),
  order_id: "o1",
  order_number: "12",
  lines: [
    {
      id: "rl-1",
      item_id: "i1",
      item_name: "سكر أبيض",
      unit_code: "carton",
      unit_name: "كرتونة",
      factor_milli: "12000",
      qty_milli: "6000",
      base_qty_milli: "72000",
      unit_cost_minor: "",
    },
  ],
  document: null,
  can_convert: true,
};

test.describe("I-02 — الاستلامات و«حوّل إلى مستند شراء»", () => {
  test("INV-12 → INV-11: استلام بلا مستند شراء يُحوَّل فيفتح مستنده", async ({ page }, info) => {
    await seed(page);
    await page.route(/\/api\/inventory\/receipts(\?.*)?$/, (route) =>
      route.fulfill(
        json(200, { scope: "unpriced", unpriced_count: 1, can_convert: true, receipts: [RECEIPT] }),
      ),
    );
    await page.route("**/api/inventory/receipts/r-1", (route) =>
      route.fulfill(json(200, { receipt: RECEIPT })),
    );
    let converted = 0;
    await page.route("**/api/inventory/receipts/r-1/document", (route) => {
      converted += 1;
      return route.fulfill(json(200, { document: { id: "d9" } }));
    });
    await page.route("**/api/inventory/purchasing/documents/d9", (route) =>
      route.fulfill(json(403, { detail: "permission_denied" })),
    );
    await login(page, "/inventory/receipts");
    await expectFrame(page, info, {
      screenId: "INV-12",
      state: "ready",
      texts: [
        "الاستلامات",
        "الاستلام يُدخل المخزون فقط. للذمّة حوّله إلى مستند شراء — لا تسجّله مرة ثانية.",
        "بلا مستند شراء",
        "RCV-KRT-A2-26-000007",
        "مطاحن سيقا — وكيل · هبة",
      ],
    });
    await page.getByRole("button", { name: "RCV-KRT-A2-26-000007" }).first().click();
    await expect(page).toHaveURL(/\/inventory\/receipts\/r-1$/);
    await expectFrame(page, info, {
      screenId: "INV-11",
      state: "ready",
      texts: [
        "استلام RCV-KRT-A2-26-000007",
        "المورد",
        "مرجع المستند",
        "أمر الشراء",
        "سكر أبيض",
        "6 كرتونة",
        "بلا مستند شراء",
        "حوّل إلى مستند شراء",
      ],
    });
    await page.getByRole("button", { name: "حوّل إلى مستند شراء" }).click();
    await expect(page).toHaveURL(/\/purchasing\/documents\/d9$/);
    expect(converted).toBe(1);
  });

  test("INV-11: أمين المخزن يرى الاستلام ولا يحوّله؛ المسعَّر يفتح مستنده؛ INV-12 فارغة", async ({
    page,
  }, info) => {
    await seed(page, "storekeeper");
    await page.route("**/api/inventory/receipts/r-1", (route) =>
      route.fulfill(json(200, { receipt: { ...RECEIPT, can_convert: false } })),
    );
    await page.route("**/api/inventory/receipts/r-2", (route) =>
      route.fulfill(
        json(200, {
          receipt: {
            ...RECEIPT,
            id: "r-2",
            document: { id: "d9", number: "44", status: "approved", status_label: "معتمد" },
          },
        }),
      ),
    );
    await page.route(/\/api\/inventory\/receipts(\?.*)?$/, (route) =>
      route.fulfill(
        json(200, { scope: "unpriced", unpriced_count: 0, can_convert: false, receipts: [] }),
      ),
    );
    await login(page, "/inventory/receipts/r-1");
    await expectFrame(page, info, {
      screenId: "INV-11",
      state: "ready",
      texts: ["بلا مستند شراء", "الاعتماد للمالك والمحاسب"],
    });
    await expect(page.getByRole("button", { name: "حوّل إلى مستند شراء" })).toHaveCount(0);
    await page.route("**/api/auth/resume", (route) =>
      route.fulfill(
        json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
      ),
    );
    await page.goto("/inventory/receipts/r-2");
    await expectFrame(page, info, {
      screenId: "INV-11",
      state: "ready",
      texts: [
        "مستند شراء 44 — معتمد",
        "دخل من الاستلام",
        "— لا يدخل مرة ثانية.",
        "افتح مستند الشراء",
      ],
    });
    await page.getByRole("button", { name: "الاستلامات" }).click();
    await expectFrame(page, info, {
      screenId: "INV-12",
      state: "empty",
      texts: ["لا استلامات بلا مستند شراء", "استلام بضاعة"],
    });
  });

  test("INV-04: استلام على أمر مفتوح يملأ المورد والباقي ويُرفع stock_receipt@2، ثم «حوّل إلى مستند شراء»", async ({
    page,
  }, info) => {
    await seed(page, "manager");
    await page.route(/\/api\/inventory\/purchasing\/orders(\?.*)?$/, (route) =>
      route.fulfill(
        json(200, {
          can_create: true,
          orders: [
            {
              id: "o1",
              number: "12",
              branch_id: "b1",
              supplier_name: "مطاحن سيقا — وكيل",
              items_summary: "سكر أبيض",
              lines: [
                {
                  item_id: "i1",
                  unit_code: "carton",
                  factor_milli: "12000",
                  base_qty_milli: "120000",
                  received_base_qty_milli: "48000",
                },
              ],
            },
          ],
        }),
      ),
    );
    const seen: Record<string, unknown>[] = [];
    await pushRoute(page, seen);
    await page.route("**/api/inventory/receipts/*/document", (route) =>
      route.fulfill(json(200, { document: { id: "d9" } })),
    );
    await page.route("**/api/inventory/purchasing/documents/d9", (route) =>
      route.fulfill(json(403, { detail: "permission_denied" })),
    );
    await login(page, "/inventory/receive");
    const root = page.locator('[data-screen="INV-04"]');
    await expect(root).toContainText(
      "الاستلام يُدخل المخزون فقط. للذمّة حوّله إلى مستند شراء — لا تسجّله مرة ثانية.",
    );
    await expect(root).not.toContainText("واربطه بهذا الاستلام");
    await page.getByLabel("أمر الشراء — اختياري").selectOption("o1");
    await expect(page.getByLabel("المورد")).toHaveValue("مطاحن سيقا — وكيل");
    // الباقي 72 كيساً = 6 كراتين بوحدة الأمر
    await expect(page.getByLabel("الكمية")).toHaveValue("6");
    await page.getByLabel("مرجع المستند").fill("فاتورة 8841");
    await page.getByRole("button", { name: "تسجيل الاستلام" }).click();
    await expectFrame(page, info, {
      screenId: "INV-04",
      state: "success",
      texts: ["استُلمت البضاعة", "حوّل إلى مستند شراء", "استلام آخر"],
    });
    const op = seen.find((o) => (o as { kind: string }).kind === "stock_receipt") as {
      kind: string;
      op_version: number;
      members: { entity: string; schema_version: number; payload: Record<string, unknown> }[];
    };
    expect(op.kind).toBe("stock_receipt");
    expect(op.op_version).toBe(2);
    const head = op.members.find((m) => m.entity === "inventory.GoodsReceipt")!;
    expect(head.schema_version).toBe(2);
    expect(head.payload["purchase_order_id"]).toBe("o1");
    await page.getByRole("button", { name: "حوّل إلى مستند شراء" }).click();
    await expect(page).toHaveURL(/\/purchasing\/documents\/d9$/);
  });
});

test.describe("I-06 — الحجر (INV-13)", () => {
  const body = (over: Record<string, unknown> = {}) => ({
    item_id: "i1",
    item_name: "سكر أبيض",
    branch_id: "b1",
    quarantine_milli: "10000",
    balance_milli: "50000",
    documents: [{ id: "d7", number: "7", supplier_name: "مطاحن سيقا", approved_at: "" }],
    can_release: true,
    can_return: true,
    write_off_cap_minor: "",
    ...over,
  });

  test("ready → validation_error → success: «أعد إلى المتاح» بسبب؛ «أرجع للمورد» يفتح المرتجع من الحجر", async ({
    page,
  }, info) => {
    await seed(page);
    const posted: Record<string, unknown>[] = [];
    await page.route("**/api/inventory/items/i1/quarantine?*", (route) =>
      route.fulfill(json(200, body())),
    );
    await page.route("**/api/inventory/items/i1/quarantine", (route) => {
      if (route.request().method() === "GET") return route.fulfill(json(200, body()));
      posted.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill(
        json(201, {
          damage: { damage_number: "DMG-0004" },
          ...body({ quarantine_milli: "7000", balance_milli: "53000" }),
        }),
      );
    });
    await login(page, "/inventory/items/i1/quarantine");
    await expectFrame(page, info, {
      screenId: "INV-13",
      state: "ready",
      texts: [
        "الحجر — سكر أبيض",
        "التالف المحجور قد يُرتجع للمورد. إهلاكه يُفقد حقّ المطالبة.",
        "في الحجر",
        "10 كيس",
        "المتاح للبيع",
        "أعد إلى المتاح",
        "أرجع للمورد",
        "أهلك",
      ],
    });
    await page.getByLabel("الكمية").first().fill("3");
    await page.getByRole("button", { name: "أعد إلى المتاح" }).click();
    await expectFrame(page, info, {
      screenId: "INV-13",
      state: "validation_error",
      texts: ["السبب — إلزامي"],
    });
    expect(posted).toHaveLength(0);
    await page.getByLabel("السبب — إلزامي").fill("جفّت وسليمة");
    await page.getByRole("button", { name: "أعد إلى المتاح" }).click();
    await expectFrame(page, info, {
      screenId: "INV-13",
      state: "success",
      texts: ["أُعيد إلى المتاح", "7 كيس", "53 كيس"],
    });
    expect(posted[0]).toMatchObject({
      action: "release",
      qty_milli: "3000",
      reason: "جفّت وسليمة",
    });
  });

  test("permission_denied: «أهلك» فوق الحدّ للمالك؛ empty: لا شيء في الحجر", async ({
    page,
  }, info) => {
    await seed(page, "storekeeper");
    let held = "10000";
    await page.route("**/api/inventory/items/i1/quarantine**", (route) => {
      if (route.request().method() === "GET")
        return route.fulfill(
          json(
            200,
            body({ quarantine_milli: held, can_release: false, write_off_cap_minor: "50000" }),
          ),
        );
      return route.fulfill(
        json(403, { detail: "owner_required", cap_minor: "50000", value_minor: "100000" }),
      );
    });
    await login(page, "/inventory/items/i1/quarantine");
    await expect(page.locator('[data-screen="INV-13"]')).toHaveAttribute("data-state", "ready");
    await expect(page.getByRole("button", { name: "أعد إلى المتاح" })).toBeDisabled();
    await page.getByLabel("الكمية").first().fill("10");
    await page.getByLabel("السبب — إلزامي").fill("تعفّن");
    await page.getByRole("button", { name: "أهلك" }).click();
    await expectFrame(page, info, {
      screenId: "INV-13",
      state: "permission_denied",
      texts: ["الهالك بحدٍّ مالي", "500.00", "1,000.00"],
    });
    held = "0";
    await page.route("**/api/auth/resume", (route) =>
      route.fulfill(
        json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
      ),
    );
    await page.goto("/inventory/items/i1/quarantine");
    await expectFrame(page, info, {
      screenId: "INV-13",
      state: "empty",
      texts: ["لا شيء في الحجر", "أرصدة المخزون"],
    });
  });
});

test.describe("I-07 — مصير المرفوض (PUR-04)", () => {
  test("partial: «أعد المرفوض إلى المخزون» بسبب مكتوب، ثم يُعرض القرار بفاعله", async ({
    page,
  }) => {
    await seed(page);
    const ret = (over: Record<string, unknown> = {}) => ({
      id: "ret-1",
      number: "3",
      document_id: "d7",
      document_number: "7",
      supplier_name: "مطاحن سيقا",
      status: "partial",
      status_label: "مقبول جزئياً",
      total_minor: "180000",
      accepted_minor: "90000",
      rejected_minor: "90000",
      supplier_note: "قبل واحدة",
      rejected_destination: "",
      rejected_reason: "",
      rejected_by_name: "",
      lines: [
        {
          id: "rl-1",
          document_line_id: "l1",
          item_name: "سكر أبيض",
          unit_name: "كرتونة",
          qty_milli: "2000",
          unit_price_minor: "90000",
          line_total_minor: "180000",
          reason: "تالف",
          accepted_qty_milli: "1000",
          rejected_qty_milli: "1000",
          from_quarantine: false,
          supplier_note: "",
        },
      ],
      created_by_name: "عثمان",
      created_at: "",
      responded_at: "",
      ...over,
    });
    await page.route("**/api/inventory/purchasing/returns/ret-1", (route) =>
      route.fulfill(json(200, { return: ret() })),
    );
    await page.route("**/api/inventory/purchasing/documents/d7", (route) =>
      route.fulfill(
        json(200, {
          document: { id: "d7", number: "7", status: "approved", lines: [] },
          return_limits: {},
          returns: [],
        }),
      ),
    );
    let sent: Record<string, unknown> | null = null;
    await page.route("**/api/inventory/purchasing/returns/ret-1/rejected", (route) => {
      sent = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill(
        json(200, {
          return: ret({
            rejected_destination: "stock",
            rejected_reason: "سليمة — نبيعها",
            rejected_by_name: "عثمان",
          }),
        }),
      );
    });
    await login(page, "/purchasing/returns/ret-1");
    const root = page.locator('[data-screen="PUR-04"]');
    await expect(root).toHaveAttribute("data-state", "partial");
    await expect(root).toContainText("تحتفظ به أو تتصعّد.");
    await page.getByRole("button", { name: "أعد المرفوض إلى المخزون" }).click();
    expect(sent).toBeNull();
    await page.getByLabel("السبب — إلزامي").fill("سليمة — نبيعها");
    await page.getByRole("button", { name: "أعد المرفوض إلى المخزون" }).click();
    await expect(root).toContainText("أعد المرفوض إلى المخزون · عثمان · سليمة — نبيعها");
    expect(sent).toEqual({ destination: "stock", reason: "سليمة — نبيعها" });
    await expect(page.getByRole("button", { name: "انقله إلى الحجر" })).toHaveCount(0);
  });
});

const sentAt = () => new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
const partialTransfer = (over: Record<string, unknown> = {}) => ({
  id: "t-9",
  transfer_number: "TRF-0009",
  branch_from_id: "b1",
  branch_from_name: "الرئيسي",
  branch_to_id: "b2",
  branch_to_name: "بحري",
  status: "partially_received",
  user_name: "عثمان",
  note: "",
  sent_at: sentAt(),
  received_at: "",
  cancelled_at: "",
  settlement: "",
  settlement_label: "",
  settled_reason: "",
  settled_by_name: "",
  settled_at: "",
  late: true,
  in_transit_milli: "3000",
  in_transit_value_minor: "30000",
  line_count: 1,
  lines: [
    {
      id: "ln-1",
      item_id: "i1",
      item_name: "سكر أبيض",
      unit_name: "كيس",
      factor_milli: "1000",
      qty_milli: "10000",
      base_qty_milli: "10000",
      received_base_milli: "7000",
      settled_base_milli: "0",
      remaining_base_milli: "3000",
      value_minor: "100000",
    },
  ],
  ...over,
});

test.describe("I-08 — الباقي في الطريق", () => {
  test("INV-10: «استلم الباقي» حتى الباقي وحده — 4 من 3 ممنوع، و3 يُرفع بالمُرسل = الباقي", async ({
    page,
  }, info) => {
    await seed(page);
    await page.route("**/api/inventory/transfers/t-9", (route) =>
      route.fulfill(json(200, { transfer: partialTransfer() })),
    );
    const seen: Record<string, unknown>[] = [];
    await pushRoute(page, seen);
    await login(page, "/inventory/transfers/t-9/receive");
    const root = page.locator('[data-screen="INV-10"]');
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(root).toContainText("المتبقّي");
    await expect(page.getByLabel("المستلم فعلياً — سكر أبيض")).toHaveValue("3");
    await page.getByRole("button", { name: "زيادة — سكر أبيض" }).click();
    await expectFrame(page, info, {
      screenId: "INV-10",
      state: "validation_error",
      texts: ["استلام يتجاوز الباقي", "عدُّ", "والباقي"],
    });
    await page.getByRole("button", { name: "نقص — سكر أبيض" }).click();
    await page.getByRole("button", { name: "تأكيد استلام 3" }).click();
    await expect(root).toHaveAttribute("data-state", "success");
    const op = seen[0] as { members: { entity: string; payload: Record<string, unknown> }[] };
    const line = op.members.find((m) => m.entity === "inventory.TransferReceiptLine")!;
    expect(line.payload).toMatchObject({ sent_base_milli: "3000", received_base_milli: "3000" });
  });

  test("INV-08: المالك يقرّر الفرق بسبب — «فُقد في الطريق»؛ لا إلغاء بعد الاستلام الجزئي", async ({
    page,
  }) => {
    await seed(page);
    let current = partialTransfer();
    await page.route(/\/api\/inventory\/transfers(\?.*)?$/, (route) =>
      route.fulfill(
        json(200, {
          branch_id: "b1",
          branches: [],
          can_send: true,
          awaiting_count: 1,
          partial_count: 1,
          transfers: [current],
          as_of: new Date().toISOString(),
        }),
      ),
    );
    let sent: Record<string, unknown> | null = null;
    await page.route("**/api/inventory/transfers/t-9/settle", (route) => {
      sent = route.request().postDataJSON() as Record<string, unknown>;
      current = partialTransfer({
        status: "received",
        settlement: "lost",
        settlement_label: "فُقد في الطريق",
        settled_reason: "سقطت من الشاحنة",
        settled_by_name: "عثمان",
        late: false,
        in_transit_milli: "0",
      });
      return route.fulfill(json(200, { transfer: current }));
    });
    await login(page, "/inventory/transfers?id=t-9");
    const root = page.locator('[data-screen="INV-08"]');
    await expect(root).toContainText("استلم الباقي");
    await expect(page.getByRole("button", { name: /إلغاء التحويل/ })).toHaveCount(0);
    await page.getByRole("button", { name: "فُقد في الطريق" }).click();
    expect(sent).toBeNull();
    await page.getByLabel("السبب — إلزامي").fill("سقطت من الشاحنة");
    await page.getByRole("button", { name: "فُقد في الطريق" }).click();
    await expect(root).toContainText("فُقد في الطريق · عثمان · سقطت من الشاحنة");
    expect(sent).toEqual({ outcome: "lost", reason: "سقطت من الشاحنة" });
    await expect(page.getByRole("button", { name: "يعود للمرسل" })).toHaveCount(0);
  });
});

test.describe("I-10 — جلسات الجرد (INV-14)", () => {
  test("ready: الجلسة المغلقة «جرد ينتظر التسوية» وتفتح مراجعة الفروق؛ empty", async ({
    page,
  }, info) => {
    await seed(page);
    let sessions: unknown[] = [
      {
        id: "cs-1",
        session_number: "CNT-KRT-A2-26-000003",
        status: "closed",
        user_name: "هبة",
        counted_items: 12,
        total_items: 54,
        closed_at: new Date().toISOString(),
      },
      {
        id: "cs-0",
        session_number: "CNT-KRT-A2-26-000002",
        status: "adjusted",
        user_name: "هبة",
        counted_items: 54,
        total_items: 54,
        closed_at: new Date().toISOString(),
      },
    ];
    await page.route(/\/api\/inventory\/count-sessions(\?.*)?$/, (route) =>
      route.fulfill(json(200, { branch_id: "b1", can_adjust: true, sessions })),
    );
    // مراجعة الفروق نفسها خارج هذا الاختبار: الطلب يبقى معلّقاً فلا تُعاد التوجيه
    await page.route("**/api/inventory/count-sessions/cs-1", () => undefined);
    await login(page, "/inventory/count/sessions");
    await expectFrame(page, info, {
      screenId: "INV-14",
      state: "ready",
      texts: ["جلسات الجرد", "CNT-KRT-A2-26-000003", "12 من 54", "جرد ينتظر التسوية", "سُوّيت"],
    });
    await page.getByRole("button", { name: "CNT-KRT-A2-26-000003" }).first().click();
    await expect(page).toHaveURL(/\/inventory\/count\/cs-1\/review$/);
    sessions = [];
    await page.route("**/api/auth/resume", (route) =>
      route.fulfill(
        json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
      ),
    );
    await page.goto("/inventory/count/sessions");
    await expectFrame(page, info, {
      screenId: "INV-14",
      state: "empty",
      texts: ["لا جلسات جرد", "جلسة جرد"],
    });
  });
});

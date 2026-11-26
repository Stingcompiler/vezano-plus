import { expect, type Page, test } from "@playwright/test";

import { openSeedPage } from "./seed-page";

/**
 * مراجعة البيع 2026-11-22 — المرحلة ٢ «إيقاف التضليل» (0005 §٢٩٣):
 * - S-03 المعلّقات (POS-13): تعليق باسم، قائمة، استئناف، وحذف بتأكيد — على الجهاز (IndexedDB).
 * - S-04 اعتماد المدير الحاضر برمزه (PIN القفل)، و«طلبات تنتظرك» (APR-01) قبولاً ورفضاً، وشاشة
 *   الكاشير تعرف النتيجة؛ نصّ «أُرسل الطلب…» محذوف.
 * - S-05 «إقفال إداري بعدّ حاضر» في SHIFT-05: ضمن حدّ «إغلاق وردية بعجز» وفوقه.
 * النصوص جديدة تنتظر الاعتماد — تُفحص بـ`toContainText` لا `fromFrame` (0005 §١٦٩).
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const SALT = "AAAAAAAAAAAAAAAAAAAAAA==";

interface SeedOpts {
  readonly cartValue?: string;
  readonly verifiers?: boolean;
  readonly held?: readonly unknown[];
}

/** وردية مفتوحة، وسلة فيها شاي (240.00)، ومتحققات PIN للفرع: الكاشير والمدير (حدّه 200.00) والمالك. */
async function seed(page: Page, o: SeedOpts = {}) {
  await openSeedPage(page);
  await page.evaluate(
    async ({ openedAt, salt, withVerifiers, held, price }) => {
      async function encoded(pin: string): Promise<string> {
        const key = await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(pin),
          "PBKDF2",
          false,
          ["deriveBits"],
        );
        const bits = new Uint8Array(
          await crypto.subtle.deriveBits(
            {
              name: "PBKDF2",
              hash: "SHA-256",
              salt: Uint8Array.from(atob(salt), (c) => c.charCodeAt(0)),
              iterations: 1000,
            },
            key,
            256,
          ),
        );
        return `pbkdf2_sha256$1000$${salt}$${btoa(String.fromCharCode(...bits))}`;
      }
      const lim = (m: string) => ({ value: "limit", limit_minor: m, period: "per_op" });
      const verifiers = withVerifiers
        ? [
            {
              user_id: "u1",
              display_name: "سميرة ع.",
              role_name: "كاشير",
              branch_name: "الفرع الرئيسي",
              encoded: await encoded("333333"),
              version: 1,
              role_code: "cashier",
              is_owner: false,
              permissions: { discount: lim("1000") },
            },
            {
              user_id: "u-manager",
              display_name: "عمر",
              role_name: "مدير فرع",
              branch_name: "الفرع الرئيسي",
              encoded: await encoded("222222"),
              version: 4,
              role_code: "manager",
              is_owner: false,
              permissions: { discount: lim("20000") },
            },
            {
              user_id: "u-owner",
              display_name: "ندى",
              role_name: "مالك",
              branch_name: "الفرع الرئيسي",
              encoded: await encoded("111111"),
              version: 2,
              role_code: "owner",
              is_owner: true,
            },
          ]
        : [];
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      await new Promise<void>((res) => {
        const tx = db.transaction(["meta", "projections"], "readwrite");
        const meta = tx.objectStore("meta");
        meta.put({
          key: "device.registration",
          value: JSON.stringify({ deviceId: "d1", prefix: "A2", branchId: "b1" }),
        });
        meta.put({ key: "sync_epoch", value: "epoch-A" });
        meta.put({
          key: "shift.context",
          value: JSON.stringify({
            branchId: "b1",
            branchName: "الفرع الرئيسي",
            deviceId: "d1",
            deviceName: "كاشير 2",
            userId: "u1",
            userName: "سميرة ع.",
            roleName: "كاشير",
            roleCode: "cashier",
            canWithdraw: false,
            ownerName: "ندى",
            discountCaps: {
              per_op_minor: "1000",
              daily_minor: "5000",
              percent: 10,
              used_today_minor: "0",
            },
          }),
        });
        meta.put({
          key: "pos.cart",
          value: JSON.stringify({
            lines: [
              {
                id: "l1",
                item_id: "i2",
                item_name: "شاي أسود 250غ",
                unit_id: "u-pack",
                unit_code: "عبوة",
                unit_name: "عبوة",
                factor_milli: "1000",
                decimal_places: 0,
                qty_milli: "1000",
                unit_price_minor: price,
              },
            ],
            updated_at: openedAt,
          }),
        });
        if (held.length) meta.put({ key: "pos.held", value: JSON.stringify(held) });
        if (verifiers.length)
          meta.put({
            key: "pin.verifiers",
            value: JSON.stringify({
              device_id: "d1",
              prefix: "A2",
              branch_name: "الفرع الرئيسي",
              pin_length: 6,
              fetched_at: openedAt,
              verifiers,
            }),
          });
        meta.put({
          key: "shift.open",
          value: JSON.stringify({ shift_id: "s1", opened_at: openedAt }),
        });
        tx.objectStore("projections").put({
          key: "entity:shifts.Shift:s1",
          value: {
            id: "s1",
            number: "OPEN-0091",
            branch_id: "b1",
            branch_name: "الفرع الرئيسي",
            device_id: "d1",
            device_name: "كاشير 2",
            user_id: "u1",
            user_name: "سميرة ع.",
            opening_float_minor: "1840000",
            business_date: openedAt.slice(0, 10),
            opened_at: openedAt,
            state: "open",
            closed_at: "",
            operation_id: "op-open-1",
          },
        });
        tx.oncomplete = () => res();
      });
      db.close();
    },
    {
      openedAt: new Date().toISOString(),
      salt: SALT,
      withVerifiers: o.verifiers ?? true,
      held: o.held ?? [],
      price: o.cartValue ?? "24000",
    },
  );
}

async function login(page: Page, next: string) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.route("**/api/catalog/balances**", (route) =>
    route.fulfill(json(200, { branch_id: "b1", as_of: new Date().toISOString(), balances: [] })),
  );
  await page.route("**/api/devices/verifiers", (route) => route.fulfill(json(403, {})));
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("cashier@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, (c) => `\\${c}`)}$`));
}

interface PushedOp {
  readonly kind: string;
  readonly members: { readonly payload: Record<string, unknown> }[];
}

function acceptPush(page: Page, seen: PushedOp[]) {
  return page.route("**/api/sync/push", (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      operations: (PushedOp & { operation_id: string })[];
      request_id: string;
    };
    seen.push(...body.operations);
    return route.fulfill(
      json(200, {
        protocol_version: 1,
        sync_epoch: "epoch-A",
        request_id: body.request_id,
        results: body.operations.map((op) => ({
          operation_id: op.operation_id,
          status: "accepted",
          member_receipts: [],
        })),
        server_seq_high: "9",
      }),
    );
  });
}

async function readMeta(page: Page, key: string): Promise<string | null> {
  return page.evaluate(async (k) => {
    const req = indexedDB.open("sting-bootstrap");
    const db = await new Promise<IDBDatabase>((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(new Error(String(req.error)));
    });
    const row = await new Promise<{ value: string } | undefined>((res) => {
      const r = db.transaction("meta").objectStore("meta").get(k);
      r.onsuccess = () => res(r.result as { value: string } | undefined);
    });
    db.close();
    return row?.value ?? null;
  }, key);
}

// ─── S-03 المعلّقات ─────────────────────────────────────────────────────────

test.describe("POS-13 المعلّقات", () => {
  test("تعليق باسم ثم القائمة ثم استئناف يعيد السلة، وحذف بتأكيد", async ({ page }) => {
    await seed(page);
    await login(page, "/pos");
    const pos = page.locator('[data-screen="POS-01"]');
    await expect(pos).toContainText("شاي أسود 250غ");
    await page.getByLabel("اسم أو ملاحظة (اختياري)").fill("أحمد يجلب صنفاً");
    await page.getByRole("button", { name: "تعليق الفاتورة" }).click();
    await expect(pos).toContainText("في المعلّقات");
    await page
      .getByRole("button", { name: /^المعلّقات/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/pos\/held$/);
    const held = page.locator('[data-screen="POS-13"]');
    await expect(held).toHaveAttribute("data-state", "ready");
    await expect(held).toContainText("أحمد يجلب صنفاً");
    await expect(held).toContainText("240.00");
    await held.getByRole("button", { name: "استئناف" }).click();
    await expect(page).toHaveURL(/\/pos$/);
    await expect(pos).toContainText("شاي أسود 250غ");
    expect(await readMeta(page, "pos.held")).toBe("[]");

    // علّق مرة أخرى ثم احذف بتأكيد
    await page.getByRole("button", { name: "تعليق الفاتورة" }).click();
    await page
      .getByRole("button", { name: /^المعلّقات/ })
      .first()
      .click();
    await held.getByRole("button", { name: "حذف المعلّقة" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("تُحذف من هذا الجهاز ولا تعود.");
    await dialog.getByRole("button", { name: "حذف المعلّقة" }).click();
    await expect(held).toHaveAttribute("data-state", "empty");
    await expect(held).toContainText("لا فواتير معلّقة على هذا الجهاز.");
  });

  test("لا تُستأنف فوق سلة غير فارغة", async ({ page }) => {
    await seed(page, {
      held: [
        {
          id: "h1",
          label: "طاولة 3",
          held_at: new Date().toISOString(),
          lines: [
            {
              id: "l9",
              item_id: "i9",
              item_name: "سكر",
              unit_id: "u",
              unit_code: "كجم",
              unit_name: "كجم",
              factor_milli: "1000",
              decimal_places: 0,
              qty_milli: "1000",
              unit_price_minor: "300000",
            },
          ],
        },
      ],
    });
    await login(page, "/pos/held");
    const held = page.locator('[data-screen="POS-13"]');
    await held.getByRole("button", { name: "استئناف" }).click();
    await expect(held).toContainText("السلة ليست فارغة");
    await expect(held).toContainText("طاولة 3");
  });
});

// ─── S-04 اعتماد المدير الحاضر و«طلبات تنتظرك» ──────────────────────────────

async function overCap(page: Page, amount: string) {
  await page.getByLabel("قيمة الخصم").fill(amount);
  await page.getByLabel("السبب — إلزامي").fill("زبون دائم");
  await page.getByRole("button", { name: "تطبيق الخصم" }).click();
  await expect(page.locator('[data-screen="POS-03"]')).toHaveAttribute(
    "data-state",
    "permission_denied",
  );
}

test.describe("POS-03 اعتماد برمز", () => {
  test("ضمن الحدّ: المدير يكتب رمزه فيدخل الخصم السلة باسمه ويُرفع معتمداً", async ({ page }) => {
    const seen: PushedOp[] = [];
    await acceptPush(page, seen);
    await seed(page);
    await login(page, "/pos/discount");
    await overCap(page, "150.00");
    await page.getByRole("button", { name: "اعتماد مدير حاضر" }).click();
    await expect(page.getByRole("region", { name: "اعتماد مدير حاضر" })).toContainText(
      "يكتب المدير أو المالك رمزه هنا. يُسجَّل الاعتماد باسمه.",
    );
    await page.getByLabel("رمز المعتمد").fill("222222");
    await page.getByRole("button", { name: "اعتمد", exact: true }).click();
    await expect(page).toHaveURL(/\/pos$/);
    const cart = JSON.parse((await readMeta(page, "pos.cart")) ?? "{}") as {
      discount?: { value: string; approval?: { approved_by_name: string; via: string } };
    };
    expect(cart.discount?.value).toBe("15000");
    expect(cart.discount?.approval).toMatchObject({ approved_by_name: "عمر", via: "pin" });
    await expect.poll(() => seen.length).toBeGreaterThan(0);
    const op = seen.find((o) => o.kind === "discount_override");
    expect(op?.members[0]?.payload).toMatchObject({
      approval_method: "pin",
      approved_by_user_id: "u-manager",
      verifier_version: "4",
      discount_minor: "15000",
    });
  });

  test("فوق الحدّ ورمز خاطئ: لا يُعتمد ولا يدخل الخصم", async ({ page }) => {
    await seed(page);
    await login(page, "/pos/discount");
    await overCap(page, "230.00");
    await page.getByRole("button", { name: "اعتماد مدير حاضر" }).click();
    const panel = page.getByRole("region", { name: "اعتماد مدير حاضر" });
    await page.getByLabel("رمز المعتمد").fill("222222");
    await page.getByRole("button", { name: "اعتمد", exact: true }).click();
    await expect(panel).toContainText("فوق صلاحية صاحب الرمز");
    await expect(panel).toContainText("حدّ عمر");
    await expect(panel).toContainText("200.00");
    await page.getByLabel("رمز المعتمد").fill("999999");
    await page.getByRole("button", { name: "اعتمد", exact: true }).click();
    await expect(panel).toContainText("محاولة خاطئة");
    await page.getByLabel("رمز المعتمد").fill("333333");
    await page.getByRole("button", { name: "اعتمد", exact: true }).click();
    await expect(panel).toContainText("لا تعتمد طلبك");
    const cart = JSON.parse((await readMeta(page, "pos.cart")) ?? "{}") as { discount?: unknown };
    expect(cart.discount).toBeUndefined();
  });

  test("بلا معتمد حاضر: الطلب إلى «طلبات تنتظرك» ثم يعرف الكاشير الموافقة ويطبّق الخصم", async ({
    page,
  }) => {
    const seen: PushedOp[] = [];
    await acceptPush(page, seen);
    let decided = false;
    await page.route(/\/api\/approvals\/discount\/[^/]+$/, (route) => {
      const id = route.request().url().split("/").pop() ?? "";
      return route.fulfill(
        json(200, {
          item: {
            id,
            kind: "discount",
            status: decided ? "approved" : "pending",
            amount_minor: "15000",
            reason: "زبون دائم",
            requested_by_name: "سميرة ع.",
            requested_at: new Date().toISOString(),
            branch_id: "b1",
            branch_name: "الفرع الرئيسي",
            decided_by_user_id: decided ? "u-owner" : "",
            decided_by_name: decided ? "ندى" : "",
            decided_at: "",
            decision_reason: "",
            approved_via: decided ? "inbox" : "",
          },
        }),
      );
    });
    await seed(page);
    await login(page, "/pos/discount");
    await overCap(page, "150.00");
    await page.getByRole("button", { name: "طلب اعتماد من مدير الفرع" }).click();
    const root = page.locator('[data-screen="POS-03"]');
    await expect(root).toContainText("الطلب في «طلبات تنتظرك». يظهر القرار هنا.");
    await expect(root).not.toContainText("أُرسل الطلب");
    decided = true;
    await expect(root).toContainText("وافق ندى.", { timeout: 15_000 });
    await page.getByRole("button", { name: "طبّق الخصم المعتمد" }).click();
    await expect(page).toHaveURL(/\/pos$/);
    const cart = JSON.parse((await readMeta(page, "pos.cart")) ?? "{}") as {
      discount?: { value: string; approval?: { via: string } };
    };
    expect(cart.discount).toMatchObject({ value: "15000", approval: { via: "inbox" } });
  });
});

test.describe("SHIFT-03 السحب بإذن المالك", () => {
  async function shiftCurrent(page: Page) {
    await page.route("**/api/shifts/current**", (route) =>
      route.fulfill(
        json(200, {
          branch_id: "b1",
          branch_name: "الفرع الرئيسي",
          user_name: "سميرة ع.",
          role_name: "كاشير",
          can_withdraw: false,
          owner_name: "ندى",
          role_code: "cashier",
          current: null,
          others_open: [],
          previous: null,
        }),
      ),
    );
  }

  test("برمز المالك الحاضر: السحب يُسجَّل باسمه ويُرفع معتمداً؛ رمز المدير لا يكفي", async ({
    page,
  }) => {
    const seen: PushedOp[] = [];
    await acceptPush(page, seen);
    await shiftCurrent(page);
    await seed(page);
    await login(page, "/shifts/movements");
    // «سحب» معطّل للكاشير ظاهرٌ بسببه — النقر يفتح المنع ومخرجيه (كما في shifts-cash)
    await page.getByRole("button", { name: "سحب", exact: true }).dispatchEvent("click");
    const root = page.locator('[data-screen="SHIFT-03"]');
    await expect(root).toHaveAttribute("data-state", "permission_denied");
    await expect(root).not.toContainText("أُرسل الطلب");
    await page.getByLabel("المبلغ").fill("500.00");
    await page.getByLabel("السبب").fill("توريد للخزنة الرئيسية");
    await page.getByRole("button", { name: "اعتماد المالك بالرمز" }).click();
    await page.getByLabel("رمز المعتمد").fill("222222");
    await page.getByRole("button", { name: "اعتمد", exact: true }).click();
    await expect(page.getByRole("region", { name: "اعتماد المالك" })).toContainText(
      "فوق صلاحية صاحب الرمز",
    );
    await page.getByLabel("رمز المعتمد").fill("111111");
    await page.getByRole("button", { name: "اعتمد", exact: true }).click();
    await expect(root).toHaveAttribute("data-state", "success");
    await expect.poll(() => seen.filter((o) => o.kind === "cash_movement").length).toBe(1);
    const payload = seen.find((o) => o.kind === "cash_movement")?.members[0]?.payload;
    expect(payload).toMatchObject({
      kind: "withdrawal",
      signed_amount_minor: "-50000",
      authorized_by_user_id: "u-owner",
      approval_method: "pin",
      verifier_version: "2",
    });
  });

  test("بلا مالك حاضر: الطلب يقول الحقيقة ثم يُسجَّل السحب المعتمد بالطلب نفسه", async ({
    page,
  }) => {
    const seen: PushedOp[] = [];
    await acceptPush(page, seen);
    await shiftCurrent(page);
    await page.route("**/api/shifts/s1/requests", (route) =>
      route.fulfill(
        json(201, {
          id: "req-1",
          shift_id: "s1",
          kind: "withdrawal",
          amount_minor: "50000",
          reason: "توريد للخزنة الرئيسية",
          status: "pending",
          requested_by_name: "سميرة ع.",
          owner_name: "ندى",
        }),
      ),
    );
    await page.route("**/api/approvals/withdrawal/req-1", (route) =>
      route.fulfill(
        json(200, {
          item: {
            id: "req-1",
            kind: "withdrawal",
            status: "approved",
            amount_minor: "50000",
            reason: "توريد للخزنة الرئيسية",
            requested_by_name: "سميرة ع.",
            requested_at: new Date().toISOString(),
            branch_id: "b1",
            branch_name: "الفرع الرئيسي",
            decided_by_user_id: "u-owner",
            decided_by_name: "ندى",
            decided_at: new Date().toISOString(),
            decision_reason: "",
            approved_via: "inbox",
          },
        }),
      ),
    );
    await seed(page);
    await login(page, "/shifts/movements");
    // «سحب» معطّل للكاشير ظاهرٌ بسببه — النقر يفتح المنع ومخرجيه (كما في shifts-cash)
    await page.getByRole("button", { name: "سحب", exact: true }).dispatchEvent("click");
    await page.getByLabel("المبلغ").fill("500.00");
    await page.getByLabel("السبب").fill("توريد للخزنة الرئيسية");
    await page.getByRole("button", { name: "اطلب من ندى" }).click();
    const root = page.locator('[data-screen="SHIFT-03"]');
    await expect(root).toContainText("وافق ندى.");
    await page.getByRole("button", { name: "سجّل السحب المعتمد" }).click();
    await expect(root).toHaveAttribute("data-state", "success");
    await expect.poll(() => seen.filter((o) => o.kind === "cash_movement").length).toBe(1);
    expect(seen.find((o) => o.kind === "cash_movement")?.members[0]?.payload).toMatchObject({
      authorized_by_user_id: "u-owner",
      approval_request_id: "req-1",
      signed_amount_minor: "-50000",
    });
  });
});

// ─── APR-01 «طلبات تنتظرك» ──────────────────────────────────────────────────

function item(over: { readonly id: string } & Record<string, unknown>) {
  return {
    status: "pending",
    reason: "زبون دائم",
    requested_by_name: "سالم",
    requested_at: new Date().toISOString(),
    branch_id: "b1",
    branch_name: "الفرع الرئيسي",
    decided_by_user_id: "",
    decided_by_name: "",
    decided_at: "",
    decision_reason: "",
    approved_via: "",
    can_decide: true,
    ...over,
  };
}

test.describe("APR-01 طلبات تنتظرك", () => {
  test("قبول ورفض بسبب — الرفض بلا سبب لا يُرسل", async ({ page }) => {
    const posted: { url: string; body: { decision: string; reason: string } }[] = [];
    let items = [
      item({ id: "w1", kind: "withdrawal", amount_minor: "50000", reason: "توريد للخزنة" }),
      item({ id: "d1", kind: "discount", amount_minor: "30000" }),
      item({
        id: "c1",
        kind: "credit",
        amount_minor: "120000",
        party_name: "أحمد",
        can_decide: false,
      }),
    ];
    await page.route("**/api/approvals", (route) =>
      route.fulfill(
        json(200, {
          can_review: true,
          scope: "all",
          role_name: "مالك",
          branch_name: "",
          items,
        }),
      ),
    );
    await page.route(/\/api\/approvals\/\w+\/\w+\/decide$/, (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        decision: string;
        reason: string;
      };
      posted.push({ url: route.request().url(), body });
      const id = route.request().url().split("/").slice(-2)[0];
      const done = items.find((i) => i.id === id)!;
      items = items.filter((i) => i.id !== id);
      return route.fulfill(
        json(200, {
          item: {
            ...done,
            status: body.decision === "accept" ? "approved" : "rejected",
            decided_by_name: "ندى",
          },
        }),
      );
    });
    await seed(page, { verifiers: false });
    await login(page, "/approvals");
    const root = page.locator('[data-screen="APR-01"]');
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(root).toContainText("طلب سحب 500.00 من سالم");
    await expect(root).toContainText("خصم فوق السقف 300.00 من سالم");
    await expect(root).toContainText("فوق حدّك — يقرّره المالك.");
    const withdrawal = root.locator("li", { hasText: "طلب سحب" });
    await withdrawal.getByRole("button", { name: "وافق" }).click();
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]?.body.decision).toBe("accept");
    expect(posted[0]?.url).toContain("/api/approvals/withdrawal/w1/decide");
    const discount = root.locator("li", { hasText: "خصم فوق السقف" });
    await discount.getByRole("button", { name: "ارفض" }).click();
    await expect(discount).toContainText("اكتب سبب الرفض.");
    expect(posted.length).toBe(1);
    await discount.getByLabel("السبب — إلزامي للرفض").fill("الخصم أكبر من الهامش");
    await discount.getByRole("button", { name: "ارفض" }).click();
    await expect.poll(() => posted.length).toBe(2);
    expect(posted[1]?.body).toEqual({ decision: "reject", reason: "الخصم أكبر من الهامش" });
    await expect(root).toContainText("رفضتَ");
  });

  test("permission_denied للكاشير", async ({ page }) => {
    const canReview = false;
    await page.route("**/api/approvals", (route) =>
      route.fulfill(
        json(200, {
          can_review: canReview,
          scope: "branch",
          role_name: "كاشير",
          branch_name: "الفرع الرئيسي",
          items: [],
        }),
      ),
    );
    await seed(page, { verifiers: false });
    await login(page, "/approvals");
    const root = page.locator('[data-screen="APR-01"]');
    await expect(root).toHaveAttribute("data-state", "permission_denied");
    await expect(root).toContainText("الطلبات للمالك ومدير الفرع");
  });
});

// ─── S-05 الإقفال الإداري ───────────────────────────────────────────────────

function reviewBody(over: Record<string, unknown> = {}) {
  const opened = new Date(Date.now() - 26 * 3_600_000).toISOString();
  return {
    scope: "branch",
    can_settle: true,
    role_name: "مدير فرع",
    user_name: "عمر",
    branch_name: "الفرع الرئيسي",
    window_days: 7,
    shifts: [
      {
        id: "s-ab",
        branch_id: "b1",
        branch_name: "الفرع الرئيسي",
        device_name: "كاشير 2",
        user_name: "سالم",
        opened_at: opened,
        closed_at: "",
        state: "open",
        count_status: "",
        expected_source: "",
        expected_cash_at_close_minor: "",
        expected_cash_minor: "100000",
        counted_cash_minor: "",
        counted_by_name: "",
        close_kind: "",
        closed_by_name: "",
        close_reason: "",
        variance_minor: "",
        open_hours: 26,
        abandoned: true,
        review: null,
        late_items: [],
        can_settle: true,
        can_admin_close: true,
        close_limit_minor: "30000",
        ...over,
      },
    ],
  };
}

test.describe("SHIFT-05 إقفال إداري بعدّ حاضر", () => {
  test("«افتح الإقفال» يفتح البطاقة؛ فوق الحدّ ممنوع، وضمنه يُقفل باسم من عدّ", async ({
    page,
  }) => {
    let closedBody: { counted_cash_minor: string; reason: string } | null = null;
    await page.route("**/api/shifts/review", (route) => route.fulfill(json(200, reviewBody())));
    await page.route("**/api/shifts/s-ab/admin-close", (route) => {
      closedBody = JSON.parse(route.request().postData() ?? "{}") as {
        counted_cash_minor: string;
        reason: string;
      };
      const row = reviewBody({
        state: "closed",
        closed_at: new Date().toISOString(),
        count_status: "counted",
        expected_source: "server",
        expected_cash_at_close_minor: "100000",
        counted_cash_minor: "80000",
        counted_by_name: "عمر",
        close_kind: "admin",
        closed_by_name: "عمر",
        close_reason: "الجهاز تعطّل",
        variance_minor: "-20000",
        abandoned: false,
        can_admin_close: undefined,
        close_limit_minor: undefined,
      }).shifts[0];
      return route.fulfill(json(200, { row }));
    });
    await seed(page, { verifiers: false });
    await login(page, "/shifts/review?close=s-ab");
    const root = page.locator('[data-screen="SHIFT-05"]');
    const card = page.getByRole("region", { name: "إقفال إداري بعدّ حاضر" });
    await expect(card).toContainText("إقفال إداري بعدّ حاضر");
    await expect(card).toContainText("1,000.00");
    await card.getByLabel("المعدود").fill("600.00");
    await card.getByLabel("السبب").fill("الجهاز تعطّل");
    await expect(card).toContainText("العجز فوق حدّك");
    await expect(card).toContainText("يُقفلها المالك.");
    await expect(card.getByRole("button", { name: "إقفال إداري", exact: true })).toBeDisabled();
    await card.getByLabel("المعدود").fill("800.00");
    await expect(card).not.toContainText("العجز فوق حدّك");
    await card.getByRole("button", { name: "إقفال إداري", exact: true }).click();
    await expect
      .poll(() => closedBody)
      .toEqual({
        counted_cash_minor: "80000",
        reason: "الجهاز تعطّل",
      });
    await expect(root).toContainText("مقفلة بإجراء إداري · عدّه: عمر");
  });
});

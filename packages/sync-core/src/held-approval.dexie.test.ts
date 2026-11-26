import "fake-indexeddb/auto";
import { DexieStorage } from "@sting/platform/dexie";
import { describe, expect, it } from "vitest";

import { attemptApproval, type ApprovalRequest } from "./approval";
import { PIN_LOCK_POLICY, storeVerifiers } from "./pin";
import {
  type CartDraftLine,
  discardHeldCart,
  HELD_META,
  holdCart,
  readCartDraft,
  readHeldCarts,
  resumeHeldCart,
  writeCartDraft,
} from "./pos-local";

const line: CartDraftLine = {
  id: "l1",
  item_id: "i1",
  item_name: "شاي",
  unit_id: "u1",
  unit_code: "PCS",
  unit_name: "حبة",
  factor_milli: "1000",
  decimal_places: 0,
  qty_milli: "2000",
  unit_price_minor: "15000",
};
const db = () => new DexieStorage({ databaseName: `held-${Math.random()}` });

/** S-03 (0005 §٢٩٣): المعلّقات على الجهاز تحت Dexie — كل await على المعاملة مباشرةً. */
describe("المعلّقات: تعليق ثم قائمة ثم استئناف أو حذف", () => {
  it("التعليق يحفظ السلة بخصمها وعميلها واسمها، والاستئناف يعيدها ويُخرجها من القائمة", async () => {
    const s = db();
    const discount = { mode: "amount" as const, value: "800", reason: "عميل دائم" };
    const customer = { id: "p1", name: "أحمد" };
    expect(
      await holdCart(
        s,
        { lines: [line], discount, customer },
        { label: " أحمد — يجلب صنفاً ", now: "2026-11-26T09:00:00Z", id: "h1" },
      ),
    ).toBe(1);
    expect((await readCartDraft(s)).lines).toEqual([]);
    await holdCart(s, { lines: [line] }, { now: "2026-11-26T09:30:00Z", id: "h2" });
    const held = await readHeldCarts(s);
    expect(held.map((h) => h.id)).toEqual(["h2", "h1"]); // الأحدث أولاً
    expect(held[1]).toMatchObject({ label: "أحمد — يجلب صنفاً", discount, customer });

    const out = await resumeHeldCart(s, "h1", "2026-11-26T10:00:00Z");
    expect(out.ok).toBe(true);
    const cart = await readCartDraft(s);
    expect(cart.lines).toEqual([line]);
    expect(cart.discount).toEqual(discount);
    expect(cart.customer).toEqual(customer);
    expect((await readHeldCarts(s)).map((h) => h.id)).toEqual(["h2"]);
  });

  it("لا تُستأنف معلّقة فوق سلة غير فارغة، والحذف يُخرجها بلا أثر", async () => {
    const s = db();
    await holdCart(s, { lines: [line] }, { id: "h1", now: "2026-11-26T09:00:00Z" });
    await writeCartDraft(s, { lines: [line] });
    expect(await resumeHeldCart(s, "h1")).toEqual({ ok: false, reason: "cart_not_empty" });
    expect(await resumeHeldCart(s, "nope")).toEqual({ ok: false, reason: "not_found" });
    expect(await discardHeldCart(s, "h1")).toBe(true);
    expect(await discardHeldCart(s, "h1")).toBe(false);
    expect(await readHeldCarts(s)).toEqual([]);
    expect((await readCartDraft(s)).lines).toEqual([line]);
  });

  it("معلّقات الإصدار السابق (سطور ووقت فقط) تُقرأ وتُستأنف", async () => {
    const s = db();
    await s.transaction((tx) =>
      tx.putMeta(HELD_META, JSON.stringify([{ lines: [line], held_at: "2026-11-20T08:00:00Z" }])),
    );
    const [old] = await readHeldCarts(s);
    expect(old).toMatchObject({ label: "", held_at: "2026-11-20T08:00:00Z" });
    expect((await resumeHeldCart(s, old!.id)).ok).toBe(true);
    expect((await readCartDraft(s)).lines).toEqual([line]);
  });
});

// ─── اعتماد المدير الحاضر برمزه (S-04) ─────────────────────────────────────

const SALT = "AAAAAAAAAAAAAAAAAAAAAA==";

async function encoded(pin: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const salt = Uint8Array.from(atob(SALT), (c) => c.charCodeAt(0));
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: 1000 },
      key,
      256,
    ),
  );
  return `pbkdf2_sha256$1000$${SALT}$${btoa(String.fromCharCode(...bits))}`;
}

const lim = (minor: string) => ({ value: "limit", limit_minor: minor, period: "per_op" });
const cell = (value: string) => ({ value, limit_minor: null, period: "" });

async function branchDevice() {
  const s = db();
  await storeVerifiers(s, {
    device_id: "d1",
    prefix: "A1",
    branch_name: "الرئيسي",
    pin_length: 6,
    fetched_at: "2026-11-26T08:00:00Z",
    verifiers: [
      {
        user_id: "cashier",
        display_name: "سالم",
        role_name: "كاشير",
        branch_name: "الرئيسي",
        encoded: await encoded("333333"),
        version: 1,
        role_code: "cashier",
        is_owner: false,
        permissions: { discount: lim("1000"), view_receivables: cell("own_customer") },
      },
      {
        user_id: "manager",
        display_name: "عمر",
        role_name: "مدير فرع",
        branch_name: "الرئيسي",
        encoded: await encoded("222222"),
        version: 3,
        role_code: "manager",
        is_owner: false,
        permissions: { discount: lim("20000"), view_receivables: cell("branch") },
      },
      {
        user_id: "owner",
        display_name: "ندى",
        role_name: "مالك",
        branch_name: "الرئيسي",
        encoded: await encoded("111111"),
        version: 1,
        role_code: "owner",
        is_owner: true,
      },
    ],
  });
  return s;
}

const discount = (minor: bigint): ApprovalRequest => ({
  kind: "discount",
  amountMinor: minor,
  branchId: "b1",
  requesterId: "cashier",
});

describe("اعتماد برمز عند الصندوق — الحدّ من خلايا صاحب الرمز", () => {
  it("ضمن الحدّ: المدير يعتمد خصم 150.00 ويُعرف إصدار متحققه", async () => {
    const s = await branchDevice();
    const out = await attemptApproval(s, "222222", discount(15000n));
    expect(out.kind).toBe("approved");
    if (out.kind === "approved")
      expect(out.approver).toMatchObject({ user_id: "manager", version: 3 });
  });

  it("فوق الحدّ: خصم 300.00 فوق حدّ المدير (200.00) — يُعرف صاحبه وحدّه ولا يُعتمد", async () => {
    const s = await branchDevice();
    const out = await attemptApproval(s, "222222", discount(30000n));
    expect(out).toMatchObject({ kind: "not_allowed", reason: "over_limit", limitMinor: 20000n });
    expect((await attemptApproval(s, "111111", discount(30000n))).kind).toBe("approved");
  });

  it("رمز خاطئ يُعدّ في عدّاد القفل نفسه، والخامس يقفل", async () => {
    const s = await branchDevice();
    const first = await attemptApproval(s, "999999", discount(100n));
    expect(first).toEqual({ kind: "wrong", failed: 1, maxAttempts: PIN_LOCK_POLICY.maxAttempts });
    for (let i = 2; i < PIN_LOCK_POLICY.maxAttempts; i++)
      await attemptApproval(s, "999999", discount(100n));
    expect((await attemptApproval(s, "999999", discount(100n))).kind).toBe("locked");
    expect((await attemptApproval(s, "222222", discount(100n))).kind).toBe("locked");
  });

  it("الطالب لا يعتمد طلبه، والسحب للمالك وحده، وتجاوز الائتمان بخلية الذمم", async () => {
    const s = await branchDevice();
    expect(await attemptApproval(s, "333333", discount(100n))).toMatchObject({
      kind: "not_allowed",
      reason: "self",
    });
    const withdrawal: ApprovalRequest = { ...discount(50000n), kind: "withdrawal" };
    expect(await attemptApproval(s, "222222", withdrawal)).toMatchObject({
      kind: "not_allowed",
      reason: "role_forbidden",
    });
    expect((await attemptApproval(s, "111111", withdrawal)).kind).toBe("approved");
    const credit: ApprovalRequest = { ...discount(120000n), kind: "credit" };
    expect((await attemptApproval(s, "222222", credit)).kind).toBe("approved");
  });
});

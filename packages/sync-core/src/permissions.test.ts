import { describe, expect, it } from "vitest";

import { checkDiscount } from "./pos-local";
import { decideCell, decidePermission, type RoleRules } from "./permissions";

const cell = (value: string, limit: string | null = null) => ({
  value,
  limit_minor: limit,
  period: limit ? "per_op" : "",
});

describe("decidePermission — نظير core.permissions في الخادم (0005 §٢٩٢)", () => {
  it("المالك مسموح دائماً ولو قالت الخلايا «لا»", () => {
    const rules: RoleRules = { sell: cell("no"), refund: cell("no") };
    expect(decidePermission(rules, "owner", "sell").allowed).toBe(true);
    expect(decidePermission(rules, "owner", "refund", { amountMinor: 10n ** 9n }).allowed).toBe(
      true,
    );
  });

  it("خلية الخادم تقرّر: «لا» تمنع و«نعم» تسمح", () => {
    expect(decidePermission({ sell: cell("no") }, "cashier", "sell")).toMatchObject({
      allowed: false,
      reason: "role_forbidden",
    });
    expect(decidePermission({ sell: cell("yes") }, "storekeeper", "sell").allowed).toBe(true);
  });

  it("الحدّ المالي: حتى الحدّ مسموح، وفوقه over_limit", () => {
    const rules: RoleRules = { refund: cell("limit", "50000") };
    expect(decidePermission(rules, "cashier", "refund", { amountMinor: 50000n }).allowed).toBe(
      true,
    );
    expect(decidePermission(rules, "cashier", "refund", { amountMinor: 50001n })).toMatchObject({
      allowed: false,
      reason: "over_limit",
      limitMinor: 50000n,
    });
  });

  it("«نقداً فقط» تمنع التحويل ولا تُعدّ «نعم» (لا ردّ)", () => {
    const rules: RoleRules = { record_payment: cell("cash_only") };
    expect(decidePermission(rules, "cashier", "record_payment", { method: "cash" }).allowed).toBe(
      true,
    );
    expect(decidePermission(rules, "cashier", "record_payment", { method: "bank" }).reason).toBe(
      "cash_only",
    );
    expect(decidePermission(rules, "cashier", "record_payment").unrestricted).toBe(false);
  });

  it("«فرعه» في فرعه فقط؛ «اقتراح فقط» و«عميل البيع فقط» لا يعتمدان", () => {
    const branch = cell("branch");
    expect(decideCell("stock_adjust", branch, { branchId: "a", ownBranchId: "a" }).allowed).toBe(
      true,
    );
    expect(decideCell("stock_adjust", branch, { branchId: "b", ownBranchId: "a" }).reason).toBe(
      "other_branch",
    );
    expect(decideCell("stock_adjust", cell("propose")).reason).toBe("propose_only");
    expect(decideCell("view_receivables", cell("own_customer")).reason).toBe("own_customer_only");
  });

  it("سياق قديم بلا خلايا: الافتراض المبذور للدور، ولا منع لدور مجهول", () => {
    expect(decidePermission(undefined, "storekeeper", "sell").allowed).toBe(false);
    expect(decidePermission(undefined, "cashier", "refund", { amountMinor: 50001n }).allowed).toBe(
      false,
    );
    expect(decidePermission(undefined, undefined, "sell").allowed).toBe(true);
  });
});

describe("checkDiscount — «لا» في الخصم تعني صفراً (O-02)", () => {
  it("forbidden يمنع أي خصم ولو صغيراً", () => {
    const caps = {
      per_op_minor: "1",
      daily_minor: "1",
      percent: 1,
      used_today_minor: "0",
      forbidden: true,
    };
    const r = checkDiscount({ mode: "amount", value: "1", reason: "x" }, caps, 10000n);
    expect(r).toMatchObject({ ok: false, reason: "forbidden" });
  });
});

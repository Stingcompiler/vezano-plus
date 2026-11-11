import "fake-indexeddb/auto";
import { DexieStorage } from "@sting/platform/dexie";
import { expect, it } from "vitest";

import { type CartDraftLine, readLocalBalances, storeBalances } from "./pos-local";
import { saveSaleLocally, type SaleInput } from "./sale-local";
import { openShiftLocally } from "./shift-local";

/**
 * مراجعة 2026-11-10 (ع-١٦): مطابقة الأرصدة مع الخادم كانت تكتب رقم الخادم فوق رصيد الجهاز كما هو —
 * وبيعٌ لم يُرفع بعد ليس في رقم الخادم، فيعود ما بيع «متاحاً» على الشاشة حتى يُرفع. المطابقة الآن
 * رقم الخادم **ناقصاً ما لم يُؤكَّد من هذا الجهاز**.
 */
const sugar: CartDraftLine = {
  id: "l1",
  item_id: "i1",
  item_name: "سكر",
  unit_id: "u-kg",
  unit_code: "كغ",
  unit_name: "كيلوغرام",
  factor_milli: "1000",
  decimal_places: 3,
  qty_milli: "5000",
  unit_price_minor: "10000",
};

async function sell(s: DexieStorage, n: number, qtyMilli = "5000") {
  const existing = await s.read((tx) => tx.getProjection("entity:shifts.Shift:s1"));
  const shift =
    (existing?.value as unknown as SaleInput["shift"] | undefined) ??
    (
      await openShiftLocally(s, {
        shiftId: "s1",
        operationId: "op-open",
        branchId: "b1",
        branchName: "الفرع الرئيسي",
        deviceId: "d1",
        deviceName: "كاشير 2",
        userId: "u1",
        userName: "سميرة ع.",
        openingFloatMinor: "184000",
        businessDate: "2026-09-16",
        occurredAt: "2026-09-16T08:00:00Z",
      })
    ).shift;
  const line = { ...sugar, qty_milli: qtyMilli };
  const total = ((BigInt(qtyMilli) * 10000n) / 1000n).toString();
  await saveSaleLocally(s, {
    operationId: `op-sale-${n}`,
    saleId: `sale-${n}`,
    draft: { lines: [line], updated_at: "" },
    payments: [
      {
        paymentId: `pay-${n}`,
        method: "cash",
        amountMinor: total,
        receivedMinor: total,
        changeMinor: "0",
      },
    ],
    shift,
    branchCode: "KRT",
    devicePrefix: "A2",
    deviceId: "d1",
    userId: "u1",
    userName: "سميرة ع.",
    businessDate: "2026-09-16",
    occurredAt: `2026-09-16T10:3${n}:00Z`,
    memberIds: { lines: [`ln-${n}`], movements: [`mv-${n}`] },
  });
}

const qty = async (s: DexieStorage, item = "i1") =>
  (await readLocalBalances(s)).get(item)?.qty_milli;

async function setState(
  s: DexieStorage,
  operationId: string,
  state: "pending" | "synced" | "conflict" | "quarantined",
) {
  await s.transaction(async (tx) => {
    const op = await tx.getOperation(operationId);
    await tx.putOperation({ ...op!, state });
  });
}

it("بيع لم يُرفع يبقى مخصوماً بعد مطابقة تحمل رقم الخادم القديم", async () => {
  const s = new DexieStorage({ databaseName: `bal-${Math.random()}` });
  await storeBalances(s, "2026-09-16T09:00:00Z", [{ item_id: "i1", qty_milli: "10000" }]);
  await sell(s, 1);
  expect(await qty(s)).toBe("5000");
  // الكاشير يعود إلى شاشة البيع والرفع متعثّر: الخادم ما زال يرى 10
  await storeBalances(s, "2026-09-16T11:00:00Z", [{ item_id: "i1", qty_milli: "10000" }]);
  expect(await qty(s)).toBe("5000");
  expect((await readLocalBalances(s)).get("i1")?.as_of).toBe("2026-09-16T11:00:00Z");
});

it("ما خرج طلبه ولم يعد ردّه (pending) محسوب كذلك، وما أُكِّد لا يُخصم مرتين", async () => {
  const s = new DexieStorage({ databaseName: `bal-${Math.random()}` });
  await storeBalances(s, "2026-09-16T09:00:00Z", [{ item_id: "i1", qty_milli: "10000" }]);
  await sell(s, 1, "2000");
  await sell(s, 2, "3000");
  await setState(s, "op-sale-1", "pending");
  await storeBalances(s, "2026-09-16T11:00:00Z", [{ item_id: "i1", qty_milli: "10000" }]);
  expect(await qty(s)).toBe("5000");
  // الأول أُكِّد ودخل رقم الخادم (8)، والثاني ما زال على الجهاز
  await setState(s, "op-sale-1", "synced");
  await storeBalances(s, "2026-09-16T11:05:00Z", [{ item_id: "i1", qty_milli: "8000" }]);
  expect(await qty(s)).toBe("5000");
  // كلاهما أُكِّد: الرصيد رقم الخادم كما هو
  await setState(s, "op-sale-2", "synced");
  await storeBalances(s, "2026-09-16T11:10:00Z", [{ item_id: "i1", qty_milli: "5000" }]);
  expect(await qty(s)).toBe("5000");
});

it("صنف ليس في المطابقة لا يُمسّ، وصنف بلا حركة معلّقة يأخذ رقم الخادم", async () => {
  const s = new DexieStorage({ databaseName: `bal-${Math.random()}` });
  await storeBalances(s, "2026-09-16T09:00:00Z", [
    { item_id: "i1", qty_milli: "10000" },
    { item_id: "i2", qty_milli: "7000" },
  ]);
  await sell(s, 1);
  await storeBalances(s, "2026-09-16T11:00:00Z", [{ item_id: "i2", qty_milli: "6000" }]);
  expect(await qty(s)).toBe("5000");
  expect(await qty(s, "i2")).toBe("6000");
});

it("المتعارض والمحجور لا يدخلان الرصيد: حكمهما عند المالك (§٨.٨)", async () => {
  const s = new DexieStorage({ databaseName: `bal-${Math.random()}` });
  await storeBalances(s, "2026-09-16T09:00:00Z", [{ item_id: "i1", qty_milli: "10000" }]);
  await sell(s, 1, "2000");
  await sell(s, 2, "3000");
  await setState(s, "op-sale-1", "conflict");
  await setState(s, "op-sale-2", "quarantined");
  await storeBalances(s, "2026-09-16T11:00:00Z", [{ item_id: "i1", qty_milli: "10000" }]);
  expect(await qty(s)).toBe("10000");
});

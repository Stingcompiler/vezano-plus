import { MemoryStorage } from "@sting/platform/memory";
import {
  ITEM_PREFIX,
  openShiftLocally,
  readCartDraft,
  readOpenShift,
  readSales,
  writeCartDraft,
} from "@sting/sync-core";
import { tx } from "@sting/texts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import Pos from "@/app/(tabs)/pos";
import Invoices from "@/app/pos/invoices/index";
import Pay from "@/app/pos/pay";
import PayCredit from "@/app/pos/pay-credit";
import CloseShift from "@/app/shifts/close";
import OpenShift from "@/app/shifts/open";
import { SHIFT_CONTEXT_META } from "@/lib/pos";
import { nativeRoute } from "@/lib/routes";
import { setSecretsForTests } from "@/lib/secrets";
import { ANONYMOUS, SessionProvider, type SessionState } from "@/lib/session";
import { setStorageForTests } from "@/lib/storage";

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("react") as typeof import("react")).useEffect(cb, []);
  },
  Redirect: () => null,
}));
jest.mock("expo-crypto", () => {
  let n = 0;
  return {
    randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    getRandomValues: (a: Uint8Array) => a,
  };
});
jest.mock("@/lib/web", () => ({ WEB_URL: "https://plus.test", openOnWeb: jest.fn() }));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const down = (() =>
  Promise.reject(new TypeError("Network request failed"))) as unknown as typeof fetch;
const ACTIVE: SessionState = {
  ...ANONYMOUS,
  status: "active",
  tenantId: "t1",
  userId: "u1",
  setupDone: true,
  deviceId: "d1",
  tokens: { access: "a", refresh: "r", sessionId: "s" },
};
const renderWith = (ui: ReactElement) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SessionProvider fetchImpl={down} initial={ACTIVE}>
        {ui}
      </SessionProvider>
    </SafeAreaProvider>,
  );

const ITEM = {
  name: "سكر",
  name_normalized: "سكر",
  group_id: "g1",
  group_name: "بقالة",
  base_unit_id: "u1",
  base_unit_code: "kg",
  base_unit_name: "كيلو",
  base_unit_decimal_places: 0,
  units: [],
  barcode: "6291100000011",
  sale_price_minor: "10000",
  price_updated_at: "",
  aliases: [],
  is_active: true,
  deactivated_at: "",
  updated_at: "",
};

let storage: MemoryStorage;
async function seed({ shift = true } = {}) {
  await storage.transaction(async (t) => {
    await t.putProjection({ key: `${ITEM_PREFIX}i1`, value: ITEM });
    await t.putMeta(
      SHIFT_CONTEXT_META,
      JSON.stringify({
        branchId: "b1",
        branchName: "الرئيسي",
        branchCode: "KRT",
        deviceId: "d1",
        deviceName: "هاتف 1",
        devicePrefix: "A2",
        userId: "u1",
        userName: "سميرة",
        roleName: "كاشير",
        roleCode: "cashier",
      }),
    );
  });
  if (shift)
    await openShiftLocally(storage, {
      shiftId: "s-1",
      operationId: "op-shift",
      branchId: "b1",
      branchName: "الرئيسي",
      deviceId: "d1",
      deviceName: "هاتف 1",
      userId: "u1",
      userName: "سميرة",
      openingFloatMinor: "50000",
      businessDate: "2026-10-19",
      occurredAt: new Date().toISOString(),
    });
}
const LINE = {
  id: "l1",
  item_id: "i1",
  item_name: "سكر",
  unit_id: "u1",
  unit_code: "kg",
  unit_name: "كيلو",
  factor_milli: "1000",
  decimal_places: 0 as const,
  qty_milli: "2000",
  unit_price_minor: "10000",
};

beforeEach(() => {
  mockReplace.mockClear();
  mockPush.mockClear();
  storage = new MemoryStorage();
  setStorageForTests(storage);
  const mem = new Map<string, string>();
  setSecretsForTests({
    get: (k) => Promise.resolve(mem.get(k) ?? null),
    set: (k, v) => Promise.resolve(void mem.set(k, v)),
    delete: (k) => Promise.resolve(void mem.delete(k)),
  });
});

describe("M2 — البيع والورديات (0005 §١٩٣)", () => {
  it("POS-01: الصنف يُضاف إلى السلة المحلية والمجموع يظهر", async () => {
    await seed();
    await renderWith(<Pos />);
    await fireEvent.press(await screen.findByText("سكر"));
    await waitFor(async () => expect((await readCartDraft(storage)).lines).toHaveLength(1));
    expect(await screen.findByText(`${tx("POS-01", "السلة ·")}`, { exact: false })).toBeTruthy();
  });

  it("POS-01: بلا وردية = «لا وردية مفتوحة» برسالة افتح وردية لا «ليست لديك صلاحية»", async () => {
    await seed({ shift: false });
    await renderWith(<Pos />);
    expect(
      await screen.findByText(tx("POS-01", "البيع النقدي يحتاج صندوقاً مفتوحاً يستقبل النقد.")),
    ).toBeTruthy();
  });

  it("POS-05: الدفع النقدي يحفظ البيع محلياً بباقٍ صحيح ويفرّغ السلة", async () => {
    await seed();
    await writeCartDraft(storage, { lines: [LINE] });
    await renderWith(<Pay />);
    // المطلوب 200.00 — مبلغ مضبوط
    await fireEvent.press(await screen.findByText(tx("POS-05", "مبلغ مضبوط")));
    await fireEvent.press(
      screen.getByRole("button", { name: new RegExp(tx("POS-05", "حفظ البيع —")) }),
    );
    await waitFor(async () => expect(await readSales(storage)).toHaveLength(1));
    const [sale] = await readSales(storage);
    expect(sale?.total_minor).toBe("20000");
    expect(sale?.cash_minor).toBe("20000");
    expect(sale?.change_minor).toBe("0");
    expect((await readCartDraft(storage)).lines).toHaveLength(0);
    expect(await screen.findByText(tx("POS-05", "رقم الفاتورة"), { exact: false })).toBeTruthy();
  });

  it("POS-06: الآجل بلا عميل مسمّى يطلب اختيار العميل ولا يحفظ", async () => {
    await seed();
    await writeCartDraft(storage, { lines: [LINE] });
    await renderWith(<PayCredit />);
    await fireEvent.press(
      await screen.findByRole("button", { name: tx("POS-06", "اختيار العميل") }),
    );
    expect(mockPush).toHaveBeenCalledWith("/pos/customer");
    expect(await readSales(storage)).toHaveLength(0);
  });

  it("POS-09: الفاتورة المحفوظة تظهر في القائمة بوضع «محفوظ محلياً»", async () => {
    await seed();
    await writeCartDraft(storage, { lines: [LINE] });
    await renderWith(<Pay />);
    await fireEvent.press(await screen.findByText(tx("POS-05", "مبلغ مضبوط")));
    await fireEvent.press(
      screen.getByRole("button", { name: new RegExp(tx("POS-05", "حفظ البيع —")) }),
    );
    await waitFor(async () => expect(await readSales(storage)).toHaveLength(1));
    await cleanup();
    await renderWith(<Invoices />);
    expect(await screen.findByText(tx("POS-09", "محفوظ محلياً"))).toBeTruthy();
  });

  it("SHIFT-01: درج فارغ لا يُحسب صفراً بالنيابة، والفتح بعدٍّ يحفظ وردية محلية", async () => {
    await seed({ shift: false });
    await renderWith(<OpenShift />);
    await fireEvent.press(
      await screen.findByRole("button", { name: tx("SHIFT-01", "افتح الوردية وابدأ البيع") }),
    );
    expect(
      await screen.findByText(
        tx(
          "SHIFT-01",
          "درجٌ فارغ حالةٌ مشروعة تُكتب 0.00. والحقل الفارغ يُعلَّم ولا يُحسب صفراً بالنيابة.",
        ),
      ),
    ).toBeTruthy();
    expect(await readOpenShift(storage)).toBeNull();
    for (const d of ["5", "0", "0"]) await fireEvent.press(screen.getByRole("button", { name: d }));
    await fireEvent.press(
      screen.getByRole("button", { name: tx("SHIFT-01", "افتح الوردية وابدأ البيع") }),
    );
    await waitFor(async () =>
      expect((await readOpenShift(storage))?.opening_float_minor).toBe("50000"),
    );
  });

  it("SHIFT-04: فئة فارغة تمنع الإقفال بالاسم، وكل الفئات تُقفل بالعدّ", async () => {
    await seed();
    await renderWith(<CloseShift />);
    await fireEvent.press(
      await screen.findByRole("button", { name: tx("SHIFT-04", "أكّد العدّ واعرض الفارق") }),
    );
    expect(await screen.findByText(tx("SHIFT-04", "عدٌّ غير مكتمل"))).toBeTruthy();
    expect((await readOpenShift(storage))?.state).toBe("open");
  });

  it("المسارات: شاشات M2 تُفتح داخلياً", () => {
    expect(nativeRoute("/pos/pay/credit")).toBe("/pos/pay-credit");
    expect(nativeRoute("/pos/invoices/abc/return")).toBe("/pos/invoices/abc/return");
    expect(nativeRoute("/shifts/close")).toBe("/shifts/close");
    expect(nativeRoute("/catalog")).toBe("/catalog");
    expect(nativeRoute("/org/users")).toBeNull();
  });
});

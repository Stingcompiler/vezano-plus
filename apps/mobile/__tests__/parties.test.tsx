import { MemoryStorage } from "@sting/platform/memory";
import { openShiftLocally, PARTY_PREFIX, readLocalParties, readReceipts } from "@sting/sync-core";
import { tx } from "@sting/texts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Linking } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import Customers from "@/app/(tabs)/parties";
import Merge from "@/app/parties/[id]/merge";
import Opening from "@/app/parties/[id]/opening";
import Payment from "@/app/parties/[id]/payment";
import StatementShare from "@/app/parties/[id]/statement/share";
import Correct from "@/app/parties/receipts/[receiptId]/correct";
import { absoluteUrl } from "@/features/parties/lib";
import { SHIFT_CONTEXT_META } from "@/lib/pos";
import { setSecretsForTests } from "@/lib/secrets";
import { ANONYMOUS, SessionProvider, type SessionState } from "@/lib/session";
import { setStorageForTests } from "@/lib/storage";

const mockReplace = jest.fn();
const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
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
const renderWith = (ui: ReactElement, fetchImpl: typeof fetch = down) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SessionProvider fetchImpl={fetchImpl} initial={ACTIVE}>
        {ui}
      </SessionProvider>
    </SafeAreaProvider>,
  );

/** خادم وهمي: أول مفتاح يحتويه المسار يحدّد الردّ. */
function mockServer(routes: Record<string, { status?: number; body?: unknown }>) {
  const calls: { method: string; url: string }[] = [];
  const impl = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    calls.push({ method, url });
    const key = Object.keys(routes).find((k) => url.includes(k));
    const r = key ? routes[key] : undefined;
    return Promise.resolve(
      new Response(JSON.stringify(r?.body ?? {}), {
        status: r?.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return { impl, calls };
}

const PARTY = {
  name: "أحمد",
  name_normalized: "احمد",
  phone: "0912345447",
  credit_limit_minor: "0",
  is_customer: true,
  is_supplier: false,
  distinct_from_id: "",
  balance_minor: "10000",
  balance_as_of: "2026-10-01T00:00:00.000Z",
  last_sale_at: "",
  is_active: true,
  deactivated_at: "",
  updated_at: "",
};

let storage: MemoryStorage;
async function seed({ shift = true, role = "cashier" } = {}) {
  await storage.transaction(async (t) => {
    await t.putProjection({ key: `${PARTY_PREFIX}p1`, value: { ...PARTY, id: "p1" } });
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
        roleName: role === "owner" ? "مالك" : "كاشير",
        roleCode: role,
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
const hint = (id: string) => screen.getByTestId(id).props.accessibilityHint as string;

beforeEach(() => {
  mockReplace.mockClear();
  mockPush.mockClear();
  mockParams = { id: "p1" };
  storage = new MemoryStorage();
  setStorageForTests(storage);
  const mem = new Map<string, string>();
  setSecretsForTests({
    get: (k) => Promise.resolve(mem.get(k) ?? null),
    set: (k, v) => Promise.resolve(void mem.set(k, v)),
    delete: (k) => Promise.resolve(void mem.delete(k)),
  });
});
afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
});

describe("M3 — الأطراف (PTY-01 … PTY-09)", () => {
  it("PTY-01: بلا اتصال تظهر أسماء الجهاز بحالة offline والرصيد من آخر مطابقة", async () => {
    await seed();
    await renderWith(<Customers />);
    expect(await screen.findByText("أحمد")).toBeTruthy();
    await waitFor(() => expect(hint("PTY-01")).toBe("offline"));
    expect(screen.getByText(tx("PTY-01", "أرصدة محلية"))).toBeTruthy();
  });

  it("PTY-01: الكاشير (403) يرى «يرى من يبيع له» لا القائمة", async () => {
    await seed();
    const { impl } = mockServer({ "/api/parties/list": { status: 403 } });
    await renderWith(<Customers />, impl);
    expect(await screen.findByText(tx("PTY-01", "الكاشير يرى من يبيع له"))).toBeTruthy();
    expect(hint("PTY-01")).toBe("permission_denied");
    await fireEvent.press(screen.getByRole("button", { name: tx("PTY-01", "اختيار العميل") }));
    expect(mockPush).toHaveBeenCalledWith("/pos/customer");
  });

  it("PTY-06: بلا مبلغ = validation_error ولا سند محفوظ", async () => {
    await seed();
    await renderWith(<Payment />);
    await screen.findByText(tx("PTY-06", "المبلغ المسدَّد"));
    await fireEvent.press(
      screen.getByRole("button", { name: tx("PTY-06", "تسجيل السداد وطباعة إيصال") }),
    );
    expect(await screen.findByText(tx("PTY-06", "مبلغ موجب"))).toBeTruthy();
    expect(hint("PTY-06")).toBe("validation_error");
    expect(await readReceipts(storage)).toHaveLength(0);
  });

  it("PTY-06: السداد بلا اتصال يُحفظ محلياً (saved_local) والإسقاط المحلي لا يُعاد تحميله بعد الرفع", async () => {
    await seed();
    await renderWith(<Payment />);
    await screen.findByText(tx("PTY-06", "المبلغ المسدَّد"));
    for (const d of ["2", "5", "0"]) await fireEvent.press(screen.getByRole("button", { name: d }));
    await fireEvent.press(
      screen.getByRole("button", { name: tx("PTY-06", "تسجيل السداد وطباعة إيصال") }),
    );
    await waitFor(async () => expect(await readReceipts(storage)).toHaveLength(1));
    const [r] = await readReceipts(storage);
    expect(r?.amount_minor).toBe("25000");
    expect(r?.method).toBe("cash");
    await waitFor(() => expect(hint("PTY-06")).toBe("saved_local"));
    expect(screen.getByText(tx("PTY-06", "سُجّل بلا اتصال"))).toBeTruthy();
    // الرصيد المخزَّن الخادمي لم يُلمس: الرفع لا يحدّث الإسقاط
    expect((await readLocalParties(storage)).find((p) => p.id === "p1")?.balance_minor).toBe(
      "10000",
    );
  });

  it("PTY-06: الكاشير لا يردّ (permission_denied)", async () => {
    await seed();
    await renderWith(<Payment />);
    await fireEvent.press(await screen.findByRole("button", { name: tx("PTY-06", "ردّ مبلغ") }));
    expect(await screen.findByText(tx("PTY-06", "الكاشير يقبض ولا يردّ"))).toBeTruthy();
    expect(hint("PTY-06")).toBe("permission_denied");
  });

  it("PTY-04: غير المالك permission_denied وزرّ الحفظ بسببه", async () => {
    const { impl } = mockServer({
      "/api/parties/p1": {
        body: {
          id: "p1",
          name: "أحمد",
          is_customer: true,
          is_supplier: false,
          balance_minor: "0",
          supplier_owed_minor: "",
          can_open_balance: false,
          has_movements: false,
          opening_balances: [],
          potential_duplicates: [],
          aliases: [],
        },
      },
    });
    await renderWith(<Opening />, impl);
    expect(await screen.findByText(tx("PTY-04", "حفظ الرصيد الافتتاحي"))).toBeTruthy();
    expect(hint("PTY-04")).toBe("permission_denied");
    expect(screen.getAllByText(tx("PTY-04", "الافتتاحي للمالك")).length).toBeGreaterThan(0);
  });

  it("PTY-07: الدمج يحتاج كلمة تأكيد تُكتب قبل أن يُفعَّل الزر", async () => {
    mockParams = { id: "p2", target: "p1" };
    const side = (id: string, name: string) => ({
      id,
      name,
      phone: "",
      balance_minor: "1000",
      movements: 2,
      merged_into: "",
    });
    const { impl, calls } = mockServer({
      "/api/parties/p2/merge": {
        body: {
          source: side("p2", "أحمد ع"),
          target: side("p1", "أحمد"),
          movements_after: 4,
          balance_after_minor: "2000",
          phones_differ: false,
        },
      },
    });
    await renderWith(<Merge />, impl);
    await fireEvent.press(await screen.findByRole("button", { name: tx("PTY-07", "تأكيد الدمج") }));
    const word = await screen.findByLabelText(tx("PTY-07", "دمج"));
    const confirm = () =>
      screen.getAllByRole("button", { name: tx("PTY-07", "تأكيد الدمج") }).at(-1);
    const disabled = () =>
      (confirm()?.props as { accessibilityState: { disabled: boolean } }).accessibilityState
        .disabled;
    expect(disabled()).toBe(true);
    await fireEvent.changeText(word, tx("PTY-07", "دمج"));
    expect(disabled()).toBe(false);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("PTY-08: رابط المشاركة مطلق من المسار النسبي، وواتساب يحمله", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue();
    const stmt = {
      party: { id: "p1", name: "أحمد" },
      rows: [],
      balance_minor: "10000",
      hidden_other_branch: 0,
      as_of: "2026-10-19T10:00:00.000Z",
      scope: "all",
      branch_names: {},
      tenant_name: "متجر",
    };
    const { impl } = mockServer({
      "statement/export": {
        body: {
          export: {
            id: "e1",
            kind: "link",
            file_name: "x.pdf",
            page_count: 1,
            url: "/api/parties/exports/tok123",
            generated_at: "2026-10-19T10:00:00.000Z",
            opened_at: "",
            open_count: 0,
          },
        },
      },
      "/statement": { body: stmt },
    });
    await renderWith(<StatementShare />, impl);
    await fireEvent.press(await screen.findByRole("button", { name: tx("PTY-08", "مشاركة رابط") }));
    const wa = await screen.findByRole("button", { name: "واتساب" });
    expect(hint("PTY-08")).toBe("success");
    await fireEvent.press(wa);
    expect(open).toHaveBeenCalledWith(
      `https://wa.me/?text=${encodeURIComponent("https://plus.test/api/parties/exports/tok123")}`,
    );
  });

  it("PTY-09: تاريخ داخل فترة مقفلة يُمنع قبل الإرسال", async () => {
    mockParams = { receiptId: "r1" };
    const { impl, calls } = mockServer({
      "/correct": {
        body: {
          receipt: {
            id: "r1",
            receipt_number: "REC-1",
            party_id: "p1",
            kind: "receipt",
            method: "cash",
            amount_minor: "5000",
            reference: "",
            reason: "",
            user_name: "سميرة",
            business_date: "2026-10-10",
          },
          effective: {
            method: "cash",
            reference: "",
            amount_minor: "5000",
            business_date: "2026-10-10",
            reversed: false,
            effective: true,
          },
          corrections: [],
          party: { id: "p1", name: "أحمد", balance_minor: "100" },
          locked_before: "2026-10-01",
        },
      },
    });
    await renderWith(<Correct />, impl);
    await fireEvent.press(
      await screen.findByRole("button", { name: tx("PTY-09", "تصحيح تاريخ الأعمال") }),
    );
    await fireEvent.changeText(screen.getByLabelText(tx("PTY-09", "تاريخ الأعمال")), "2026-09-15");
    await fireEvent.changeText(
      screen.getByLabelText(tx("PTY-09", "السبب — إلزامي ويظهر في سجل التدقيق")),
      "خطأ",
    );
    await fireEvent.press(
      screen.getByRole("button", { name: tx("PTY-09", "إنشاء مستند التصحيح") }),
    );
    expect(
      (await screen.findAllByText(tx("PTY-09", "تاريخ داخل فترة مقفلة"))).length,
    ).toBeGreaterThan(0);
    expect(hint("PTY-09")).toBe("validation_error");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("الروابط: absoluteUrl نسبي→مطلق", () => {
    expect(absoluteUrl("/api/parties/exports/t", "https://x.test")).toBe(
      "https://x.test/api/parties/exports/t",
    );
  });
});

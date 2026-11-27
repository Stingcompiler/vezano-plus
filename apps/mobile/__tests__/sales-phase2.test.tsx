import { MemoryStorage } from "@sting/platform/memory";
import {
  holdCart,
  openShiftLocally,
  readCartDraft,
  readHeldCarts,
  readMovements,
  storeVerifiers,
  writeCartDraft,
} from "@sting/sync-core";
import { tx } from "@sting/texts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { pbkdf2Sync } from "node:crypto";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import Approvals from "@/app/approvals";
import Discount from "@/app/pos/discount";
import Held from "@/app/pos/held";
import Movements from "@/app/shifts/movements";
import Review from "@/app/shifts/review";
import { SHIFT_CONTEXT_META } from "@/lib/pos";
import { nativeRoute } from "@/lib/routes";
import { setSecretsForTests } from "@/lib/secrets";
import { ANONYMOUS, SessionProvider, type SessionState } from "@/lib/session";
import { setStorageForTests } from "@/lib/storage";

/**
 * مراجعة البيع 2026-11-22 — المرحلة ٢ على الهاتف (0005 §٢٩٣)، نظير `apps/web/e2e/sales-phase2.spec.ts`:
 * المعلّقات (POS-13)، واعتماد المدير الحاضر برمزه (POS-03 وSHIFT-03)، و«طلبات تنتظرك» (APR-01)،
 * والإقفال الإداري (SHIFT-05).
 */
const mockBack = jest.fn();
const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: jest.fn(), push: mockPush, back: mockBack }),
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
const ACTIVE: SessionState = {
  ...ANONYMOUS,
  status: "active",
  tenantId: "t1",
  userId: "u1",
  setupDone: true,
  deviceId: "d1",
  tokens: { access: "a", refresh: "r", sessionId: "s" },
};

type Handler = (url: string, init?: RequestInit) => unknown;
let routes: Record<string, Handler> = {};
const calls: { url: string; body: unknown }[] = [];
const server = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const raw =
    input instanceof Request ? await input.clone().text() : (init?.body as string | undefined);
  calls.push({ url, body: raw ? (JSON.parse(raw) as unknown) : null });
  const key = Object.keys(routes).find((k) => url.includes(k));
  if (!key) throw new TypeError("Network request failed");
  const out = routes[key](url, init);
  return new Response(JSON.stringify(out), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

const renderWith = (ui: ReactElement) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SessionProvider fetchImpl={server} initial={ACTIVE}>
        {ui}
      </SessionProvider>
    </SafeAreaProvider>,
  );

const SALT = Buffer.alloc(16).toString("base64");
const encoded = (pin: string) =>
  `pbkdf2_sha256$1000$${SALT}$${pbkdf2Sync(pin, Buffer.alloc(16), 1000, 32, "sha256").toString("base64")}`;
const lim = (m: string) => ({ value: "limit", limit_minor: m, period: "per_op" });

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
  unit_price_minor: "100000",
};

let storage: MemoryStorage;
async function seed() {
  await storage.transaction((t) =>
    t.putMeta(
      SHIFT_CONTEXT_META,
      JSON.stringify({
        branchId: "b1",
        branchName: "الرئيسي",
        deviceId: "d1",
        deviceName: "هاتف 1",
        userId: "u1",
        userName: "سميرة",
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
    ),
  );
  await storeVerifiers(storage, {
    device_id: "d1",
    prefix: "A2",
    branch_name: "الرئيسي",
    pin_length: 6,
    fetched_at: "2026-11-26T08:00:00Z",
    verifiers: [
      {
        user_id: "u-manager",
        display_name: "عمر",
        role_name: "مدير فرع",
        branch_name: "الرئيسي",
        encoded: encoded("222222"),
        version: 4,
        role_code: "manager",
        is_owner: false,
        permissions: { discount: lim("20000") },
      },
      {
        user_id: "u-owner",
        display_name: "ندى",
        role_name: "مالك",
        branch_name: "الرئيسي",
        encoded: encoded("111111"),
        version: 2,
        role_code: "owner",
        is_owner: true,
      },
    ],
  });
  await openShiftLocally(storage, {
    shiftId: "s-1",
    operationId: "op-shift",
    branchId: "b1",
    branchName: "الرئيسي",
    deviceId: "d1",
    deviceName: "هاتف 1",
    userId: "u1",
    userName: "سميرة",
    openingFloatMinor: "1000000",
    businessDate: "2026-11-26",
    occurredAt: new Date().toISOString(),
  });
}

async function ops() {
  return storage.read(async (t) => [
    ...(await t.listOperationsByState("local")),
    ...(await t.listOperationsByState("pending")),
  ]);
}

beforeEach(() => {
  mockBack.mockClear();
  mockPush.mockClear();
  mockParams = {};
  routes = {};
  calls.length = 0;
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
});

describe("المرحلة ٢ من مراجعة البيع على الهاتف (0005 §٢٩٣)", () => {
  it("POS-13: القائمة تستأنف المعلّقة سلةً وتحذف أخرى بتأكيد", async () => {
    await seed();
    await holdCart(
      storage,
      { lines: [LINE] },
      { label: "طاولة 3", id: "h1", now: "2026-11-26T09:00:00Z" },
    );
    await holdCart(
      storage,
      { lines: [LINE] },
      { label: "أحمد", id: "h2", now: "2026-11-26T09:30:00Z" },
    );
    await renderWith(<Held />);
    expect(await screen.findByText("طاولة 3")).toBeTruthy();
    const del = await screen.findAllByRole("button", { name: tx("POS-13", "حذف المعلّقة") });
    await fireEvent.press(del[0]); // الأحدث أولاً: «أحمد»
    expect(await screen.findByText(tx("POS-13", "تُحذف من هذا الجهاز ولا تعود."))).toBeTruthy();
    const confirm = await screen.findAllByRole("button", { name: tx("POS-13", "حذف المعلّقة") });
    await fireEvent.press(confirm[0]);
    await waitFor(async () =>
      expect((await readHeldCarts(storage)).map((h) => h.id)).toEqual(["h1"]),
    );
    await fireEvent.press(await screen.findByRole("button", { name: tx("POS-13", "استئناف") }));
    await waitFor(async () => expect((await readCartDraft(storage)).lines).toHaveLength(1));
    expect(await readHeldCarts(storage)).toEqual([]);
    expect(mockBack).toHaveBeenCalled();
  });

  it("POS-03: خصم فوق السقف يعتمده مدير حاضر برمزه؛ الرمز الخاطئ لا يعتمد", async () => {
    await seed();
    await writeCartDraft(storage, { lines: [LINE] });
    await renderWith(<Discount />);
    for (const d of ["1", "5", "0"])
      await fireEvent.press(await screen.findByRole("button", { name: d }));
    await fireEvent.changeText(screen.getByLabelText(tx("POS-03", "السبب — إلزامي")), "زبون دائم");
    await fireEvent.press(screen.getByRole("button", { name: tx("POS-03", "تطبيق الخصم") }));
    await fireEvent.press(
      await screen.findByRole("button", { name: tx("POS-03", "اعتماد مدير حاضر") }),
    );
    const pin = await screen.findByLabelText(
      tx("shared:features/approvals/approver-pin.tsx", "رمز المعتمد"),
    );
    await fireEvent.changeText(pin, "999999");
    await fireEvent.press(
      screen.getByRole("button", {
        name: tx("shared:features/approvals/approver-pin.tsx", "اعتمد"),
      }),
    );
    expect(
      await screen.findByText(tx("shared:features/approvals/approver-pin.tsx", "محاولة خاطئة —")),
    ).toBeTruthy();
    await fireEvent.changeText(pin, "222222");
    await fireEvent.press(
      screen.getByRole("button", {
        name: tx("shared:features/approvals/approver-pin.tsx", "اعتمد"),
      }),
    );
    await waitFor(async () =>
      expect((await readCartDraft(storage)).discount?.approval?.approved_by_name).toBe("عمر"),
    );
    expect((await readCartDraft(storage)).discount?.value).toBe("15000");
    const op = (await ops()).find((o) => o.kind === "discount_override");
    expect(op?.members[0]?.payload).toMatchObject({
      approval_method: "pin",
      approved_by_user_id: "u-manager",
      verifier_version: "4",
    });
  });

  it("SHIFT-03: السحب برمز المالك الحاضر يُسجَّل باسمه، ونصّ «أُرسل الطلب» لا يظهر", async () => {
    await seed();
    await renderWith(<Movements />);
    await fireEvent.press(await screen.findByRole("button", { name: tx("SHIFT-03", "سحب") }));
    await fireEvent.changeText(screen.getByLabelText(tx("SHIFT-03", "المبلغ")), "500");
    await fireEvent.changeText(
      screen.getByLabelText(tx("SHIFT-03", "السبب")),
      "توريد للخزنة الرئيسية",
    );
    await fireEvent.press(
      await screen.findByRole("button", { name: tx("SHIFT-03", "اعتماد المالك بالرمز") }),
    );
    await fireEvent.changeText(
      await screen.findByLabelText(tx("shared:features/approvals/approver-pin.tsx", "رمز المعتمد")),
      "111111",
    );
    await fireEvent.press(
      screen.getByRole("button", {
        name: tx("shared:features/approvals/approver-pin.tsx", "اعتمد"),
      }),
    );
    await waitFor(async () => expect(await readMovements(storage, "s-1")).toHaveLength(1));
    const op = (await ops()).find((o) => o.kind === "cash_movement");
    expect(op?.members[0]?.payload).toMatchObject({
      kind: "withdrawal",
      signed_amount_minor: "-50000",
      authorized_by_user_id: "u-owner",
      approval_method: "pin",
    });
    expect(screen.queryByText("أُرسل الطلب", { exact: false })).toBeNull();
  });

  it("APR-01: «وافق» يرسل القرار، و«ارفض» بلا سبب لا يُرسل", async () => {
    await seed();
    routes = {
      "/decide": () => ({ item: {} }),
      "/api/approvals": () => ({
        can_review: true,
        scope: "all",
        branch_name: "",
        items: [
          {
            id: "w1",
            kind: "withdrawal",
            status: "pending",
            amount_minor: "50000",
            reason: "توريد للخزنة",
            requested_by_name: "سالم",
            requested_at: "2026-11-26T09:00:00Z",
            branch_name: "الرئيسي",
            decided_by_user_id: "",
            decided_by_name: "",
            decision_reason: "",
            can_decide: true,
          },
        ],
      }),
    };
    await renderWith(<Approvals />);
    expect(await screen.findByText("توريد للخزنة")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: tx("APR-01", "ارفض") }));
    expect(await screen.findByText(tx("APR-01", "اكتب سبب الرفض."))).toBeTruthy();
    expect(calls.some((c) => c.url.includes("/decide"))).toBe(false);
    await fireEvent.press(screen.getByRole("button", { name: tx("APR-01", "وافق") }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/withdrawal/w1/decide"))).toBe(true),
    );
    expect(calls.find((c) => c.url.includes("/decide"))?.body).toEqual({
      decision: "accept",
      reason: "",
    });
  });

  it("SHIFT-05: «افتح الإقفال» يفتح الإقفال الإداري ويُرسل المعدود وسببه", async () => {
    await seed();
    mockParams = { close: "s-ab" };
    routes = {
      "/admin-close": () => ({ row: {} }),
      "/api/shifts/review": () => ({
        scope: "branch",
        can_settle: true,
        shifts: [
          {
            id: "s-ab",
            device_name: "كاشير 2",
            user_name: "سالم",
            opened_at: "2026-11-25T07:00:00Z",
            closed_at: "",
            state: "open",
            count_status: "",
            expected_cash_at_close_minor: "",
            expected_cash_minor: "100000",
            counted_cash_minor: "",
            counted_by_name: "",
            variance_minor: "",
            abandoned: true,
            review: null,
            can_admin_close: true,
            close_limit_minor: "30000",
          },
        ],
      }),
    };
    await renderWith(<Review />);
    await fireEvent.changeText(await screen.findByLabelText(tx("SHIFT-05", "المعدود")), "600");
    await fireEvent.changeText(screen.getByLabelText(tx("SHIFT-05", "السبب")), "الجهاز تعطّل");
    expect(await screen.findAllByText(tx("SHIFT-05", "العجز فوق حدّك"))).not.toHaveLength(0);
    await fireEvent.changeText(screen.getByLabelText(tx("SHIFT-05", "المعدود")), "800");
    await fireEvent.press(screen.getByRole("button", { name: tx("SHIFT-05", "إقفال إداري") }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("/s-ab/admin-close"))).toBe(true));
    expect(calls.find((c) => c.url.includes("/admin-close"))?.body).toEqual({
      counted_cash_minor: "80000",
      reason: "الجهاز تعطّل",
    });
  });

  it("المسارات: المعلّقات و«طلبات تنتظرك» تُفتح داخلياً", () => {
    expect(nativeRoute("/pos/held")).toBe("/pos/held");
    expect(nativeRoute("/approvals")).toBe("/approvals");
  });
});

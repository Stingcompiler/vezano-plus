import { MemoryStorage } from "@sting/platform/memory";
import {
  ITEM_PREFIX,
  readGoodsReceipts,
  readLocalTransfers,
  readOpenCountSession,
  storeBalances,
} from "@sting/sync-core";
import { tx } from "@sting/texts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { CountScreen } from "@/features/inventory/count";
import { DamageScreen } from "@/features/inventory/damage";
import { OpeningsScreen } from "@/features/inventory/openings";
import { ReceiveScreen } from "@/features/inventory/receive";
import { ReviewScreen } from "@/features/inventory/review";
import { StockScreen } from "@/features/inventory/stock";
import { TransferNewScreen } from "@/features/inventory/transfer-new";
import { TransferReceiveScreen } from "@/features/inventory/transfer-receive";
import { SHIFT_CONTEXT_META } from "@/lib/pos";
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

/** خادم وهمي: مسار → (حالة، جسم)؛ ما لم يُعرَّف يفشل كالانقطاع. */
function server(routes: Record<string, [number, unknown]>): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input as Request;
    const url = new URL(typeof input === "string" ? input : req.url);
    const method = (init?.method ?? req.method ?? "GET").toUpperCase();
    const hit = routes[`${method} ${url.pathname}`];
    if (!hit) return Promise.reject(new TypeError("Network request failed"));
    return Promise.resolve(
      new Response(JSON.stringify(hit[1]), {
        status: hit[0],
        headers: { "content-type": "application/json" },
      }),
    );
  };
}

const renderWith = (ui: ReactElement, fetchImpl: typeof fetch = down) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SessionProvider fetchImpl={fetchImpl} initial={ACTIVE}>
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
async function seed(
  opts: { items?: [string, string][]; balance?: Record<string, string>; branch?: string } = {},
) {
  const items = opts.items ?? [["i1", "سكر"]];
  await storage.transaction(async (t) => {
    for (const [id, name] of items)
      await t.putProjection({
        key: `${ITEM_PREFIX}${id}`,
        value: { ...ITEM, name, name_normalized: name, barcode: `62911${id}` },
      });
    await t.putMeta(
      SHIFT_CONTEXT_META,
      JSON.stringify({
        branchId: opts.branch ?? "b1",
        branchName: "الرئيسي",
        branchCode: "KRT",
        deviceId: "d1",
        deviceName: "هاتف 1",
        devicePrefix: "A2",
        userId: "u1",
        userName: "سميرة",
        roleName: "أمين مخزن",
        roleCode: "storekeeper",
      }),
    );
  });
  if (opts.balance)
    await storeBalances(
      storage,
      "2026-10-19T10:00:00.000Z",
      Object.entries(opts.balance).map(([item_id, qty_milli]) => ({ item_id, qty_milli })),
    );
}
const hint = (id: string) => screen.getByTestId(id).props.accessibilityHint as string;
const btn = (name: string) => screen.getByRole("button", { name });
const type = (label: string, value: string) =>
  fireEvent.changeText(screen.getByLabelText(label), value);
async function pickItem(label: string, name: string) {
  await fireEvent.press(screen.getAllByRole("button", { name: label })[0]);
  await fireEvent.press(await screen.findByText(name));
}

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
afterEach(async () => {
  await cleanup();
});

describe("M3 — المخزون (INV-01…INV-10)", () => {
  it("INV-01: بلا اتصال تُعرض أرصدة الجهاز بحالة offline والسالب موسوم لا مصفَّر", async () => {
    await seed({ balance: { i1: "-2000" } });
    await renderWith(<StockScreen />);
    expect(await screen.findByText("سكر")).toBeTruthy();
    expect(await screen.findByText(tx("INV-01", "رصيد سالب"))).toBeTruthy();
    await waitFor(() => expect(hint("INV-01")).toBe("offline"));
  });

  it("INV-04: حقول ناقصة = validation_error ولا حفظ؛ ثم الحفظ المحلي بلا اتصال = saved_local", async () => {
    await seed();
    await renderWith(<ReceiveScreen />);
    await fireEvent.press(
      await screen.findByRole("button", { name: tx("INV-04", "تسجيل الاستلام") }),
    );
    await waitFor(() => expect(hint("INV-04")).toBe("validation_error"));
    expect(await readGoodsReceipts(storage)).toHaveLength(0);

    await type(tx("INV-04", "المورد"), "مورد الشمال");
    await type(tx("INV-04", "مرجع المستند"), "PO-7");
    await pickItem(tx("INV-04", "الصنف"), "سكر");
    await type(tx("INV-04", "الكمية"), "3");
    await fireEvent.press(btn(tx("INV-04", "تسجيل الاستلام")));
    await waitFor(async () => expect(await readGoodsReceipts(storage)).toHaveLength(1));
    const [r] = await readGoodsReceipts(storage);
    expect(r?.lines[0]?.base_qty_milli).toBe("3000");
    await waitFor(() => expect(hint("INV-04")).toBe("saved_local"));
    expect(await screen.findByText(tx("INV-04", "حُفظ على الجهاز — لم يُرفع بعد"))).toBeTruthy();
  });

  it("INV-03: الصنف الجديد من الخادم يُدمج مع المحلي، و403 يعطي permission_denied", async () => {
    await seed();
    const fetchImpl = server({
      "GET /api/catalog/items": [200, { items: [{ ...ITEM, id: "i9", name: "ملح" }] }],
      "GET /api/inventory/openings": [
        200,
        {
          branch_id: "b1",
          can_approve: false,
          openings: [],
          opened_item_ids: [],
          moved_item_ids: [],
        },
      ],
      "POST /api/inventory/openings": [403, { detail: "forbidden" }],
    });
    await renderWith(<OpeningsScreen preselect="i9" />, fetchImpl);
    // ?item=i9 يُختار مسبقاً في السطر الأول رغم أنه غير موجود محلياً
    expect(await screen.findByText("ملح")).toBeTruthy();
    await type(tx("INV-03", "الكمية"), "5");
    await fireEvent.press(btn(tx("INV-03", "إرسال للاعتماد")));
    await waitFor(() => expect(hint("INV-03")).toBe("permission_denied"));
    expect(await screen.findByText(tx("INV-03", "أُرسلت للاعتماد"))).toBeTruthy();
  });

  it("INV-05: رصيد النظام محجوب قبل العدّ، والجرد الجزئي يطلب تأكيداً ثم يوثّق ولا يسوّي", async () => {
    await seed({
      items: [
        ["i1", "سكر"],
        ["i2", "رز"],
      ],
      balance: { i1: "10000", i2: "4000" },
    });
    await renderWith(<CountScreen />);
    await screen.findByText(/سكر/);
    expect(screen.queryByText(tx("INV-05", "رصيد النظام"), { exact: false })).toBeNull();
    await fireEvent.press(await screen.findByLabelText(`${tx("INV-05", "زيادة —")} سكر`));
    await waitFor(async () =>
      expect((await readOpenCountSession(storage))?.counts["i1"]?.countedMilli).toBe("1000"),
    );
    expect(await screen.findByText(tx("INV-05", "رصيد النظام"), { exact: false })).toBeTruthy();

    await fireEvent.press(btn(tx("INV-05", "إنهاء العدّ ومراجعة الفروق")));
    await waitFor(() => expect(hint("INV-05")).toBe("partial"));
    expect(await readOpenCountSession(storage)).not.toBeNull();
    const confirm = screen.getAllByRole("button", {
      name: tx("INV-05", "إنهاء العدّ ومراجعة الفروق"),
    });
    await fireEvent.press(confirm[confirm.length - 1]);
    await waitFor(() => expect(hint("INV-05")).toBe("success"));
    expect(await readOpenCountSession(storage)).toBeNull();
  });

  it("INV-06: من يعدّ ليس من يسوّي — permission_denied وسبب التعطيل ظاهر", async () => {
    await seed();
    const review = {
      session: {
        id: "cs1",
        session_number: "CNT-1",
        branch_name: "الرئيسي",
        status: "closed",
        user_name: "سميرة",
        total_items: 2,
        counted_items: 1,
        closed_at: "2026-10-19T10:00:00.000Z",
      },
      rows: [
        {
          line_id: "l1",
          item_id: "i1",
          item_name: "سكر",
          unit_name: "كيلو",
          book_milli: "10000",
          counted_milli: "8000",
          system_at_count_milli: "10000",
          delta_milli: "-2000",
          value_minor: "-20000",
          moved_since_count: false,
        },
      ],
      variance_count: 1,
      effect_minor: "-20000",
      suggested_reasons: ["تالف"],
      adjustment: null,
      can_adjust: false,
    };
    await renderWith(
      <ReviewScreen sessionId="cs1" />,
      server({ "GET /api/inventory/count-sessions/cs1": [200, review] }),
    );
    await waitFor(() => expect(hint("INV-06")).toBe("permission_denied"));
    expect(
      (await screen.findAllByText(tx("INV-06", "من يعدّ ليس من يسوّي"))).length,
    ).toBeGreaterThan(0);
  });

  it("INV-07: هالك يتجاوز الرصيد = validation_error وزر الإرسال معطّل بسببه", async () => {
    await seed({ balance: { i1: "2000" } });
    await renderWith(<DamageScreen itemId="i1" />);
    await fireEvent.press(await screen.findByLabelText(tx("INV-07", "زيادة")));
    await fireEvent.press(screen.getByLabelText(tx("INV-07", "زيادة")));
    await waitFor(() => expect(hint("INV-07")).toBe("validation_error"));
    expect(await screen.findByText(tx("INV-07", "الحدّ من الرصيد"))).toBeTruthy();
  });

  it("INV-09: تحويل فوق المتاح موقوف بسبب ظاهر ولا يُحفظ شيء", async () => {
    await seed({ balance: { i1: "5000" } });
    const fetchImpl = server({
      "GET /api/inventory/transfers": [
        200,
        {
          branches: [
            { id: "b1", name: "الرئيسي" },
            { id: "b2", name: "بحري" },
          ],
        },
      ],
    });
    await renderWith(<TransferNewScreen viewId="" />, fetchImpl);
    await fireEvent.press(await screen.findByRole("button", { name: "بحري" }));
    await pickItem(tx("INV-09", "الصنف"), "سكر");
    await type(tx("INV-09", "كمية التحويل"), "9");
    await waitFor(() => expect(hint("INV-09")).toBe("validation_error"));
    expect(await screen.findByText(tx("INV-09", "الإرسال موقوف"))).toBeTruthy();
    await fireEvent.press(btn(tx("INV-09", "إرسال التحويل")));
    expect(await readLocalTransfers(storage)).toHaveLength(0);
  });

  it("INV-10: الاستلام الناقص يطلب سبباً، ثم يُحفظ محلياً بحالة conflict دون ترجيح", async () => {
    await seed({ branch: "b2" });
    const transfer = {
      id: "t1",
      transfer_number: "TRF-1",
      branch_from_id: "b1",
      branch_from_name: "الرئيسي",
      branch_to_id: "b2",
      branch_to_name: "بحري",
      status: "sent",
      user_name: "علي",
      sent_at: "2026-10-19T10:00:00.000Z",
      lines: [
        {
          id: "tl1",
          item_id: "i1",
          item_name: "سكر",
          unit_name: "كيلو",
          factor_milli: "1000",
          qty_milli: "5000",
          base_qty_milli: "5000",
          received_base_milli: "0",
          value_minor: "50000",
        },
      ],
    };
    await renderWith(
      <TransferReceiveScreen transferId="t1" />,
      server({ "GET /api/inventory/transfers/t1": [200, { transfer }] }),
    );
    const minus = await screen.findByLabelText(`${tx("INV-10", "نقص —")} سكر`);
    await fireEvent.press(minus);
    await fireEvent.press(screen.getByLabelText(`${tx("INV-10", "نقص —")} سكر`));
    await waitFor(() => expect(hint("INV-10")).toBe("partial"));
    const confirmName = new RegExp(tx("INV-10", "تأكيد استلام"));
    await fireEvent.press(screen.getByRole("button", { name: confirmName }));
    expect(
      (await screen.findAllByText(tx("INV-10", "سبب الفرق — إلزامي"), { exact: false })).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(tx("INV-10", "الفرعان يدّعيان رقمين"))).toBeNull();
    await type(tx("INV-10", "سبب الفرق — إلزامي"), "كرتونتان لم تصل");
    await fireEvent.press(screen.getByRole("button", { name: confirmName }));
    await waitFor(() => expect(hint("INV-10")).toBe("conflict"));
    expect(await screen.findByText(tx("INV-10", "الفرعان يدّعيان رقمين"))).toBeTruthy();
  });
});

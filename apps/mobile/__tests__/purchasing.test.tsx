import { MemoryStorage } from "@sting/platform/memory";
import { tx } from "@sting/texts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { CostMarginScreen } from "@/features/purchasing/cost-margin";
import { DocumentScreen } from "@/features/purchasing/document";
import { cachePut } from "@/features/purchasing/lib";
import { OrderNewScreen } from "@/features/purchasing/order-new";
import { OrdersScreen } from "@/features/purchasing/orders";
import { ReturnScreen } from "@/features/purchasing/return";
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
jest.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000001",
  getRandomValues: (a: Uint8Array) => a,
}));
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

const hint = (id: string) => screen.getByTestId(id).props.accessibilityHint as string;
const btn = (name: string) => screen.getByRole("button", { name });

let storage: MemoryStorage;
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

const ORDER = {
  id: "o1",
  number: "PO-1",
  supplier_id: "s1",
  supplier_name: "الأمل",
  status: "open",
  status_label: "مفتوح",
  status_hint: "ينتظر الاستلام",
  items_summary: "سكر",
  lines_count: 1,
  estimated_total_minor: "500000",
  value_hidden: false,
  created_by_name: "منى",
  created_at: new Date().toISOString(),
  sent_at: "",
  cancelled_reason: "",
};
const ORDERS = {
  orders: [ORDER],
  open_count: 1,
  closed_count: 0,
  scope: "open",
  supplier_id: "",
  suppliers: [{ id: "s1", name: "الأمل" }],
  can_create: true,
  value_hidden: false,
  ask_name: "",
  last_closed: null,
  as_of: "",
};
const DOC = {
  id: "d1",
  number: "PD-1",
  order_id: "o1",
  order_number: "PO-1",
  supplier_name: "الأمل",
  branch_name: "الرئيسي",
  supplier_invoice_number: "",
  status: "draft",
  status_label: "مسوّدة",
  total_minor: "500000",
  order_estimated_minor: "500000",
  diff_count: 0,
  due_days: 30,
  lines: [
    {
      id: "l1",
      item_name: "سكر",
      unit_name: "كرتون",
      ordered_qty_milli: "8000",
      received_qty_milli: "8000",
      unit_price_minor: "62500",
      est_unit_price_minor: "62500",
      line_total_minor: "500000",
      excess_reason: "",
      returned_qty_milli: "0",
      diff: "",
    },
  ],
  approved_by_name: "",
  approved_at: "",
  referred_to_name: "المالك",
  effects: {},
  blockers: [] as unknown[],
  approval: { viewer_name: "منى", limit_minor: "1000000", over_limit: false, can_approve: true },
};

describe("M4 — المشتريات (PUR-01…PUR-05)", () => {
  it("PUR-01: ready من الخادم، ثم بلا شبكة تُعرض النسخة المحفوظة بحالة stale", async () => {
    await renderWith(
      <OrdersScreen />,
      server({ "GET /api/inventory/purchasing/orders": [200, ORDERS] }),
    );
    await waitFor(() => expect(hint("PUR-01")).toBe("ready"));
    expect(
      await screen.findByText(tx("PUR-01", "أوامر الشراء الداخلية — الأمر وعدٌ لا التزام")),
    ).toBeTruthy();
    await cleanup();
    await renderWith(<OrdersScreen />);
    await waitFor(() => expect(hint("PUR-01")).toBe("stale"));
  });

  it("PUR-01: بلا شبكة ولا نسخة محفوظة = offline؛ و403 = permission_denied باسم الدور", async () => {
    await renderWith(<OrdersScreen />);
    await waitFor(() => expect(hint("PUR-01")).toBe("offline"));
    await cleanup();
    await renderWith(
      <OrdersScreen />,
      server({ "GET /api/inventory/purchasing/orders": [403, { role_name: "كاشير" }] }),
    );
    await waitFor(() => expect(hint("PUR-01")).toBe("permission_denied"));
    expect(await screen.findByText(/كاشير/)).toBeTruthy();
  });

  it("PUR-01: أمين المخزن — عمود القيمة محجوب والإنشاء معطّل بسبب ظاهر", async () => {
    await renderWith(
      <OrdersScreen />,
      server({
        "GET /api/inventory/purchasing/orders": [
          200,
          { ...ORDERS, value_hidden: true, can_create: false, ask_name: "سالم" },
        ],
      }),
    );
    await waitFor(() => expect(hint("PUR-01")).toBe("permission_denied"));
    expect(await screen.findByText(/اطلب من سالم/)).toBeTruthy();
  });

  it("PUR-02: كمية بلا وحدة تمنع الحفظ (validation_error) ولا يُرسل شيء", async () => {
    const posted = jest.fn();
    const base = server({
      "GET /api/inventory/purchasing/orders": [200, ORDERS],
      "GET /api/catalog/items": [
        200,
        {
          items: [
            {
              id: "i1",
              name: "سكر",
              base_unit_code: "kg",
              base_unit_name: "كيلو",
              base_unit_decimal_places: 0,
              units: [{ code: "ctn", name: "كرتون", factor_milli: "10000" }],
            },
          ],
        },
      ],
      "POST /api/inventory/purchasing/orders/preview": [
        200,
        {
          supplier: { id: "s1", name: "الأمل" },
          lines: [],
          errors: [{ line: 0, code: "unit_required", item_name: "سكر", qty_milli: "5000" }],
          estimated_total_minor: "",
          estimated_partial: false,
          supplier_known_items: 1,
        },
      ],
      "POST /api/inventory/purchasing/orders": [200, { order: { id: "o9" } }],
    });
    const spy = ((input: RequestInfo | URL, init?: RequestInit) => {
      const req = input as Request;
      if (req.method === "POST" && new URL(req.url).pathname.endsWith("/orders")) posted();
      return base(input, init);
    }) as typeof fetch;
    await renderWith(<OrderNewScreen />, spy);
    await fireEvent.press(await screen.findByRole("button", { name: tx("PUR-02", "الصنف") }));
    await fireEvent.press(await screen.findByText("سكر"));
    await fireEvent.changeText(screen.getByLabelText(tx("PUR-02", "الكمية")), "5");
    await fireEvent.press(btn(tx("PUR-02", "حفظ وإرسال")));
    await waitFor(() => expect(hint("PUR-02")).toBe("validation_error"));
    expect(posted).not.toHaveBeenCalled();
  });

  it("PUR-02: بلا شبكة الحفظ لا يضيع بصمت — حالة offline وسبب ظاهر", async () => {
    await cachePut("orders.open.", ORDERS);
    await cachePut("catalog_items", {
      items: [
        {
          id: "i1",
          name: "سكر",
          base_unit_code: "kg",
          base_unit_name: "كيلو",
          base_unit_decimal_places: 0,
          units: [],
        },
      ],
    });
    await renderWith(<OrderNewScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: tx("PUR-02", "الصنف") }));
    await fireEvent.press(await screen.findByText("سكر"));
    await fireEvent.press(btn(tx("PUR-02", "حفظ وإرسال")));
    await waitFor(() => expect(hint("PUR-02")).toBe("offline"));
  });

  it("PUR-03: الاعتماد يحفظ ثم يعتمد فيصير success؛ والزرّ مثبّت مع المبلغ", async () => {
    await renderWith(
      <DocumentScreen documentId="d1" />,
      server({
        "GET /api/inventory/purchasing/documents/d1": [200, { document: DOC }],
        "PATCH /api/inventory/purchasing/documents/d1": [
          200,
          { document: { ...DOC, supplier_invoice_number: "INV-9" } },
        ],
        "POST /api/inventory/purchasing/documents/d1/approve": [
          200,
          {
            document: {
              ...DOC,
              status: "approved",
              status_label: "معتمد",
              supplier_invoice_number: "INV-9",
              approved_by_name: "منى",
              effects: {
                stock: [{ item_name: "سكر", qty_milli: "8000", unit_name: "كراتين" }],
                branch_name: "الرئيسي",
                payable_minor: "500000",
              },
            },
          },
        ],
      }),
    );
    await waitFor(() => expect(hint("PUR-03")).toBe("ready"));
    await fireEvent.changeText(screen.getByLabelText(tx("PUR-03", "رقم فاتورة المورد")), "INV-9");
    await fireEvent.press(btn(`${tx("PUR-03", "اعتمد باسم")} منى`));
    await waitFor(() => expect(hint("PUR-03")).toBe("success"));
    expect(
      await screen.findByText(tx("PUR-03", "تحرّك المخزون وتحرّكت الذمّة الآن.")),
    ).toBeTruthy();
  });

  it("PUR-03: بلا رقم فاتورة = validation_error، وفوق الحدّ = permission_denied بزرّ إحالة", async () => {
    await renderWith(
      <DocumentScreen documentId="d1" />,
      server({
        "GET /api/inventory/purchasing/documents/d1": [200, { document: DOC }],
        "PATCH /api/inventory/purchasing/documents/d1": [
          200,
          { document: { ...DOC, blockers: [{ code: "invoice_number_required" }] } },
        ],
      }),
    );
    await waitFor(() => expect(hint("PUR-03")).toBe("ready"));
    await fireEvent.press(btn(`${tx("PUR-03", "اعتمد باسم")} منى`));
    await waitFor(() => expect(hint("PUR-03")).toBe("validation_error"));
    await cleanup();
    await renderWith(
      <DocumentScreen documentId="d1" />,
      server({
        "GET /api/inventory/purchasing/documents/d1": [
          200,
          { document: { ...DOC, approval: { ...DOC.approval, over_limit: true } } },
        ],
      }),
    );
    await waitFor(() => expect(hint("PUR-03")).toBe("permission_denied"));
    expect(screen.queryByRole("button", { name: /اعتمد باسم/ })).toBeNull();
    expect(btn(`${tx("PUR-03", "أحِل إلى")} المالك`)).toBeTruthy();
  });

  it("PUR-04: ردّ أكثر من المستلم أو بلا سبب = validation_error ولا يُسجَّل", async () => {
    const detail = {
      document: { ...DOC, status: "approved" },
      return_limits: { l1: 8000 },
      returns: [],
    };
    await renderWith(
      <ReturnScreen documentId="d1" />,
      server({ "GET /api/inventory/purchasing/documents/d1": [200, detail] }),
    );
    await waitFor(() => expect(hint("PUR-04")).toBe("ready"));
    await fireEvent.changeText(screen.getByLabelText(`${tx("PUR-04", "يُردّ —")} سكر`), "9");
    await fireEvent.press(btn(tx("PUR-04", "سجّل المرتجع")));
    await waitFor(() => expect(hint("PUR-04")).toBe("validation_error"));
    expect(await screen.findByText(tx("PUR-04", "ردٌّ أكثر مما استُلم"))).toBeTruthy();
  });

  it("PUR-04: مرتجع مرفوض جزئياً = partial", async () => {
    const ret = {
      id: "r1",
      number: "R-1",
      document_id: "d1",
      document_number: "PD-1",
      supplier_name: "الأمل",
      status: "partial",
      status_label: "رُدّ جزئياً",
      total_minor: "125000",
      accepted_minor: "62500",
      rejected_minor: "62500",
      supplier_note: "تالف",
      responded_at: "",
      lines: [
        {
          id: "rl1",
          document_line_id: "l1",
          item_name: "سكر",
          unit_name: "كرتون",
          qty_milli: "2000",
          unit_price_minor: "62500",
          line_total_minor: "125000",
          reason: "تالف",
          accepted_qty_milli: "1000",
          supplier_note: "",
        },
      ],
    };
    await renderWith(
      <ReturnScreen returnId="r1" />,
      server({
        "GET /api/inventory/purchasing/returns/r1": [200, { return: ret }],
        "GET /api/inventory/purchasing/documents/d1": [
          200,
          { document: { ...DOC, status: "approved" }, return_limits: {}, returns: [ret] },
        ],
      }),
    );
    await waitFor(() => expect(hint("PUR-04")).toBe("partial"));
  });

  it("PUR-05: phase_locked كما هو، والمحجوب = permission_denied، وبلا شبكة offline", async () => {
    await renderWith(
      <CostMarginScreen />,
      server({
        "GET /api/inventory/purchasing/cost-margin": [
          200,
          {
            state: "phase_locked",
            policy: "",
            can_enable: true,
            items_count: 1,
            rows: [
              {
                item_name: "سكر",
                sale_price_minor: "10000",
                cost_minor: "8000",
                method_label: "متوسط",
                margin_bps: 2000,
                note: "example",
              },
            ],
          },
        ],
      }),
    );
    await waitFor(() => expect(hint("PUR-05")).toBe("phase_locked"));
    expect(btn(tx("PUR-05", "فعّل الشراء الداخلي"))).toBeTruthy();
    await cleanup();
    await renderWith(
      <CostMarginScreen />,
      server({
        "GET /api/inventory/purchasing/cost-margin": [403, { extra: { role_name: "كاشير" } }],
      }),
    );
    await waitFor(() => expect(hint("PUR-05")).toBe("permission_denied"));
    await cleanup();
    setStorageForTests(new MemoryStorage());
    await renderWith(<CostMarginScreen />);
    await waitFor(() => expect(hint("PUR-05")).toBe("offline"));
  });
});

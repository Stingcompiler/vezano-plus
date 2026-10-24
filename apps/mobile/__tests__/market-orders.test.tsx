import { MemoryStorage } from "@sting/platform/memory";
import { tx } from "@sting/texts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import Cart from "@/app/market/cart";
import Checkout from "@/app/market/checkout";
import Orders from "@/app/market/orders/index";
import Recover from "@/app/market/orders/recover";
import CancelRemaining from "@/app/market/orders/[id]/cancel-remaining";
import OrderDetail from "@/app/market/orders/[id]/index";
import Restore from "@/app/market/orders/[id]/restore";
import Ship from "@/app/market/orders/[id]/ship";
import {
  CART_KEY,
  type CartLine,
  readAttempt,
  readCart,
  writeSnap,
} from "@/features/market-orders/lib";
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
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** خادم وهمي بمفتاح «METHOD /path» (المسار بلا الاستعلام) يسجّل الطلبات. */
function server(routes: Record<string, (req: Request) => Response | Promise<Response>>) {
  const calls: Request[] = [];
  const bodies: unknown[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    calls.push(req);
    if (req.method !== "GET")
      bodies.push(
        await req
          .clone()
          .json()
          .catch(() => null),
      );
    const route = routes[`${req.method} ${new URL(req.url).pathname}`];
    return route ? route(req) : json(404, { detail: "not_found" });
  };
  return { impl: impl, calls, bodies };
}
const renderWith = (ui: ReactElement, fetchImpl: typeof fetch = down) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SessionProvider fetchImpl={fetchImpl} initial={ACTIVE}>
        {ui}
      </SessionProvider>
    </SafeAreaProvider>,
  );
const stateOf = (id: string) => screen.getByTestId(id).props.accessibilityHint as string;

const LINE: CartLine = {
  offer_id: "o1",
  seller_tenant_id: "s1",
  seller_name: "مخازن النيل",
  public_name: "سكر",
  pack_label: "كيس 50 كغ",
  unit_name: "كيس",
  price_minor: "1500000",
  currency: "SDG",
  confirmed_at: "2026-10-19",
  valid_until: "2026-10-30",
  qty: 4,
  min_order_qty: 2,
  fees_label: "التوصيل مجاني",
};
const verifiedLine = (over: Record<string, unknown> = {}) => ({
  offer_id: "o1",
  unit_name: "كيس",
  qty: 4,
  draft_price_minor: "1500000",
  current_price_minor: "1500000",
  changed: false,
  expired: false,
  status: "confirmed",
  valid_until: "2026-10-30",
  min_order_qty: 2,
  short: 0,
  currency: "SDG",
  ...over,
});
const ORDER = {
  id: "ord1",
  op_id: "op1",
  number: 7,
  number_label: "ORD-7",
  kind: "order",
  kind_label: "طلب",
  status: "sent",
  status_label: "أُرسل",
  version: 1,
  supplier_tenant_id: "s1",
  supplier_name: "مخازن النيل",
  currency: "SDG",
  lines: [],
  lines_count: 1,
  total_minor: "6000000",
  delivery_to: "الفرع الرئيسي",
  fees_label: "",
  response_hours: 72,
  deadline_at: "2026-10-23T10:00:00Z",
  sent_at: "2026-10-20T10:00:00Z",
  updated_at: "2026-10-20T10:00:00Z",
  no_reply: false,
  near_deadline: false,
  remaining_hours: 70,
  content_line: "سكر × 4",
  buyer_step: "بانتظار رد المورد",
  supplier_step: "",
  flagged: false,
  list_status_label: "أُرسل",
  buyer_name: "المشتري",
};

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  setStorageForTests(storage);
  setSecretsForTests(null);
  mockParams = {};
  mockPush.mockClear();
  mockReplace.mockClear();
});
afterEach(async () => {
  await cleanup();
  setStorageForTests(null);
});

describe("ORD-01 السلة", () => {
  it("بلا اتصال -> offline: المسودة تُحفظ محلياً والإرسال بسبب ظاهر لا بصمت", async () => {
    await writeSnap(storage, CART_KEY, [LINE]);
    await renderWith(<Cart />, down);
    await waitFor(() => expect(stateOf("ORD-01")).toBe("offline"));
    expect(
      screen.getAllByText(
        tx("ORD-01", "الإرسال معطَّل حتى يعود الاتصال. لا رقم طلب قبل وصوله للمورد."),
      ).length,
    ).toBeGreaterThan(0);
    // تعديل الكمية يُحفظ محلياً بلا اتصال
    await fireEvent.changeText(screen.getByLabelText(`${tx("ORD-01", "الكمية —")} سكر`), "9");
    await waitFor(async () => expect((await readCart()).lines[0]?.qty).toBe(9));
    await fireEvent.press(screen.getByText(tx("ORD-01", "حفظ المسودة على الجهاز")));
    await waitFor(() => expect(screen.getByText(tx("ORD-01", "حُفظت المسودة"))).toBeTruthy());
  });

  it("السعر تغيّر -> stale بموافقة صريحة، والقبول يكتب السعر الجديد في المسودة", async () => {
    await writeSnap(storage, CART_KEY, [LINE]);
    const s = server({
      "POST /api/market/orders/verify": () =>
        json(200, {
          lines: [verifiedLine({ changed: true, current_price_minor: "1600000" })],
        }),
    });
    await renderWith(<Cart />, s.impl);
    await waitFor(() => expect(stateOf("ORD-01")).toBe("stale"));
    await fireEvent.press(screen.getByText(tx("ORD-01", "اقبل السعر الجديد")));
    await waitFor(async () => expect((await readCart()).lines[0]?.price_minor).toBe("1600000"));
  });

  it("تحت الحدّ الأدنى -> validation_error والمتابعة ممتنعة بسبب ظاهر", async () => {
    await writeSnap(storage, CART_KEY, [{ ...LINE, qty: 1 }]);
    const s = server({
      "POST /api/market/orders/verify": () => json(200, { lines: [verifiedLine({ qty: 1 })] }),
    });
    await renderWith(<Cart />, s.impl);
    await waitFor(() => expect(stateOf("ORD-01")).toBe("validation_error"));
    expect(
      screen.getByText(tx("ORD-01", "أكمل الحدّ الأدنى واقبل الأسعار الجديدة أولاً")),
    ).toBeTruthy();
  });

  it("سلة فارغة -> empty", async () => {
    await renderWith(<Cart />, down);
    await waitFor(() => expect(stateOf("ORD-01")).toBe("empty"));
  });
});

describe("ORD-02 المراجعة والإرسال", () => {
  it("انقطاع أثناء الإرسال -> server_error، والمعرّف محفوظ فتعيد المحاولة الطلب نفسه", async () => {
    await writeSnap(storage, CART_KEY, [LINE]);
    mockParams = { supplier: "s1" };
    let posts = 0;
    const s = server({
      "POST /api/market/orders/verify": () =>
        json(200, { lines: [verifiedLine()], responsibilities: [], response_hours: 72 }),
      "POST /api/market/orders": () => {
        posts += 1;
        if (posts === 1) throw new TypeError("Network request failed");
        return json(200, { order: ORDER, created: true });
      },
    });
    await renderWith(<Checkout />, s.impl);
    await waitFor(() => expect(screen.getByText(tx("ORD-02", "أرسل الطلب"))).toBeTruthy());
    await fireEvent.press(screen.getByText(tx("ORD-02", "أرسل الطلب")));
    await waitFor(() => expect(stateOf("ORD-02")).toBe("server_error"));
    const attempts = s.bodies.filter((b) => (b as { op_id?: string } | null)?.op_id);
    const op = (attempts[0] as { op_id: string }).op_id;
    expect((await readAttempt(op))?.supplier_tenant_id).toBe("s1");
    await fireEvent.press(screen.getByText(tx("ORD-02", "أعد المحاولة بالمعرّف نفسه")));
    await waitFor(() => expect(stateOf("ORD-02")).toBe("success"));
    const ids = s.bodies
      .map((b) => (b as { op_id?: string } | null)?.op_id)
      .filter((x): x is string => Boolean(x));
    expect(new Set(ids).size).toBe(1); // لا طلب ثانٍ بمعرّف جديد
    expect((await readCart()).lines).toHaveLength(0); // السلة تُفرَّغ بعد الوصول فقط
  });

  it("بند انتهى تأكيده -> expired والإرسال للمؤكَّد وحده بلا حذف صامت", async () => {
    await writeSnap(storage, CART_KEY, [LINE]);
    mockParams = { supplier: "s1" };
    const s = server({
      "POST /api/market/orders/verify": () =>
        json(200, {
          lines: [verifiedLine({ expired: true, status: "expired" })],
          responsibilities: [],
          response_hours: 72,
        }),
    });
    await renderWith(<Checkout />, s.impl);
    await waitFor(() => expect(stateOf("ORD-02")).toBe("expired"));
    expect(screen.getByText(tx("ORD-02", "لا بند مؤكداً للإرسال"))).toBeTruthy();
  });
});

describe("ORD-03 طلباتي", () => {
  it("بلا اتصال مع مسودة -> pending_sync بلا رقم طلب", async () => {
    await writeSnap(storage, CART_KEY, [LINE]);
    await renderWith(<Orders />, down);
    await waitFor(() => expect(stateOf("ORD-03")).toBe("pending_sync"));
    expect(screen.getByText(tx("ORD-03", "مسودة"))).toBeTruthy();
  });

  it("بلا اتصال مع لقطة -> stale وتُعرض آخر قائمة", async () => {
    await writeSnap(storage, "market.orders", {
      orders: [ORDER],
      awaiting_count: 1,
      hidden_by_filter: 0,
      fetched_at: "",
    });
    await renderWith(<Orders />, down);
    await waitFor(() => expect(stateOf("ORD-03")).toBe("stale"));
    expect(screen.getByText("مخازن النيل")).toBeTruthy();
  });
});

describe("ORD-05 تفاصيل الطلب", () => {
  it("404 -> permission_denied (الرابط لم يعد صالحاً)", async () => {
    mockParams = { id: "zz" };
    await renderWith(<OrderDetail />, server({}).impl);
    await waitFor(() => expect(stateOf("ORD-05")).toBe("permission_denied"));
  });
});

describe("ORD-08 الشحن الجزئي", () => {
  const SHIP = {
    order: ORDER,
    lines: [
      {
        offer_id: "o1",
        public_name: "سكر",
        pack_label: "كيس",
        unit_name: "كيس",
        confirmed: 4,
        shipped: 1,
        remaining: 3,
      },
    ],
    shipments: [],
    next_ref: "SH-01",
    percent: 0,
    can_ship: true,
    side: "supplier",
  };

  it("كمية تتجاوز المتبقّي -> validation_error ولا طلب يُرسل", async () => {
    mockParams = { id: "ord1" };
    const s = server({ "GET /api/market/orders/ord1/shipments": () => json(200, SHIP) });
    await renderWith(<Ship />, s.impl);
    await waitFor(() => expect(stateOf("ORD-08")).toBe("ready"));
    await fireEvent.changeText(screen.getByLabelText(`${tx("ORD-08", "هذه الشحنة —")} سكر`), "9");
    await fireEvent.press(screen.getByText(`${tx("ORD-08", "احفظ الشحنة")} SH-01`));
    await waitFor(() => expect(stateOf("ORD-08")).toBe("validation_error"));
    expect(s.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});

describe("ORD-10 إلغاء المتبقّي", () => {
  it("من لا يملك حدّاً مالياً -> permission_denied بطلب إلغاء من المالك", async () => {
    mockParams = { id: "ord1" };
    const s = server({
      "GET /api/market/orders/ord1/cancel-remaining": () =>
        json(200, {
          lines: [
            {
              offer_id: "o1",
              public_name: "سكر",
              pack_label: "كيس",
              unit_name: "كيس",
              confirmed: 4,
              shipped: 1,
              received: 1,
              in_transit: 0,
              cancellable: 3,
              already_cancelled: 0,
              price_minor: "1500000",
            },
          ],
          cancellable_total: 3,
          received_total: 1,
          in_transit_total: 0,
          received_value_minor: "1500000",
          shipment_refs: ["SH-01"],
          full_cancel_available: false,
          already_cancelled: false,
          cancel_reason: "",
          order: ORDER,
          can_cancel: false,
        }),
    });
    await renderWith(<CancelRemaining />, s.impl);
    await waitFor(() => expect(stateOf("ORD-10")).toBe("permission_denied"));
    expect(screen.getByText(tx("ORD-10", "طلب إلغاء من المالك"))).toBeTruthy();
  });
});

describe("ORD-14 ردّ مفقود", () => {
  it("محاولة محفوظة بلا استعلام -> server_error، والاستعلام بحمولة مختلفة -> conflict", async () => {
    await storage.transaction((t) =>
      t.putMeta(
        "market.checkout.attempt.op-9",
        JSON.stringify({
          op_id: "op-9",
          supplier_tenant_id: "s1",
          kind: "order",
          delivery_to: "الفرع الرئيسي",
          note: "",
          lines: [{ offer_id: "o1", qty: 4, price_minor: "1500000" }],
          at: "2026-10-20T10:00:00Z",
        }),
      ),
    );
    mockParams = { op: "op-9" };
    const s = server({
      "POST /api/market/orders/probe": () =>
        json(200, {
          found: true,
          order: ORDER,
          same_payload: false,
          diff: [
            {
              offer_id: "o1",
              public_name: "سكر",
              server_qty: 5,
              server_price_minor: "1500000",
              local_qty: 4,
              local_price_minor: "1500000",
            },
          ],
        }),
    });
    await renderWith(<Recover />, s.impl);
    await waitFor(() => expect(stateOf("ORD-14")).toBe("server_error"));
    await fireEvent.press(screen.getByText(tx("ORD-14", "استعلام عن حالة الإرسال")));
    await waitFor(() => expect(stateOf("ORD-14")).toBe("conflict"));
    // الاستعلام لا ينشئ طلباً: لا POST غير الاستعلام
    expect(s.calls.map((c) => new URL(c.url).pathname)).toEqual(["/api/market/orders/probe"]);
  });
});

describe("ORD-15 الاستعادة", () => {
  const RESTORE = {
    order: ORDER,
    side: "buyer",
    restore_point: "2026-10-20T08:00:00Z",
    reconciling: true,
    can_review: false,
    pending: [
      {
        id: "e1",
        kind: "ship",
        side: "supplier",
        title: "شحنة SH-02",
        detail: "",
        ref_label: "",
        at: "2026-10-20T09:00:00Z",
        needs_decision: true,
        decision: "",
        decision_reason: "",
      },
    ],
    decided: [],
    confirmed: [],
    blocked_transfers: [],
  };

  it("مراجعة بلا صلاحية -> permission_denied", async () => {
    mockParams = { id: "ord1" };
    const s = server({ "GET /api/market/orders/ord1/restore": () => json(200, RESTORE) });
    await renderWith(<Restore />, s.impl);
    await waitFor(() => expect(stateOf("ORD-15")).toBe("stale"));
    await fireEvent.press(screen.getByText(/ابدأ المراجعة/));
    await waitFor(() => expect(stateOf("ORD-15")).toBe("permission_denied"));
  });

  it("مراجعة بصلاحية -> conflict بقرار صريح لكل حدث", async () => {
    mockParams = { id: "ord1" };
    const s = server({
      "GET /api/market/orders/ord1/restore": () => json(200, { ...RESTORE, can_review: true }),
    });
    await renderWith(<Restore />, s.impl);
    await waitFor(() => expect(stateOf("ORD-15")).toBe("stale"));
    await fireEvent.press(screen.getByText(/ابدأ المراجعة/));
    await waitFor(() => expect(stateOf("ORD-15")).toBe("conflict"));
    expect(screen.getByText(tx("ORD-15", "تركه ملغى يحتاج سبباً"))).toBeTruthy();
  });
});

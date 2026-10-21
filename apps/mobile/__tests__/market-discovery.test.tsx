import { MemoryStorage } from "@sting/platform/memory";
import { tx } from "@sting/texts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import Following from "@/app/market/following";
import MarketHome from "@/app/market/index";
import InviteOpen from "@/app/market/i/[token]";
import Offer from "@/app/market/offers/public/[id]";
import Report from "@/app/market/report";
import Search from "@/app/market/search";
import Unavailable from "@/app/market/unavailable";
import { CART_KEY, type CartLine } from "@/features/market-discovery/lib";
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
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** خادم وهمي بمفتاح «METHOD /path» (المسار بلا الاستعلام). */
function server(routes: Record<string, (req: Request) => Response>) {
  const calls: Request[] = [];
  const impl = (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    calls.push(req);
    const route = routes[`${req.method} ${new URL(req.url).pathname}`];
    return Promise.resolve(route ? route(req) : json(404, { detail: "not_found" }));
  };
  return { impl: impl, calls };
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

const SUPPLIER = {
  tenant_id: "s1",
  public_name: "مخازن النيل",
  category_line: "بقالة",
  categories: ["بقالة"],
  service_areas: ["الخرطوم"],
  fulfilment: ["توصيل"],
  offers_count: 3,
  badge: "verified",
  badge_label: "متحققة",
};
const HOME = {
  area: "",
  areas: [{ name: "الخرطوم", suppliers: 1 }],
  q: "",
  suppliers: [SUPPLIER],
  offers_by_unit: [],
  offers_count: 3,
  suppliers_count: 1,
  fetched_at: "2026-10-20T10:00:00Z",
};
const OFFER = {
  id: "o1",
  seller_tenant_id: "s1",
  seller_name: "مخازن النيل",
  public_name: "سكر",
  unit_name: "كيس",
  pack_label: "كيس 50 كغ",
  price_minor: "1500000",
  price_line: "",
  availability: "متوفر",
  confirmed_until: "2026-10-30",
  min_order_qty: 2,
  seller_badge: "verified",
  seller_badge_label: "متحققة",
  description: "",
  unit_price_minor: "30000",
  base_unit_name: "كغ",
  fees_decided: true,
  fees_label: "التوصيل مجاني",
  audience: "public",
  audience_label: "عام",
  currency: "SDG",
  buyer_currency: "SDG",
  currency_mismatch: false,
  confirmed_at: "2026-10-19",
  days_since_confirmed: 1,
  valid_until: "2026-10-30",
  expired: false,
  withdrawn: false,
  tiers: [],
  others: [],
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

describe("MP-01 رئيسية السوق", () => {
  it("online -> ready مع قائمة الموردين ولقطة تُحفظ", async () => {
    const s = server({ "GET /api/public/market": () => json(200, HOME) });
    await renderWith(<MarketHome />, s.impl);
    await waitFor(() => expect(stateOf("MP-01")).toBe("ready"));
    expect(screen.getByText("مخازن النيل")).toBeTruthy();
    await waitFor(async () =>
      expect(await storage.read((t) => t.getMeta("market.home"))).toContain("مخازن النيل"),
    );
  });

  it("بلا اتصال ولا لقطة -> offline (لا أسعار الآخرين محلياً)", async () => {
    await renderWith(<MarketHome />, down);
    await waitFor(() => expect(stateOf("MP-01")).toBe("offline"));
    expect(screen.getAllByText(tx("MP-01", "السوق يحتاج اتصالاً")).length).toBeGreaterThan(0);
  });

  it("بلا اتصال مع لقطة -> stale وتُعرض آخر قائمة", async () => {
    await storage.transaction((t) =>
      t.putMeta("market.home", JSON.stringify({ at: new Date().toISOString(), data: HOME })),
    );
    await renderWith(<MarketHome />, down);
    await waitFor(() => expect(stateOf("MP-01")).toBe("stale"));
    expect(screen.getByText("مخازن النيل")).toBeTruthy();
  });

  it("فشل الخادم بلا كاش -> server_error بإعادة محاولة (§١٦٠) لا «لا موردين»", async () => {
    const s = server({ "GET /api/public/market": () => json(500, { detail: "boom" }) });
    await renderWith(<MarketHome />, s.impl);
    await waitFor(() => expect(stateOf("MP-01")).toBe("server_error"));
    expect(screen.getByText(tx("MP-01", "أعد المحاولة"))).toBeTruthy();
  });

  it("الفارغ -> empty", async () => {
    const s = server({
      "GET /api/public/market": () => json(200, { ...HOME, suppliers: [], offers_count: 0 }),
    });
    await renderWith(<MarketHome />, s.impl);
    await waitFor(() => expect(stateOf("MP-01")).toBe("empty"));
  });
});

describe("MP-04 البحث والمقارنة", () => {
  it("وحدات متعددة -> partial (لا «الأرخص»)", async () => {
    const row = { ...OFFER, ranked: true, expired_yesterday: false, min_order_label: "حد أدنى 2" };
    const s = server({
      "GET /api/public/market/search": () =>
        json(200, {
          q: "سكر",
          area: "",
          groups: [
            { label: "كيس", count: 1, rankable: 1, offers: [row] },
            { label: "كرتونة", count: 1, rankable: 1, offers: [{ ...row, id: "o2" }] },
          ],
          offers_count: 2,
          suppliers_count: 1,
          multi_unit: true,
          all_areas_count: 2,
          fetched_at: "",
        }),
    });
    mockParams = { q: "سكر" };
    await renderWith(<Search />, s.impl);
    await waitFor(() => expect(stateOf("MP-04")).toBe("partial"));
    expect(
      screen.getByText(tx("MP-04", "نتائجك بوحدتين مختلفتين، فلا يوجد «الأرخص».")),
    ).toBeTruthy();
  });
});

describe("MP-05 تفاصيل عرض", () => {
  it("الإضافة تجلب تأكيداً خادمياً ثم تثبّت السطر في السلة المحلية", async () => {
    const s = server({ "GET /api/market/offers/public/o1": () => json(200, { offer: OFFER }) });
    mockParams = { id: "o1" };
    await renderWith(<Offer />, s.impl);
    await waitFor(() => expect(stateOf("MP-05")).toBe("ready"));
    const before = s.calls.length;
    await fireEvent.press(screen.getByText(tx("MP-05", "إضافة إلى السلة")));
    await waitFor(() =>
      expect(screen.getByText(tx("MP-05", "أُضيف إلى السلة بعد تأكيد خادمي"))).toBeTruthy(),
    );
    expect(s.calls.length).toBeGreaterThan(before); // جُلب التأكيد قبل التثبيت
    const raw = await storage.read((t) => t.getMeta(CART_KEY));
    const lines = (JSON.parse(raw ?? "{}") as { data: CartLine[] }).data;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ offer_id: "o1", qty: 2, price_minor: "1500000" });
  });

  it("المنتهي -> expired: آخر سعر معروف والإضافة ممتنعة بسبب ظاهر", async () => {
    const s = server({
      "GET /api/market/offers/public/o1": () =>
        json(200, { offer: { ...OFFER, expired: true, valid_until: "2026-10-01" } }),
    });
    mockParams = { id: "o1" };
    await renderWith(<Offer />, s.impl);
    await waitFor(() => expect(stateOf("MP-05")).toBe("expired"));
    expect(screen.getByText(tx("MP-05", "آخر سعر معروف للعبوة"))).toBeTruthy();
    expect(screen.getByText(tx("MP-05", "السعر منتهٍ ولا يصلح لتأكيد طلب"))).toBeTruthy();
    expect(screen.queryByText(tx("MP-05", "أُضيف إلى السلة بعد تأكيد خادمي"))).toBeNull();
    await fireEvent.press(screen.getByText(tx("MP-05", "إضافة إلى السلة — غير متاح")));
    expect(await storage.read((t) => t.getMeta(CART_KEY))).toBeNull();
  });

  it("عرض محجوب/مفقود (404) -> permission_denied", async () => {
    mockParams = { id: "zz" };
    await renderWith(<Offer />, server({}).impl);
    await waitFor(() => expect(stateOf("MP-05")).toBe("permission_denied"));
  });
});

describe("MP-06 المتابعة", () => {
  const F = {
    id: "f1",
    supplier_tenant_id: "s1",
    supplier_name: "مخازن النيل",
    status: "active",
    status_label: "نشطة",
    hint: "",
    suspended: false,
    followed_at: "",
    cancelled_at: "",
  };
  const P = { follows: [F], active_count: 1, can_follow: true, what_stops: [], what_stays: [] };

  it("بلا صلاحية -> permission_denied", async () => {
    const s = server({
      "GET /api/market/following": () => json(200, { ...P, can_follow: false }),
    });
    await renderWith(<Following />, s.impl);
    await waitFor(() => expect(stateOf("MP-06")).toBe("permission_denied"));
  });

  it("إلغاء المتابعة -> success بما يتوقف وما يبقى", async () => {
    const s = server({
      "GET /api/market/following": () => json(200, P),
      "POST /api/market/following/f1/unfollow": () =>
        json(200, { follow: { ...F, status: "cancelled" } }),
    });
    await renderWith(<Following />, s.impl);
    await waitFor(() => expect(stateOf("MP-06")).toBe("ready"));
    await fireEvent.press(screen.getByText(tx("MP-06", "إلغاء المتابعة")));
    await waitFor(() => expect(stateOf("MP-06")).toBe("success"));
    expect(screen.getByText(tx("MP-06", "لم يتوقف ولن يتوقف"))).toBeTruthy();
  });
});

describe("MP-07 رابط الدعوة", () => {
  it("رابط منتهٍ (410) -> expired: جديدٌ لا إحياء", async () => {
    mockParams = { token: "tok" };
    const s = server({ "GET /api/public/market/invite/tok": () => json(410, { detail: "gone" }) });
    await renderWith(<InviteOpen />, s.impl);
    await waitFor(() => expect(stateOf("MP-07")).toBe("expired"));
    expect(screen.getByText(tx("MP-07", "دعوة منتهية"))).toBeTruthy();
  });
});

describe("MP-14 معلّقة", () => {
  it("منشأة معلّقة -> permission_denied: الطلب الجديد موقوف بسبب ظاهر", async () => {
    mockParams = { supplier: "s1" };
    const s = server({
      "GET /api/public/market/suppliers/s1/status": () =>
        json(200, {
          supplier: {
            tenant_id: "s1",
            public_name: "مخازن النيل",
            suspended: true,
            suspended_line: "معلّقة منذ أمس",
            badge: "suspended",
            badge_label: "معلَّقة",
            blocked: [{ title: "طلب جديد", detail: "ممنوع" }],
            kept: [{ title: "الطلبات القائمة", detail: "تبقى" }],
          },
        }),
    });
    await renderWith(<Unavailable />, s.impl);
    await waitFor(() => expect(stateOf("MP-14")).toBe("permission_denied"));
    expect(
      screen.getByText(tx("MP-14", "النشر معلَّق — لا طلب جديد من هذه المنشأة حتى يُرفع التعليق")),
    ).toBeTruthy();
  });
});

describe("MP-15 البلاغ", () => {
  it("إرسال بلا سبب -> validation_error ولا طلب POST", async () => {
    mockParams = { offer: "o1" };
    const s = server({
      "GET /api/market/reports": () =>
        json(200, {
          reports: [],
          reasons: [
            { code: "impersonation", label: "انتحال", hint: "", needs_evidence: true },
            { code: "wrong_price", label: "سعر خاطئ", hint: "", needs_evidence: false },
          ],
        }),
      "GET /api/market/share/preview": () =>
        json(200, {
          preview: {
            kind: "offer",
            title: "سكر",
            subtitle: "",
            price_minor: "",
            price_line: "",
            path: "",
          },
        }),
    });
    await renderWith(<Report />, s.impl);
    await waitFor(() => expect(screen.getByText("انتحال")).toBeTruthy());
    await fireEvent.press(screen.getByText(tx("MP-15", "أرسل البلاغ")));
    await waitFor(() => expect(stateOf("MP-15")).toBe("validation_error"));
    expect(s.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("سبب «انتحال» بلا دليل لا يُرسل", async () => {
    mockParams = { supplier: "s1" };
    const s = server({
      "GET /api/market/reports": () =>
        json(200, {
          reports: [],
          reasons: [{ code: "impersonation", label: "انتحال", hint: "", needs_evidence: true }],
        }),
    });
    await renderWith(<Report />, s.impl);
    await waitFor(() => expect(screen.getByText("انتحال")).toBeTruthy());
    await fireEvent.press(screen.getByText("انتحال"));
    await fireEvent.press(screen.getByText(tx("MP-15", "أرسل البلاغ")));
    await waitFor(() => expect(stateOf("MP-15")).toBe("validation_error"));
    expect(s.calls.some((c) => c.method === "POST")).toBe(false);
  });
});

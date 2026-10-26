import { MemoryStorage } from "@sting/platform/memory";
import { tx } from "@sting/texts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import GrowPromote from "@/app/grow/promote";
import GrowReplenish from "@/app/grow/replenish";
import GrowSuppliers from "@/app/grow/suppliers";
import LinkDocuments from "@/app/market/link/documents";
import LinkItems from "@/app/market/link/items";
import LinkParties from "@/app/market/link/parties";
import LinkReturns from "@/app/market/link/returns";
import ListNew from "@/app/market/lists/new";
import Offers from "@/app/market/offers/index";
import OfferNew from "@/app/market/offers/new";
import Profile from "@/app/market/profile";
import Renewals from "@/app/market/renewals";
import Seller from "@/app/market/seller";
import "@/lib/crypto";
import { setSecretsForTests } from "@/lib/secrets";
import { ANONYMOUS, SessionProvider, type SessionState } from "@/lib/session";
import { setStorageForTests } from "@/lib/storage";

const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: jest.fn(), push: mockPush }),
  useLocalSearchParams: () => mockParams,
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
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
type Route = (req: Request) => Response | Promise<Response>;
let calls: string[] = [];
function server(routes: Record<string, Route>, down = false) {
  const impl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    if (down) throw new TypeError("Network request failed");
    const key = `${req.method} ${new URL(req.url).pathname}`;
    calls.push(key);
    const route = routes[key];
    return route ? route(req) : json(404, { detail: "not_found" });
  });
  return impl as unknown as typeof fetch;
}
const ACTIVE: SessionState = {
  ...ANONYMOUS,
  status: "active",
  tenantId: "t1",
  userId: "u1",
  setupDone: true,
  tokens: { access: "a", refresh: "r", sessionId: "s" },
};
const renderWith = (ui: ReactElement, fetchImpl: typeof fetch) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SessionProvider fetchImpl={fetchImpl} initial={ACTIVE}>
        {ui}
      </SessionProvider>
    </SafeAreaProvider>,
  );
const hint = (id: string) => screen.getByTestId(id).props.accessibilityHint as string;

let storage: MemoryStorage;
beforeEach(() => {
  calls = [];
  mockParams = {};
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

const NOW = new Date().toISOString();
const ACCOUNT = (over: Record<string, unknown> = {}) => ({
  account: {
    shop_name: "مخزن النور",
    role: "owner",
    verification: "draft",
    verification_label: "مسودة",
    checklist: [
      { key: "identity", title: "هوية المنشأة", hint: "", done: true, reason: "" },
      { key: "service_area", title: "منطقة الخدمة", hint: "", done: false, reason: "" },
    ],
    done: 1,
    total: 2,
    submitted_at: "",
    days_since_submitted: null,
    usual_review_days: 2,
    review_reasons: {},
    badge_limits: "حدود",
    can_submit: true,
    registry_doc_name: "",
    ...over,
  },
});

describe("MP-08 — تهيئة بائع", () => {
  it("قيد المراجعة: loading، والمعتمد: success، والمعطّل: permission_denied", async () => {
    await renderWith(
      <Seller />,
      server({
        "GET /api/market/account": () => json(200, ACCOUNT({ verification: "pending" })),
      }),
    );
    await waitFor(() => expect(hint("MP-08")).toBe("loading"));
    expect(screen.getByText(tx("MP-08", "قيد مراجعة المشرف"))).toBeTruthy();
  });

  it("معتمد: success وزر صفحة المنشأة", async () => {
    await renderWith(
      <Seller />,
      server({
        "GET /api/market/account": () => json(200, ACCOUNT({ verification: "verified" })),
      }),
    );
    await waitFor(() => expect(hint("MP-08")).toBe("success"));
    await fireEvent.press(screen.getByRole("button", { name: tx("MP-08", "صفحة المنشأة") }));
    expect(mockPush).toHaveBeenCalledWith("/market/profile");
  });

  it("غير المالك: permission_denied بنص الويب", async () => {
    await renderWith(
      <Seller />,
      server({ "GET /api/market/account": () => json(200, ACCOUNT({ can_submit: false })) }),
    );
    await waitFor(() => expect(hint("MP-08")).toBe("permission_denied"));
    expect(screen.getByText(tx("MP-08", "طلب التحقق للمالك"))).toBeTruthy();
  });

  it("بلا اتصال وبلا لقطة: offline؛ ومع لقطة: stale", async () => {
    await renderWith(<Seller />, server({}, true));
    await waitFor(() => expect(hint("MP-08")).toBe("offline"));
  });

  it("تقديم الطلب بلا اتصال لا يُسجَّل محلياً: ملاحظة تحتاج الخادم", async () => {
    await storage.transaction((t) =>
      t.putMeta("cache.market.seller", JSON.stringify({ at: NOW, data: ACCOUNT().account })),
    );
    await renderWith(<Seller />, server({}, true));
    await waitFor(() => expect(hint("MP-08")).toBe("stale"));
    await fireEvent.press(screen.getByRole("button", { name: tx("MP-08", "قدّم طلب التحقق") }));
    await waitFor(() => expect(screen.getByText(/يُسجَّل على الخادم مباشرة/)).toBeTruthy());
  });
});

const PROFILE = (canEdit: boolean, areas: string[] = []) => ({
  profile: {
    draft: {
      public_name: "مخزن النور",
      category_line: "جملة",
      categories: ["سكر"],
      service_areas: areas,
      fulfilment: [],
    },
    public: {
      public_name: "مخزن النور",
      category_line: "جملة",
      categories: ["سكر"],
      service_areas: areas,
      fulfilment: [],
      verified: false,
      badge_label: "",
      badge_note: "",
      published_at: "",
      is_published: false,
    },
    can_edit: canEdit,
    role_name: "مدير",
    portal_slug: "x",
    seller_verified: false,
    not_published: [],
  },
});

describe("MP-09 — صفحة المنشأة", () => {
  it("غير المالك: permission_denied بلا نموذج تحرير", async () => {
    await renderWith(
      <Profile />,
      server({ "GET /api/market/profile": () => json(200, PROFILE(false)) }),
    );
    await waitFor(() => expect(hint("MP-09")).toBe("permission_denied"));
    expect(screen.queryByText(tx("MP-09", "انشر الصفحة"))).toBeNull();
  });

  it("نشر بلا مناطق خدمة: validation_error دون أي طلب PUT", async () => {
    await renderWith(
      <Profile />,
      server({ "GET /api/market/profile": () => json(200, PROFILE(true)) }),
    );
    await waitFor(() => screen.getByRole("button", { name: tx("MP-09", "انشر الصفحة") }));
    await fireEvent.press(screen.getByRole("button", { name: tx("MP-09", "انشر الصفحة") }));
    await waitFor(() => expect(hint("MP-09")).toBe("validation_error"));
    expect(calls).not.toContain("PUT /api/market/profile");
    expect(screen.getByText(tx("MP-09", "مناطق خدمة فارغة"))).toBeTruthy();
  });

  it("حفظ مسودة: success بنص الويب", async () => {
    await renderWith(
      <Profile />,
      server({
        "GET /api/market/profile": () => json(200, PROFILE(true, ["بحري"])),
        "PUT /api/market/profile": () => json(200, PROFILE(true, ["بحري"])),
      }),
    );
    await waitFor(() => screen.getByRole("button", { name: tx("MP-09", "احفظ مسوّدة") }));
    await fireEvent.press(screen.getByRole("button", { name: tx("MP-09", "احفظ مسوّدة") }));
    await waitFor(() => expect(hint("MP-09")).toBe("success"));
    expect(screen.getByText(tx("MP-09", "حُفظت الصفحة"))).toBeTruthy();
  });
});

const OFFER = {
  id: "o1",
  item_id: "i1",
  public_name: "سكر أبيض",
  description: "",
  unit_code: "kg",
  unit_name: "كيلو",
  pack_label: "كيس 50",
  price_minor: "1250000",
  audience: "public",
  audience_label: "عام",
  min_order_qty: 5,
  max_order_qty: null,
  fulfilment_note: "",
  valid_until: "2026-12-31",
  status: "published",
  status_label: "منشور",
  meaning: "يظهر في البحث",
  missing: [],
};
const OFFERS = (total = 1) => ({
  offers: total ? [OFFER] : [],
  counts: { published: total, draft: 0, expired: 0, hidden: 0 },
  total,
  expiring_this_week: 0,
  can_edit: true,
  can_publish: true,
  seller_verified: true,
  plan_allows: true,
});

describe("MP-10 — عروض البائع", () => {
  it("قائمة ready، وفلتر المنتهي يعطي expired", async () => {
    await renderWith(<Offers />, server({ "GET /api/market/offers": () => json(200, OFFERS()) }));
    await waitFor(() => expect(hint("MP-10")).toBe("ready"));
    expect(screen.getByText("سكر أبيض")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: /منتهٍ/ }));
    await waitFor(() => expect(hint("MP-10")).toBe("expired"));
  });

  it("لا عروض: empty؛ وبلا اتصال مع لقطة: stale ويبقى المعروض", async () => {
    await renderWith(<Offers />, server({ "GET /api/market/offers": () => json(200, OFFERS(0)) }));
    await waitFor(() => expect(hint("MP-10")).toBe("empty"));
  });

  it("بلا اتصال مع لقطة: stale", async () => {
    await storage.transaction((t) =>
      t.putMeta("cache.market.offers", JSON.stringify({ at: NOW, data: OFFERS() })),
    );
    await renderWith(<Offers />, server({}, true));
    await waitFor(() => expect(hint("MP-10")).toBe("stale"));
    expect(screen.getByText("سكر أبيض")).toBeTruthy();
  });
});

describe("MP-11 — إنشاء عرض", () => {
  const preview = (missing: number, canPublish = true) => ({
    card: { title: "سكر", seller_line: "", price_minor: "", price_line: "اطلب تأكيد سعر" },
    published_fields: [],
    missing: Array.from({ length: missing }, (_, i) => ({
      key: `k${i}`,
      title: `حقل${i}`,
      hint: "",
    })),
    hidden_fields: [],
    can_publish: canPublish,
    seller_verified: true,
    plan_allows: true,
  });

  it("نشر بحقل ناقص: validation_error دون POST للعروض", async () => {
    await renderWith(
      <OfferNew />,
      server({
        "GET /api/catalog/items": () => json(200, { items: [] }),
        "POST /api/market/offers/preview": () => json(200, preview(1)),
        "POST /api/market/offers": () => json(200, { offer: OFFER }),
      }),
    );
    const label = `${tx("MP-11", "نشر")} — ${tx("MP-11", "حقل ناقص")}`;
    await waitFor(() => screen.getByRole("button", { name: label }));
    await fireEvent.press(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(hint("MP-11")).toBe("validation_error"));
    expect(calls).not.toContain("POST /api/market/offers");
  });

  it("ناشر الكتالوج: permission_denied وزر النشر معطّل بسببه", async () => {
    await renderWith(
      <OfferNew />,
      server({
        "GET /api/catalog/items": () => json(200, { items: [] }),
        "POST /api/market/offers/preview": () => json(200, preview(0, false)),
      }),
    );
    await waitFor(() => expect(hint("MP-11")).toBe("permission_denied"));
    expect(
      screen.getByText(tx("MP-11", "النشر النهائي بصلاحية أعلى — ناشر الكتالوج يحرّر المسودة")),
    ).toBeTruthy();
  });

  it("حفظ المسودة بلا اتصال لا يُسجَّل: ملاحظة الخادم", async () => {
    await renderWith(<OfferNew />, server({}, true));
    await waitFor(() => screen.getByRole("button", { name: tx("MP-11", "حفظ كمسودة") }));
    await fireEvent.press(screen.getByRole("button", { name: tx("MP-11", "حفظ كمسودة") }));
    await waitFor(() => expect(screen.getByText(/يُسجَّل على الخادم مباشرة/)).toBeTruthy());
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe("MP-12 — القوائم الخاصة", () => {
  it("فجوة بين شريحتين تمنع الحفظ: validation_error دون POST", async () => {
    mockParams = { offer: "o1" };
    await renderWith(
      <ListNew />,
      server({ "GET /api/market/lists": () => json(200, { lists: [] }) }),
    );
    await waitFor(() => screen.getByLabelText(`${tx("MP-12", "من — شريحة")} 1`));
    await fireEvent.changeText(screen.getByLabelText(`${tx("MP-12", "من — شريحة")} 1`), "1");
    await fireEvent.changeText(screen.getByLabelText(`${tx("MP-12", "إلى — شريحة")} 1`), "10");
    await fireEvent.press(screen.getByRole("button", { name: tx("MP-12", "أضف شريحة") }));
    await waitFor(() => screen.getByLabelText(`${tx("MP-12", "من — شريحة")} 2`));
    await fireEvent.changeText(screen.getByLabelText(`${tx("MP-12", "من — شريحة")} 2`), "20");
    await fireEvent.press(screen.getByRole("button", { name: tx("MP-12", "احفظ القائمة") }));
    await waitFor(() => expect(hint("MP-12")).toBe("validation_error"));
    expect(screen.getByText(tx("MP-12", "فجوة بين شريحتين تمنع الحفظ"))).toBeTruthy();
    expect(calls).not.toContain("POST /api/market/lists");
  });
});

const RENEW_OFFER = {
  ...OFFER,
  number: 3,
  confirmed_at: NOW,
  days_left: 5,
};
const RENEWALS = (canRenew = true) => ({
  offers: [RENEW_OFFER],
  can_renew: canRenew,
  renew_hours: 48,
  rules: [{ action: "تعديل الوصف", effect: "لا يجدّد", verdict: "لا يجدّد" }],
});

describe("MP-13 — تجديد التأكيد", () => {
  it("محرّر الوصف: permission_denied", async () => {
    await renderWith(
      <Renewals />,
      server({ "GET /api/market/renewals": () => json(200, RENEWALS(false)) }),
    );
    await waitFor(() => expect(hint("MP-13")).toBe("permission_denied"));
  });

  it("تجديد ناجح: success ثم إعادة الجلب", async () => {
    await renderWith(
      <Renewals />,
      server({
        "GET /api/market/renewals": () => json(200, RENEWALS()),
        "POST /api/market/offers/o1/renew": () => json(200, { offer: RENEW_OFFER }),
      }),
    );
    await waitFor(() => screen.getByRole("button", { name: tx("MP-13", "تجديد التأكيد") }));
    await fireEvent.press(screen.getByRole("button", { name: tx("MP-13", "تجديد التأكيد") }));
    await waitFor(() => expect(hint("MP-13")).toBe("success"));
    expect(screen.getByText(tx("MP-13", "جُدِّد التأكيد"))).toBeTruthy();
  });

  it("التجديد بلا اتصال لا يُسجَّل محلياً (لقطة stale)", async () => {
    await storage.transaction((t) =>
      t.putMeta("cache.market.renewals", JSON.stringify({ at: NOW, data: RENEWALS() })),
    );
    await renderWith(<Renewals />, server({}, true));
    await waitFor(() => expect(hint("MP-13")).toBe("stale"));
    await fireEvent.press(screen.getByRole("button", { name: tx("MP-13", "تجديد التأكيد") }));
    await waitFor(() => expect(screen.getByText(/يُسجَّل على الخادم مباشرة/)).toBeTruthy());
    expect(hint("MP-13")).toBe("stale");
  });
});

describe("LINK/GROW — المراحل المقفلة تُنقل كما في الويب", () => {
  it("LINK-01 بحمولة phase_locked: القفل والنص الحرفي والبديل الحاضر", async () => {
    await renderWith(
      <LinkParties />,
      server({
        "GET /api/market/link/parties": () =>
          json(200, { state: "phase_locked", can_link: true, parties: [], linked_count: 0 }),
      }),
    );
    await waitFor(() => expect(hint("LINK-01")).toBe("phase_locked"));
    expect(
      screen.getByText(
        tx("shared:features/phase/phase-screen-client.tsx", "مرحلة الربط لم تُفتح بعد"),
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        tx(
          "shared:features/phase/phase-screens.ts",
          "«ربط الأطراف بالسوق يُفتح في مرحلة لاحقة. حتى ذلك الحين يعمل دفترك كاملاً وأطرافك المحلية كما هي — لا ينقصك شيء اليوم.»",
        ),
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "الأطراف في دفترك" }));
    expect(mockPush).toHaveBeenCalledWith("/parties");
  });

  it("GROW-02 بحمولة phase_locked: مرحلة النموّ", async () => {
    await renderWith(
      <GrowSuppliers />,
      server({ "GET /api/grow/suppliers": () => json(200, { state: "phase_locked" }) }),
    );
    await waitFor(() => expect(hint("GROW-02")).toBe("phase_locked"));
    expect(
      screen.getByText(
        tx("shared:features/phase/phase-screen-client.tsx", "مرحلة النموّ لم تُفتح بعد"),
      ),
    ).toBeTruthy();
  });

  it("LINK-02 جاهز: conflict عند وجود مطابقة موقوفة", async () => {
    const body = {
      state: "ready",
      counterparties: [],
      counterparty_tenant_id: "",
      mappings: [],
      matched_count: 0,
      review_count: 2,
      unmapped_offers: [],
      items: [],
    };
    await renderWith(
      <LinkItems />,
      server({ "GET /api/market/link/items": () => json(200, body) }),
    );
    await waitFor(() => expect(hint("LINK-02")).toBe("conflict"));
  });

  it("LINK-04 بلا فروق: empty", async () => {
    const body = {
      state: "ready",
      can_settle: true,
      links: [],
      payments: [],
      linked_count: 4,
      diff_count: 0,
    };
    await renderWith(
      <LinkDocuments />,
      server({ "GET /api/market/link/documents": () => json(200, body) }),
    );
    await waitFor(() => expect(hint("LINK-04")).toBe("empty"));
    expect(screen.getAllByText(tx("LINK-04", "لا فروق")).length).toBeGreaterThan(0);
  });

  it("LINK-05 مع مستند عكسي جزئي: partial", async () => {
    const body = {
      state: "ready",
      can_convert: true,
      pending_count: 0,
      returns: [
        {
          return_id: "r1",
          ref_label: "RT-1",
          order_label: "ORD-1",
          supplier_name: "مورد",
          status: "partial",
          status_label: "جزئي",
          decision_note: "",
          lines: [
            {
              offer_id: "x",
              name: "زيت",
              unit_name: "عبوة",
              requested: 18,
              approved: 10,
              pending: 8,
              reason: "",
              price_minor: 100,
            },
          ],
          converted: true,
          local_number: "RV-1",
          reverse_partial: true,
        },
      ],
    };
    await renderWith(
      <LinkReturns />,
      server({ "GET /api/market/link/returns": () => json(200, body) }),
    );
    await waitFor(() => expect(hint("LINK-05")).toBe("partial"));
    expect(screen.getByText(tx("LINK-05", "الثمانية الباقية"), { exact: false })).toBeTruthy();
  });

  it("GROW-01: أمين المخزن يرى الاقتراح ولا يحوّله (permission_denied بزر معطّل بسببه)", async () => {
    const body = {
      state: "permission_denied",
      can_convert: false,
      ask_name: "أحمد",
      computed_at: NOW,
      rows: [],
    };
    await renderWith(
      <GrowReplenish />,
      server({ "GET /api/grow/replenish": () => json(200, body) }),
    );
    await waitFor(() => expect(hint("GROW-01")).toBe("permission_denied"));
    expect(screen.getByText(tx("GROW-01", "يُرى ولا يُحوَّل"))).toBeTruthy();
    expect(
      screen.getByText(tx("GROW-01", "أمين المخزن يرى الاقتراح ولا يحوّله إلى أمر شراء")),
    ).toBeTruthy();
  });

  it("GROW-03: طلب بلا جمهور أو مدة يعيد validation_error من الخادم", async () => {
    const body = {
      state: "ready",
      pricing_locked: true,
      pricing_lock_label: "التسعير غير معتمد",
      can_request: true,
      can_prepare: true,
      offers: [{ offer_id: "o1", public_name: "سكر", pack_label: "كيس" }],
      audiences: [{ code: "all", label: "الكل" }],
      requests: [],
    };
    await renderWith(
      <GrowPromote />,
      server({
        "GET /api/grow/promote": () => json(200, body),
        "POST /api/grow/promote": () => json(400, { detail: "audience_or_duration_required" }),
      }),
    );
    await waitFor(() => screen.getByRole("button", { name: "سكر" }));
    await fireEvent.press(screen.getByRole("button", { name: "سكر" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: tx("GROW-03", "اطلب العرض الممول") })).toBeTruthy(),
    );
    await fireEvent.press(screen.getByRole("button", { name: tx("GROW-03", "اطلب العرض الممول") }));
    await waitFor(() => expect(hint("GROW-03")).toBe("validation_error"));
  });
});

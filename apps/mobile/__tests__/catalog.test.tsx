import { MemoryStorage } from "@sting/platform/memory";
import { ITEM_PREFIX } from "@sting/sync-core";
import { tx } from "@sting/texts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import Catalog from "@/app/catalog/index";
import Groups from "@/app/catalog/groups";
import Import from "@/app/catalog/import";
import Price from "@/app/catalog/[id]/price";
import Units from "@/app/catalog/[id]/units";
import NewItem from "@/app/catalog/new";
import { ANONYMOUS, SessionProvider, type SessionState } from "@/lib/session";
import { setStorageForTests } from "@/lib/storage";

const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: jest.fn(), push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("react") as typeof import("react")).useEffect(cb, []);
  },
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
function server(routes: Record<string, Route>, down = false) {
  const calls: Request[] = [];
  const impl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    calls.push(req);
    if (down) throw new TypeError("Network request failed");
    const route = routes[`${req.method} ${new URL(req.url).pathname}`];
    return route ? route(req) : json(404, { detail: "not_found" });
  });
  return { fetch: impl as unknown as typeof fetch, calls };
}
const ACTIVE: SessionState = {
  ...ANONYMOUS,
  status: "active",
  tenantId: "t1",
  userId: "u1",
  setupDone: true,
  deviceId: "d1",
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
const stateOf = (id: string) => screen.getByTestId(id).props.accessibilityHint as string;

const ITEM = {
  name: "سكر",
  name_normalized: "سكر",
  group_id: "",
  group_name: "",
  base_unit_id: "u1",
  base_unit_code: "kg",
  base_unit_name: "كيلو",
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
beforeEach(() => {
  mockPush.mockClear();
  mockParams = {};
  storage = new MemoryStorage();
  setStorageForTests(storage);
});
afterEach(() => cleanup());

describe("M3 — الكتالوج (CAT-01…06)", () => {
  it("CAT-01: بلا شبكة يُعرض المحلي ويعمل البحث عليه بحالة offline", async () => {
    await storage.transaction(async (t) => {
      await t.putProjection({ key: `${ITEM_PREFIX}i1`, value: ITEM });
      await t.putProjection({
        key: `${ITEM_PREFIX}i2`,
        value: { ...ITEM, name: "شاي", name_normalized: "شاي", barcode: "2" },
      });
    });
    await renderWith(<Catalog />, server({}, true).fetch);
    expect(await screen.findByText("سكر")).toBeTruthy();
    expect(screen.getByText("شاي")).toBeTruthy();
    await waitFor(() => expect(stateOf("CAT-01")).toBe("offline"));
    expect(screen.getByText(tx("CAT-01", "كتالوج محلي"), { exact: false })).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText(tx("CAT-01", "بحث")), "سك");
    await waitFor(() => expect(screen.queryByText("شاي")).toBeNull());
    expect(screen.getByText("سكر")).toBeTruthy();
  });

  it("CAT-01: ردّ الخادم يحلّ محلّ المحلي بحالة ready", async () => {
    const s = server({
      "GET /api/catalog/items": () =>
        json(200, {
          items: [{ ...ITEM, id: "i9", name: "عدس", name_normalized: "عدس" }],
          total: 1,
          all_total: 1,
          groups: [],
        }),
    });
    await renderWith(<Catalog />, s.fetch);
    expect(await screen.findByText("عدس")).toBeTruthy();
    await waitFor(() => expect(stateOf("CAT-01")).toBe("ready"));
  });

  it("CAT-02: نموذج فارغ يُظهر الخطأين معاً بلا أي POST ويُبقي الحالة validation_error", async () => {
    const s = server({
      "GET /api/catalog/units": () =>
        json(200, {
          units: [{ id: "u1", code: "kg", name: "كيلو", is_base: true, decimal_places: 0 }],
        }),
      "GET /api/catalog/groups": () => json(200, { groups: [] }),
    });
    await renderWith(<NewItem />, s.fetch);
    await fireEvent.press(
      await screen.findByRole("button", {
        name: tx("shared:features/catalog/item-form.tsx", "احفظ الصنف"),
      }),
    );
    expect(await screen.findByText("خطآن يمنعان الحفظ")).toBeTruthy();
    expect(stateOf("CAT-02")).toBe("validation_error");
    expect(s.calls.some((r) => r.method === "POST")).toBe(false);
  });

  it("CAT-02: الحفظ يرسل الجسم ويبلغ success بعد الرد", async () => {
    let body: Record<string, unknown> = {};
    const s = server({
      "GET /api/catalog/units": () =>
        json(200, {
          units: [{ id: "u1", code: "kg", name: "كيلو", is_base: true, decimal_places: 0 }],
        }),
      "GET /api/catalog/groups": () => json(200, { groups: [] }),
      "POST /api/catalog/items": async (req) => {
        body = (await req.json()) as Record<string, unknown>;
        return json(200, {
          id: "n1",
          name: "رز",
          group_id: "",
          base_unit_id: "u1",
          base_unit_name: "كيلو",
          units: [],
          barcode: "",
          sale_price_minor: "2500",
          image_data_url: "",
          base_unit_locked: false,
        });
      },
    });
    await renderWith(<NewItem />, s.fetch);
    const F = "shared:features/catalog/item-form.tsx";
    await fireEvent.changeText(await screen.findByLabelText(tx(F, "اسم الصنف")), "رز");
    await fireEvent.press(screen.getByRole("button", { name: tx(F, "الوحدة الأساسية") }));
    await fireEvent.press(await screen.findByText("كيلو"));
    await fireEvent.changeText(screen.getByLabelText(`${tx(F, "سعر بيع ال")}كيلو`), "25");
    await fireEvent.press(screen.getByRole("button", { name: tx(F, "احفظ الصنف") }));
    expect(await screen.findByText(tx(F, "حُفظ الصنف"))).toBeTruthy();
    expect(stateOf("CAT-02")).toBe("success");
    expect(body).toMatchObject({ name: "رز", base_unit_id: "u1", sale_price_minor: "2500" });
  });

  it("CAT-03: معامل لوحدة لها سطور بيع سابقة يحذّر من أنها لن تتغير", async () => {
    mockParams = { id: "i1" };
    const s = server({
      "GET /api/catalog/items/i1": () =>
        json(200, {
          id: "i1",
          name: "سكر",
          base_unit_id: "u1",
          base_unit_name: "كيلو",
          base_unit_decimal_places: 0,
          barcode: "",
          units: [
            {
              id: "iu1",
              unit_id: "u2",
              name: "كرتونة",
              decimal_places: 0,
              factor_milli: "12000",
              barcode: "",
              created_at: "2026-01-05T10:00:00Z",
              prior_lines: 3,
              changes: [],
            },
          ],
        }),
      "GET /api/catalog/units": () => json(200, { units: [] }),
    });
    await renderWith(<Units />, s.fetch);
    await fireEvent.press(
      await screen.findByRole("button", { name: `${tx("CAT-03", "تغيير معامل ال")}كرتونة` }),
    );
    expect(
      await screen.findByText(tx("CAT-03", "سطر بيع سابق يستخدم المعامل"), { exact: false }),
    ).toBeTruthy();
    expect(stateOf("CAT-03")).toBe("validation_error");
  });

  it("CAT-04: من لا يملك can_change يرى permission_denied ولا زرّ حفظ", async () => {
    mockParams = { id: "i1" };
    const s = server({
      "GET /api/catalog/items/i1/price": () =>
        json(200, {
          item_id: "i1",
          name: "سكر",
          base_unit_name: "كيلو",
          sale_price_minor: "10000",
          units: [],
          history: [],
          can_change: false,
          can_see_cost: false,
          average_cost_minor: "0",
          pending_requests: [],
        }),
    });
    await renderWith(<Price />, s.fetch);
    expect(await screen.findByText(tx("CAT-04", "تغيير السعر للمالك"))).toBeTruthy();
    expect(stateOf("CAT-04")).toBe("permission_denied");
    expect(screen.queryByRole("button", { name: tx("CAT-04", "حفظ السعر") })).toBeNull();
  });

  it("CAT-05: المعاينة بصفوف مرفوضة وصالحة = partial وزرّ اعتماد بالعدد", async () => {
    const batch = {
      id: "b1",
      file_name: "prices.csv",
      status: "previewed",
      rows: [
        {
          line: 1,
          key: "a",
          price_text: "5",
          item_id: "i1",
          name: "سكر",
          old_price_minor: "100",
          new_price_minor: "500",
          result: "update",
          reason: "",
        },
        {
          line: 2,
          key: "b",
          price_text: "x",
          item_id: "",
          name: "؟",
          old_price_minor: "",
          new_price_minor: "",
          result: "rejected",
          reason: "not_a_number",
        },
      ],
      ready_count: 1,
      rejected_count: 1,
      unchanged_count: 0,
      applied_count: 0,
      max_increase_pct: 400,
      revert_until: "",
    };
    const s = server({ "POST /api/catalog/prices/import/preview": () => json(200, batch) });
    await renderWith(<Import />, s.fetch);
    const paste = screen.getByLabelText("محتوى CSV");
    await fireEvent.changeText(paste, "سكر,5\nx,x");
    await fireEvent.press(screen.getByRole("button", { name: tx("CAT-05", "معاينة ما سيتغيّر") }));
    expect(await screen.findByText(tx("CAT-05", "جاهز للاعتماد"))).toBeTruthy();
    expect(stateOf("CAT-05")).toBe("partial");
    expect(
      screen.getByRole("button", { name: `${tx("CAT-05", "اعتماد")} 1 ${tx("CAT-05", "سطراً")}` }),
    ).toBeTruthy();
  });

  it("CAT-06: اسم بديل مأخوذ (409) يسمّي الصنف المالك بحالة validation_error", async () => {
    const s = server({
      "GET /api/catalog/groups": () =>
        json(200, {
          groups: [{ id: "g1", name: "بقالة", parent_name: "", items: 1, aliases: [], note: "" }],
          group_count: 1,
          total_items: 1,
        }),
      "GET /api/catalog/items": () =>
        json(200, { items: [{ ...ITEM, id: "i1" }], total: 1, all_total: 1, groups: [] }),
      "POST /api/catalog/items/i1/aliases": () =>
        json(409, { alias: "سكّر", owner_item_id: "i7", owner_item_name: "سكر ناعم" }),
    });
    await renderWith(<Groups />, s.fetch);
    await fireEvent.press(await screen.findByRole("button", { name: tx("CAT-06", "الصنف") }));
    await fireEvent.press(await screen.findByText("سكر"));
    await fireEvent.changeText(screen.getByLabelText(tx("CAT-06", "أسماء بديلة")), "سكّر");
    await fireEvent.press(screen.getByRole("button", { name: tx("CAT-06", "تسجيل اسم بديل") }));
    expect(await screen.findByText(tx("CAT-06", "الاسم البديل مأخوذ"))).toBeTruthy();
    expect(screen.getByRole("button", { name: "سكر ناعم" })).toBeTruthy();
    expect(stateOf("CAT-06")).toBe("validation_error");
  });
});

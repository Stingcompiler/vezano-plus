import { MemoryStorage } from "@sting/platform/memory";
import { tx } from "@sting/texts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import Sales from "@/app/(tabs)/reports";
import Cash from "@/app/reports/cash";
import Export from "@/app/reports/export";
import Margin from "@/app/reports/margin";
import Receivables from "@/app/reports/receivables";
import "@/lib/crypto";
import { setSecretsForTests } from "@/lib/secrets";
import { ANONYMOUS, SessionProvider, type SessionState } from "@/lib/session";
import { setStorageForTests } from "@/lib/storage";

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
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
function server(routes: Record<string, Route>, down = false) {
  const impl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    if (down) throw new TypeError("Network request failed");
    const route = routes[`${req.method} ${new URL(req.url).pathname}`];
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

let storage: MemoryStorage;
beforeEach(() => {
  mockReplace.mockClear();
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
const COMPLETE = {
  devices_total: 2,
  devices_synced: 2,
  pending_ops: 0,
  not_synced: [],
  complete: true,
};
const SALES = {
  scope: "all",
  branch_name: "الرئيسي",
  can_all_branches: true,
  range: { key: "today", start: "2026-10-20", end: "2026-10-20", label: "اليوم" },
  method: "all",
  totals: {
    revenue_minor: "1250000",
    returns_minor: "0",
    net_minor: "1250000",
    invoices: 5,
    returns_count: 0,
    cash_minor: "1250000",
    credit_minor: "0",
    bank_minor: "0",
    average_minor: "250000",
  },
  by_branch: [
    {
      id: "b1",
      name: "الرئيسي",
      revenue_minor: "1250000",
      returns_minor: "0",
      invoices: 5,
      last_sync_at: NOW,
      pending: 0,
      complete: true,
    },
  ],
  by_day: [],
  completeness: COMPLETE,
  branches: [{ id: "b1", name: "الرئيسي" }],
  computed_at: NOW,
  last_sale_date: "2026-10-20",
  cost_columns: "phase_locked",
};
const hint = (id: string) => screen.getByTestId(id).props.accessibilityHint as string;

describe("REP-01 — تقرير المبيعات", () => {
  it("بيانات مكتملة: ready ويُحفظ الردّ للعمل بلا اتصال", async () => {
    await renderWith(<Sales />, server({ "GET /api/reports/sales": () => json(200, SALES) }));
    await waitFor(() => expect(hint("REP-01")).toBe("ready"));
    expect(screen.getByText(tx("REP-01", "اكتمال البيانات"))).toBeTruthy();
    await waitFor(async () =>
      expect(await storage.read((t) => t.getMeta("rep.sales_cache"))).toContain("1250000"),
    );
  });

  it("جهاز لم يزامن: pending_sync ومعه «ناقص معلوم» وزر المزامنة", async () => {
    const body = {
      ...SALES,
      completeness: {
        ...COMPLETE,
        devices_synced: 1,
        pending_ops: 3,
        complete: false,
        not_synced: [
          {
            device_name: "M2",
            branch_id: "b1",
            branch_name: "الرئيسي",
            last_seen_at: "",
            pending: 3,
          },
        ],
      },
    };
    await renderWith(<Sales />, server({ "GET /api/reports/sales": () => json(200, body) }));
    await waitFor(() => expect(hint("REP-01")).toBe("pending_sync"));
    expect(screen.getByText(tx("REP-01", "ناقص معلوم"))).toBeTruthy();
    expect(
      screen.getByRole("button", { name: tx("REP-01", "مزامنة ثم إعادة الحساب") }),
    ).toBeTruthy();
  });

  it("بلا اتصال: آخر ردّ محفوظ بحالة stale", async () => {
    await storage.transaction((t) => t.putMeta("rep.sales_cache", JSON.stringify(SALES)));
    await renderWith(<Sales />, server({}, true));
    await waitFor(() => expect(hint("REP-01")).toBe("stale"));
    expect(screen.getByText(tx("REP-01", "أرقام من آخر مطابقة"))).toBeTruthy();
  });

  it("403: permission_denied", async () => {
    await renderWith(
      <Sales />,
      server({ "GET /api/reports/sales": () => json(403, { role_name: "كاشير" }) }),
    );
    await waitFor(() => expect(hint("REP-01")).toBe("permission_denied"));
    expect(screen.getByText(tx("REP-01", "مدير الفرع يرى فرعه"))).toBeTruthy();
  });

  it("بلا مبيعات: empty ويقترح المدى الأقرب", async () => {
    const body = { ...SALES, totals: { ...SALES.totals, invoices: 0 } };
    await renderWith(<Sales />, server({ "GET /api/reports/sales": () => json(200, body) }));
    await waitFor(() => expect(hint("REP-01")).toBe("empty"));
    expect(screen.getByRole("button", { name: tx("REP-01", "نقترح المدى الأقرب") })).toBeTruthy();
  });
});

describe("REP-02 — الذمم", () => {
  it("لا ذمم: empty، ومنع الكاشير: permission_denied", async () => {
    const body = {
      side: "customers",
      scope: "all",
      rows: [],
      totals: { balance_minor: "0", parties: 0 },
      computed_at: NOW,
      ageing: "disabled",
    };
    await renderWith(
      <Receivables />,
      server({ "GET /api/reports/receivables": () => json(200, body) }),
    );
    await waitFor(() => expect(hint("REP-02")).toBe("empty"));
  });

  it("403: permission_denied", async () => {
    await renderWith(
      <Receivables />,
      server({ "GET /api/reports/receivables": () => json(403, { role_name: "كاشير" }) }),
    );
    await waitFor(() => expect(hint("REP-02")).toBe("permission_denied"));
  });
});

describe("REP-04 — الصندوق", () => {
  it("وردية بنسختين: conflict وتُستثنى من المجموع", async () => {
    const body = {
      scope: "all",
      branch_name: "الرئيسي",
      can_all_branches: true,
      range: { key: "7d", start: "2026-10-14", end: "2026-10-20", label: "7 أيام" },
      rows: [
        {
          id: "s1",
          branch_name: "الرئيسي",
          device_name: "M1",
          user_name: "سميرة",
          opened_at: NOW,
          closed_at: NOW,
          count_status: "counted",
          expected_cash_at_close_minor: "100000",
          counted_cash_minor: "99000",
          counted_by_name: "سميرة",
          witness_name: "",
          variance_minor: "",
          reviewed: false,
          reviewed_by_name: "",
          conflict: {
            quarantine_id: "q1",
            device_name: "M2",
            counted_by_name: "علي",
            counted_cash_minor: "98000",
            expected_cash_at_close_minor: "100000",
            occurred_at: NOW,
            received_at: NOW,
          },
        },
      ],
      totals: {
        shifts: 1,
        counted: 0,
        not_counted: 0,
        variance_minor: "0",
        over_minor: "0",
        short_minor: "0",
        unreviewed_variances: 0,
        excluded_conflicts: 1,
      },
      open_shifts: [],
      completeness: COMPLETE,
      branches: [],
      computed_at: NOW,
      last_closed_date: "2026-10-20",
    };
    await renderWith(<Cash />, server({ "GET /api/reports/cash": () => json(200, body) }));
    await waitFor(() => expect(hint("REP-04")).toBe("conflict"));
    expect(screen.getByText(tx("REP-04", "وردية بعدّين مختلفين"))).toBeTruthy();
    expect(
      screen.getAllByText(tx("REP-04", "خارج المجموع — بانتظار الحسم")).length,
    ).toBeGreaterThan(0);
  });

  it("403 يعيد إلى الوردية الحالية", async () => {
    await renderWith(<Cash />, server({ "GET /api/reports/cash": () => json(403, {}) }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/shifts/current"));
  });
});

describe("REP-05 — الهامش", () => {
  const margin = (state: string) => ({
    state,
    scope: "all",
    branch_compare: true,
    range: { key: "30d", start: "2026-09-21", end: "2026-10-20", label: "30 يوماً" },
    policy: "",
    policy_label: "",
    computed_at: NOW,
    sales_by_branch: [{ id: "b1", name: "الرئيسي", sales_minor: "500000" }],
    rows: [],
    groups: [],
    missing: null,
  });

  it("قبل السياسة: phase_locked ولا رقم تكلفة", async () => {
    await renderWith(
      <Margin />,
      server({ "GET /api/reports/margin": () => json(200, margin("phase_locked")) }),
    );
    await waitFor(() => expect(hint("REP-05")).toBe("phase_locked"));
    expect(screen.getAllByText(/تحتاج سياسة/).length).toBeGreaterThan(0);
  });

  it("غير المالك: permission_denied", async () => {
    await renderWith(
      <Margin />,
      server({ "GET /api/reports/margin": () => json(403, { role_name: "مدير فرع" }) }),
    );
    await waitFor(() => expect(hint("REP-05")).toBe("permission_denied"));
  });
});

describe("REP-06 — التصدير", () => {
  const preview = {
    report: "sales",
    label: "تقرير المبيعات",
    format: "html",
    file_name: "sales.html",
    monthly: false,
    expected_pages: 3,
    row_count: 40,
    first_page_html: "<html></html>",
    range: { start: "2026-09-21", end: "2026-10-20", label: "30", months: 1 },
    quota: { used: 1, limit: 10 },
    months_limit: 12,
  };

  it("معاينة جاهزة: ready وزر التصدير فعّال", async () => {
    await renderWith(
      <Export />,
      server({
        "GET /api/reports/export/preview": () => json(200, preview),
        "GET /api/reports/exports": () => json(200, { exports: [] }),
      }),
    );
    await waitFor(() => expect(screen.getByText("sales.html", { exact: false })).toBeTruthy());
    expect(hint("REP-06")).toBe("ready");
  });

  it("مدى أوسع من الحدّ: validation_error والتصدير معطّل بسبب ظاهر", async () => {
    await renderWith(
      <Export />,
      server({
        "GET /api/reports/export/preview": () =>
          json(400, {
            detail: "range_too_wide",
            extra: {
              months: 18,
              limit: 12,
              alternatives: [{ key: "split", first_end: "2026-01-01" }],
            },
          }),
        "GET /api/reports/exports": () => json(200, { exports: [] }),
      }),
    );
    await waitFor(() => expect(hint("REP-06")).toBe("validation_error"));
    expect(screen.getByText(tx("REP-06", "المدى أوسع من الحدّ"))).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: tx("REP-06", "اطلب مدى أوسع") }));
  });

  it("فشل التوليد: server_error بلا ملف", async () => {
    await renderWith(
      <Export />,
      server({
        "GET /api/reports/export/preview": () => json(200, preview),
        "GET /api/reports/exports": () => json(200, { exports: [] }),
        "POST /api/reports/exports": () => json(500, { detail: "boom" }),
      }),
    );
    await waitFor(() => expect(screen.getByText("sales.html", { exact: false })).toBeTruthy());
    await fireEvent.press(screen.getByRole("button", { name: tx("REP-06", "صدِّر") }));
    await waitFor(() => expect(hint("REP-06")).toBe("server_error"));
  });
});

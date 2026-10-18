import type { HomeSummary } from "@sting/app-core";
import { MemoryStorage } from "@sting/platform/memory";
import { tx } from "@sting/texts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import Home from "@/app/(tabs)/index";
import More from "@/app/(tabs)/more";
import Search from "@/app/search";
import Sync from "@/app/sync";
import "@/lib/crypto";
import { readHomeCache, writeHomeCache } from "@/lib/home";
import { setSecretsForTests } from "@/lib/secrets";
import { ANONYMOUS, SessionProvider, type SessionState } from "@/lib/session";
import { setStorageForTests } from "@/lib/storage";

const mockPush = jest.fn();
const mockOpenOnWeb = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: jest.fn(), push: mockPush }),
  Redirect: () => null,
}));
jest.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000001",
  getRandomValues: (a: Uint8Array) => a,
}));
jest.mock("@/lib/web", () => ({
  WEB_URL: "https://plus.test",
  openOnWeb: (h: string) => void mockOpenOnWeb(h),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Route = (req: Request) => Response | Promise<Response>;
/** خادم وهمي؛ `down` = لا شبكة (رفض fetch كما في الهاتف بلا اتصال). */
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
  mockPush.mockClear();
  mockOpenOnWeb.mockClear();
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
const SUMMARY: HomeSummary = {
  kind: "owner",
  tenant_name: "بقالة النيل",
  user: { display_name: "سميرة", role_name: "مالك", branch_name: "الرئيسي", device_name: "M1" },
  period: "today",
  branch_id: "",
  branches: [{ id: "b1", name: "الرئيسي" }],
  branches_synced: true,
  devices_total: 1,
  coverage_at: NOW,
  decisions: [
    {
      id: "d1",
      title: "مرتجع ينتظر موافقتك",
      detail: "",
      action: "راجع",
      href: "/sales/returns",
      severity: "warn",
    },
  ],
  decisions_count: 1,
  kpis: [
    {
      key: "sales",
      label: "مبيعات اليوم",
      value: { kind: "money", amount_minor: "1250000", exponent: 2 },
      scope: "",
      note: "",
      note_kind: "info",
      as_of: NOW,
      href: "/sales",
    },
  ],
  attention: [],
  tasks: [],
  quick_actions: [],
  can_see_finance: true,
  margin_locked: true,
  shift: null,
};

describe("HOME-01 — الرئيسية (0005 §١٧٤)", () => {
  it("الملخّص من الخادم: اسم المحل والقرار، ويُحفظ للعمل بلا اتصال", async () => {
    const s = server({ "GET /api/home": () => json(200, SUMMARY) });
    await renderWith(<Home />, s.fetch);
    expect(await screen.findByText("مرتجع ينتظر موافقتك")).toBeTruthy();
    expect(screen.getAllByText("بقالة النيل").length).toBeGreaterThan(0);
    await waitFor(async () =>
      expect((await readHomeCache(storage))?.summary.tenant_name).toBe("بقالة النيل"),
    );
    expect(screen.getByTestId("HOME-01")).toBeTruthy();
  });

  it("بلا اتصال: آخر ملخّص محفوظ مع إشعار بلا اتصال", async () => {
    await writeHomeCache(storage, SUMMARY);
    await renderWith(<Home />, server({}, true).fetch);
    expect(await screen.findByText("مرتجع ينتظر موافقتك")).toBeTruthy();
    expect(screen.getByTestId("HOME-01").props.accessibilityHint).toBe("offline");
    // شارة الحالة تفتح مركز المزامنة
    await fireEvent.press(
      screen.getByRole("button", { name: tx("SYS-01", "مركز الاتصال والمزامنة") }),
    );
    expect(mockPush).toHaveBeenCalledWith("/sync");
  });

  it("حقل البحث يفتح شاشة البحث داخل التطبيق", async () => {
    await renderWith(<Home />, server({ "GET /api/home": () => json(200, SUMMARY) }).fetch);
    await screen.findByText("مرتجع ينتظر موافقتك");
    await fireEvent.press(
      screen.getByLabelText(
        tx("shared:features/home/app-nav.tsx", "ابحث عن صنف أو فاتورة أو عميل"),
      ),
    );
    expect(mockPush).toHaveBeenCalledWith("/search");
  });
});

describe("HOME-03 — البحث", () => {
  it("نتائج الخادم مجمّعة بنوعها، والمحجوب عدداً بلا محتوى", async () => {
    const s = server({
      "GET /api/search": () =>
        json(200, {
          query: "سكر",
          groups: [
            {
              kind: "items",
              label: "أصناف",
              results: [
                {
                  id: "i1",
                  title: "سكر كنانة",
                  meta: "",
                  tag: "",
                  tag_kind: "muted",
                  href: "/catalog/i1",
                },
              ],
            },
          ],
          restricted: [{ kind_label: "مستندات", count: 2 }],
          suggestions: { nearest: [], other_branches: false, create: false },
          total: 1,
          kinds_with_results: 1,
          elapsed_ms: 120,
        }),
    });
    await renderWith(<Search />, s.fetch);
    await fireEvent.changeText(screen.getByLabelText(tx("HOME-03", "بحث")), "سكر");
    expect(await screen.findByText("سكر كنانة")).toBeTruthy();
    expect(screen.getByText(tx("HOME-03", "نتائج خارج صلاحيتك"))).toBeTruthy();
    const req = s.calls.find((c) => new URL(c.url).pathname === "/api/search")!;
    expect(new URL(req.url).searchParams.get("q")).toBe("سكر");
    // المبني على الهاتف يُفتح داخله، وما سواه على الويب
    await fireEvent.press(screen.getByText("سكر كنانة"));
    expect(mockOpenOnWeb).toHaveBeenCalledWith("/catalog/i1");
  });

  it("بلا اتصال: بحث محلي على ما خُزّن على الجهاز", async () => {
    await storage.transaction((t) =>
      t.putProjection({ key: "entity:catalog.item.i9", value: { name: "سكر محلي" } }),
    );
    await renderWith(<Search />, server({}, true).fetch);
    await fireEvent.changeText(screen.getByLabelText(tx("HOME-03", "بحث")), "سكر");
    expect(await screen.findByText("سكر محلي")).toBeTruthy();
    expect(screen.getByTestId("HOME-03").props.accessibilityHint).toBe("offline");
  });
});

const OP = {
  operationId: "op-1",
  kind: "shift_open",
  opVersion: 1,
  dependencies: [],
  members: [],
  state: "local" as const,
  createdLocalSeq: 1,
  snapshotRelation: "none" as const,
};
const STATUS = {
  server_time: NOW,
  sync_epoch: "e1",
  server_seq_high: "10",
  quarantined: 0,
  conflicted: 0,
  last_accepted_at: null,
};

describe("SYS-01 — مركز المزامنة", () => {
  it("بلا وصول إلى الخادم: بلا اتصال بعدد المعلّق، والرفع معطّل بسببه", async () => {
    await storage.transaction((t) => t.putOperation(OP));
    await renderWith(<Sync />, server({}, true).fetch);
    expect(await screen.findByText(tx("SYS-01", "بلا اتصال — البيع يعمل"))).toBeTruthy();
    expect(screen.getByText("فتح وردية")).toBeTruthy();
    expect(screen.getAllByText(tx("SYS-01", "بلا اتصال — يُرفع عند عودة الشبكة")).length).toBe(1);
  });

  it("محاولة رفع الآن: يرفع المعلّق ثم «رُفعت 1 عملية»", async () => {
    await storage.transaction(async (t) => {
      await t.putOperation(OP);
      await t.putMeta("sync_epoch", "e1");
    });
    let requestId = "";
    const s = server({
      "GET /api/sync/status": () => json(200, STATUS),
      "POST /api/sync/push": async (req) => {
        const body = (await req.json()) as { request_id: string };
        requestId = body.request_id;
        return json(200, {
          protocol_version: 1,
          sync_epoch: "e1",
          request_id: body.request_id,
          results: [{ operation_id: "op-1", status: "accepted", member_receipts: [] }],
          server_seq_high: "11",
        });
      },
    });
    await renderWith(<Sync />, s.fetch);
    await waitFor(() =>
      expect(screen.getByTestId("SYS-01").props.accessibilityHint).toBe("pending_sync"),
    );
    await fireEvent.press(screen.getByRole("button", { name: tx("SYS-01", "محاولة رفع الآن") }));
    expect(await screen.findByText(tx("SYS-01", "اكتمل الرفع الآن"))).toBeTruthy();
    // معرّف طلب UUID لكل رفع (على الهاتف من سدّ expo-crypto)
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await storage.read((t) => t.getOperation("op-1")))?.state).toBe("synced");
  });
});

describe("المزيد", () => {
  it("المزامنة تُفتح داخل التطبيق لا على الويب", async () => {
    await renderWith(<More />, server({}).fetch);
    await fireEvent.press(screen.getByText(tx("shared:app-core/nav.ts", "المزامنة")));
    expect(mockPush).toHaveBeenCalledWith("/sync");
    expect(mockOpenOnWeb).not.toHaveBeenCalled();
  });
});

import { createApiClient } from "@sting/app-core";
import { MemoryStorage } from "@sting/platform/memory";
import { DEVICE_SETUP_KEY, readBootstrap, storeVerifiers } from "@sting/sync-core";
import { tx } from "@sting/texts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { pbkdf2Sync } from "node:crypto";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import Lock from "@/app/lock";
import { runBootstrap } from "@/lib/bootstrap";
import { SECRET_KEYS, setSecretsForTests } from "@/lib/secrets";
import { ANONYMOUS, SessionProvider, type SessionState, useSession } from "@/lib/session";
import { setStorageForTests } from "@/lib/storage";

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  Redirect: ({ href }: { href: string }) => {
    mockReplace(href);
    return null;
  },
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function server(routes: Record<string, (req: Request) => Response | Promise<Response>>) {
  const calls: Request[] = [];
  const impl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    calls.push(req);
    const route = routes[`${req.method} ${new URL(req.url).pathname}`];
    return route ? route(req) : json(404, { detail: "not_found" });
  });
  return { fetch: impl as unknown as typeof fetch, calls };
}

let mem: Map<string, string>;
let storage: MemoryStorage;
beforeEach(() => {
  mockReplace.mockClear();
  storage = new MemoryStorage();
  setStorageForTests(storage);
  mem = new Map();
  setSecretsForTests({
    get: (k) => Promise.resolve(mem.get(k) ?? null),
    set: (k, v) => Promise.resolve(void mem.set(k, v)),
    delete: (k) => Promise.resolve(void mem.delete(k)),
  });
});

const IMAGE = {
  image_id: "img1",
  sync_epoch: "e1",
  snapshot_id: "s1",
  cutoff_server_seq: "10",
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  scopes: [
    { group: "settings", pages: 1, total: 1 },
    { group: "catalog", pages: 2, total: 3 },
  ],
};

describe("ACC-05 — التنزيل الأول على SQLite/التخزين (0005 §١٧٣)", () => {
  it("الصفحات بترتيبها ثم التفعيل؛ والاستئناف لا يعيد ما نزل", async () => {
    const pages: string[] = [];
    const s = server({
      "POST /api/bootstrap/start": () => json(200, IMAGE),
      "GET /api/bootstrap/img1/page": (req) => {
        const u = new URL(req.url);
        pages.push(`${u.searchParams.get("group")}:${u.searchParams.get("page")}`);
        const g = u.searchParams.get("group");
        return json(200, {
          entities:
            g === "catalog"
              ? [{ entity: "item", id: `i${u.searchParams.get("page")}`, payload: { name: "سكر" } }]
              : [{ entity: "setting", id: "s", payload: {} }],
        });
      },
      "POST /api/bootstrap/img1/complete": () => json(200, {}),
    });
    const api = createApiClient({
      baseUrl: "https://x.test",
      getAccessToken: () => "device",
      fetch: s.fetch,
    });
    const seen: number[] = [];
    const r = await runBootstrap({
      api,
      storage,
      tenantId: "t1",
      branchId: "b1",
      retryDelaysMs: [],
      onProgress: (p) => seen.push(Object.values(p.pagesDone).reduce((a, b) => a + b, 0)),
    });
    expect(r).toEqual({ done: true });
    expect(pages).toEqual(["settings:1", "catalog:1", "catalog:2"]);
    expect(await storage.read((t) => t.getMeta(DEVICE_SETUP_KEY))).toBe("done");
    expect((await readBootstrap(storage))?.activatedAt).toBeTruthy();
    // تشغيل ثانٍ: النسخة مفعّلة — لا صفحات جديدة
    pages.length = 0;
    await runBootstrap({
      api,
      storage,
      tenantId: "t1",
      branchId: "b1",
      retryDelaysMs: [],
      onProgress: () => undefined,
    });
    expect(pages).toEqual([]);
  });

  it("خطأ دائم في صفحة = وقوف بخطأ وما نزل يبقى", async () => {
    const s = server({
      "POST /api/bootstrap/start": () => json(200, IMAGE),
      "GET /api/bootstrap/img1/page": (req) =>
        new URL(req.url).searchParams.get("group") === "settings"
          ? json(200, { entities: [] })
          : json(500, { detail: "boom" }),
    });
    const api = createApiClient({
      baseUrl: "https://x.test",
      getAccessToken: () => "d",
      fetch: s.fetch,
    });
    const r = await runBootstrap({
      api,
      storage,
      tenantId: "t1",
      branchId: "b1",
      retryDelaysMs: [0],
      onProgress: () => undefined,
    });
    expect(r).toEqual({ done: false, stop: "error" });
    expect((await readBootstrap(storage))?.pagesDone).toEqual({ settings: 1, catalog: 0 });
  });
});

// متحقق PIN كما يشتقه الخادم (دورات قليلة للاختبار)
function verifier(pin: string): string {
  const salt = Buffer.alloc(16, 7);
  const hash = pbkdf2Sync(pin, salt, 1000, 32, "sha256");
  return `pbkdf2_sha256$1000$${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function seedDevice() {
  await storeVerifiers(storage, {
    device_id: "d1",
    prefix: "M1",
    branch_name: "الرئيسي",
    pin_length: 6,
    fetched_at: new Date().toISOString(),
    verifiers: [
      {
        user_id: "u1",
        display_name: "سميرة",
        role_name: "كاشير",
        branch_name: "الرئيسي",
        encoded: verifier("246810"),
        version: 1,
      },
    ],
  });
  await storage.transaction((t) => t.putMeta(DEVICE_SETUP_KEY, "done"));
  mem.set(SECRET_KEYS.deviceRefresh, "old-token");
  mem.set(SECRET_KEYS.deviceId, "d1");
  mem.set(SECRET_KEYS.userId, "u1");
}

const LOCKED: SessionState = { ...ANONYMOUS, status: "locked", setupDone: true, deviceId: "d1" };

const typePin = async (pin: string) => {
  for (const d of pin) await fireEvent.press(screen.getByRole("button", { name: d }));
};

describe("ACC-07 — القفل المحلي واستئناف الجلسة", () => {
  it("الإقلاع بجهاز مجهّز ورمز محفوظ = القفل", async () => {
    await seedDevice();
    function Probe() {
      return <Text>{useSession().state.status}</Text>;
    }
    await render(
      <SessionProvider fetchImpl={server({}).fetch}>
        <Probe />
      </SessionProvider>,
    );
    expect(await screen.findByText("locked")).toBeTruthy();
  });

  it("الرمز الصحيح بعد إغلاق التطبيق: يدوّر رمز الجهاز ويفتح بلا كلمة مرور", async () => {
    await seedDevice();
    const s = server({
      "POST /api/auth/device-refresh": () =>
        json(200, {
          access: "acc2",
          refresh_token: "new-token",
          expires_at: new Date().toISOString(),
          session_id: "s2",
          user_id: "u1",
          tenant_id: "t1",
          device_id: "d1",
        }),
    });
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SessionProvider fetchImpl={s.fetch} initial={LOCKED}>
          <Lock />
        </SessionProvider>
      </SafeAreaProvider>,
    );
    await screen.findByText("سميرة");
    await typePin("246810");
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/"), { timeout: 5000 });
    expect(mem.get(SECRET_KEYS.deviceRefresh)).toBe("new-token");
    const body = (await s.calls[0].clone().json()) as Record<string, string>;
    expect(body).toEqual({ refresh_token: "old-token", device_id: "d1" });
  });

  it("الرمز الخاطئ: محاولة خاطئة بعدّادها ولا شبكة ولا انتقال", async () => {
    await seedDevice();
    const s = server({});
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SessionProvider fetchImpl={s.fetch} initial={LOCKED}>
          <Lock />
        </SessionProvider>
      </SafeAreaProvider>,
    );
    await screen.findByText("سميرة");
    await typePin("111111");
    expect(await screen.findByText(tx("ACC-07", "محاولة خاطئة —"))).toBeTruthy();
    expect(s.calls).toHaveLength(0);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("جهاز بلا متحققات: يُقال ذلك ويُعرض الدخول بكلمة المرور", async () => {
    await storage.transaction((t) => t.putMeta(DEVICE_SETUP_KEY, "done"));
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SessionProvider fetchImpl={server({}).fetch} initial={LOCKED}>
          <Lock />
        </SessionProvider>
      </SafeAreaProvider>,
    );
    expect(await screen.findByText(tx("ACC-07", "لا رمز PIN محفوظ على هذا الجهاز"))).toBeTruthy();
    expect(
      screen.getByRole("button", { name: tx("ACC-07", "نسيت الرمز؟ ادخل بكلمة المرور") }),
    ).toBeTruthy();
  });
});

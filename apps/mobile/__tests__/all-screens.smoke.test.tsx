import { MemoryStorage } from "@sting/platform/memory";
import { cleanup, render, screen } from "@testing-library/react-native";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { ComponentType } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import "@/lib/crypto";
import { setSecretsForTests } from "@/lib/secrets";
import { ANONYMOUS, SessionProvider, type SessionState } from "@/lib/session";
import { setStorageForTests } from "@/lib/storage";

/**
 * فحص شامل (0005 §١٩٩): كل شاشة في `src/app` تُرسم دون أن ترمي في ثلاثة أحوال للخادم — انقطاع
 * الشبكة، وخطأ خادم 500، و404 لكل مسار. لا يفحص المحتوى (اختبارات الشاشات تفعل)؛ يفحص أن لا شاشة
 * تنهار حين لا يأتي ما تتوقعه.
 */
jest.mock("expo-router", () => {
  const router = { replace: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: () => true };
  const params = {
    id: "00000000-0000-4000-8000-0000000000aa",
    token: "tok",
    receiptId: "00000000-0000-4000-8000-0000000000bb",
  };
  const Stack = Object.assign(() => null, { Screen: () => null });
  const Tabs = Object.assign(() => null, { Screen: () => null });
  return {
    useRouter: () => router,
    useLocalSearchParams: () => params,
    useFocusEffect: (fn: () => void) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require("react") as typeof import("react")).useEffect(fn, [fn]);
    },
    Redirect: () => null,
    Stack,
    Tabs,
  };
});
jest.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000001",
  getRandomValues: (a: Uint8Array) => a,
}));
jest.mock("@/lib/web", () => ({ WEB_URL: "https://plus.test", openOnWeb: jest.fn() }));

const APP = join(__dirname, "..", "src", "app");
function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return routes(p);
    return n.endsWith(".tsx") && !n.startsWith("_layout") ? [p] : [];
  });
}
const FILES = routes(APP).sort();

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
type Mode = "offline" | "server_error" | "not_found";
function server(mode: Mode): typeof fetch {
  return () => {
    if (mode === "offline") return Promise.reject(new TypeError("Network request failed"));
    const status = mode === "server_error" ? 500 : 404;
    return Promise.resolve(
      new Response(JSON.stringify({ detail: mode }), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
}

beforeEach(() => {
  setStorageForTests(new MemoryStorage());
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

describe.each<Mode>(["offline", "server_error", "not_found"])("كل الشاشات — %s", (mode) => {
  it.each(FILES.map((f) => [relative(APP, f), f]))("%s تُرسم ولا ترمي", async (_name, file) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Screen = (require(file) as { default: ComponentType }).default;
    const errors: unknown[] = [];
    const spy = jest.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      errors.push(a);
    });
    try {
      await render(
        <SafeAreaProvider initialMetrics={METRICS}>
          <SessionProvider fetchImpl={server(mode)} initial={ACTIVE}>
            <Screen />
          </SessionProvider>
        </SafeAreaProvider>,
      );
      // لتستقرّ الطلبات الأولى وتُرسم حالة الخطأ
      await new Promise((r) => setTimeout(r, 30));
      expect(screen.toJSON()).not.toBeUndefined();
      const crashes = errors.filter((e) =>
        /The above error occurred|Uncaught|is not a function|Cannot read propert/.test(String(e)),
      );
      expect(crashes).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});

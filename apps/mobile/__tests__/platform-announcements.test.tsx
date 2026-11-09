import { MemoryStorage } from "@sting/platform/memory";
import { tx } from "@sting/texts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { PlatformAnnouncements } from "@/components/home/platform-announcements";
import { setSecretsForTests } from "@/lib/secrets";
import { ANONYMOUS, SessionProvider, type SessionState } from "@/lib/session";
import { setStorageForTests } from "@/lib/storage";

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useLocalSearchParams: () => ({ token: "tok1" }),
  Redirect: ({ href }: { href: string }) => {
    mockReplace(href);
    return null;
  },
}));
jest.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000001",
  getRandomValues: (a: Uint8Array) => a,
}));
jest.mock("expo-constants", () => ({ expoConfig: { version: "0.1.0" } }));
jest.mock("@/lib/web", () => ({ WEB_URL: "https://plus.test", openOnWeb: jest.fn() }));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const server = (routes: Record<string, () => Response>) =>
  jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const r = routes[`${req.method} ${new URL(req.url).pathname}`];
    return Promise.resolve(r ? r() : json(404, {}));
  }) as unknown as typeof fetch;

const ACTIVE: SessionState = {
  ...ANONYMOUS,
  status: "active",
  tenantId: "t1",
  userId: "u1",
  setupDone: true,
  deviceId: "d1",
  tokens: { access: "a", refresh: "r", sessionId: "s" },
};
const renderWith = (ui: ReactElement, fetchImpl: typeof fetch, initial = ACTIVE) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SessionProvider fetchImpl={fetchImpl} initial={initial}>
        {ui}
      </SessionProvider>
    </SafeAreaProvider>,
  );

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

describe("شريط إعلانات المنصة (0005 §٢٣٤)", () => {
  it("يعرض الإعلان النافذ بزرّه، والزرّ الداخلي يفتح مساره، و«إخفاء» يخفيه", async () => {
    const later = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
    const f = server({
      "GET /api/org/announcements": () =>
        json(200, {
          announcements: [
            {
              id: "an1",
              kind: "payment",
              kind_label: "تذكير بالدفع",
              title: "اشتراكك ينتهي بعد 3 أيام",
              body: "جدّد الآن حتى لا تتوقف المزامنة.",
              starts_at: later(-1),
              ends_at: later(48),
              active: true,
              cta_label: "جدّد الاشتراك",
              cta_url: "/org/subscription",
            },
          ],
        }),
    });
    const nav = jest.fn();
    await renderWith(<PlatformAnnouncements onNavigate={nav} />, f);
    expect(await screen.findByText("تذكير بالدفع — اشتراكك ينتهي بعد 3 أيام")).toBeTruthy();
    expect(screen.getByText("جدّد الآن حتى لا تتوقف المزامنة.")).toBeTruthy();
    expect(screen.getByText(/سارٍ حتى/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "جدّد الاشتراك" }));
    expect(nav).toHaveBeenCalled();
    await fireEvent.press(
      screen.getByRole("button", {
        name: tx("shared:features/home/platform-announcements.tsx", "إخفاء"),
      }),
    );
    await waitFor(() => expect(screen.queryByText(/اشتراكك ينتهي/)).toBeNull());
  });
});

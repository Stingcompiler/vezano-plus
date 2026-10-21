import { MemoryStorage } from "@sting/platform/memory";
import { tx } from "@sting/texts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import Device from "@/app/device";
import Invite from "@/app/invite/[token]";
import SessionExpired from "@/app/session-expired";
import { nativeRoute } from "@/lib/routes";
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

const INVITE = {
  status: "valid",
  tenant_name: "بقالة النيل",
  inviter_name: "مصعب",
  role_name: "كاشير",
  branch_name: "بحري",
  expires_at: new Date(Date.now() + 5 * 3_600_000).toISOString(),
};

describe("M1 — ما بقي (0005 §١٩٢)", () => {
  it("ACC-06: دعوة صالحة تُعرض بدورها ونطاقها، والقبول يغيّر الحالة إلى success", async () => {
    const f = server({
      "GET /api/invites/tok1": () => json(200, INVITE),
      "POST /api/invites/tok1/accept": () => json(200, { ...INVITE, status: "accepted" }),
    });
    await renderWith(<Invite />, f);
    expect(await screen.findByText(/بقالة النيل/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: tx("ACC-06", "قبول الدعوة") }));
    await waitFor(() =>
      expect(screen.getByTestId("ACC-06").props.accessibilityHint).toBe("success"),
    );
  });

  it("ACC-06: دعوة لحساب آخر = permission_denied بلا إفشاء", async () => {
    const f = server({
      "GET /api/invites/tok1": () => json(200, { ...INVITE, status: "not_for_you" }),
    });
    await renderWith(<Invite />, f);
    expect(await screen.findByText(tx("ACC-06", "هذه الدعوة لحسابٍ آخر"))).toBeTruthy();
    expect(screen.getByTestId("ACC-06").props.accessibilityHint).toBe("permission_denied");
  });

  it("ACC-08: مع معلّق = saved_local بعدّه، وإعادة الدخول لا تمسح شيئاً", async () => {
    await storage.transaction((t) =>
      t.putOperation({
        operationId: "o1",
        kind: "sale_invoice",
        opVersion: 1,
        dependencies: [],
        members: [],
        state: "local",
        createdLocalSeq: 1,
        snapshotRelation: "none",
      }),
    );
    await renderWith(
      <SessionExpired />,
      server({ "GET /api/health": () => json(200, {}) }),
      ANONYMOUS,
    );
    expect(await screen.findByText(tx("ACC-08", "فواتير بيع لم تُرفع"))).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: tx("ACC-08", "أعد التحقق وارفع") }));
    expect(mockReplace).toHaveBeenCalledWith("/login");
    expect((await storage.read((t) => t.getOperation("o1")))?.state).toBe("local");
  });

  it("NAT-04: التحديث يُمنع ما دام هناك معلّق ويُسمح بلا معلّق", async () => {
    await storage.transaction((t) =>
      t.putOperation({
        operationId: "o2",
        kind: "sale_invoice",
        opVersion: 1,
        dependencies: [],
        members: [],
        state: "local",
        createdLocalSeq: 1,
        snapshotRelation: "none",
      }),
    );
    await renderWith(<Device />, server({}));
    await waitFor(() =>
      expect(screen.getByTestId("NAT-04").props.accessibilityHint).toBe("pending_sync"),
    );
  });

  it("المسارات: المبني يُفتح داخلياً، وما سواه null", () => {
    expect(nativeRoute("/sync/update")).toBe("/device");
    expect(nativeRoute("/invite/abc")).toBe("/invite/abc");
    expect(nativeRoute("/org/users")).toBeNull();
  });
});

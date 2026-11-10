import { MemoryStorage } from "@sting/platform/memory";
import { act, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { onPushHalt } from "@/lib/background-sync";
import "@/lib/crypto";
import { LockGuard } from "@/lib/nav";
import { setSecretsForTests } from "@/lib/secrets";
import { ANONYMOUS, SessionProvider, type SessionState, useSession } from "@/lib/session";
import { setStorageForTests } from "@/lib/storage";

/**
 * مراجعة 2026-11-10 (ع-١٣): القفل يسري على شاشات المكدّس كلها، والمحو عن بُعد يُنفَّذ على الهاتف.
 */
const mockReplace = jest.fn();
const mockDismissAll = jest.fn();
let mockSegments: string[] = ["pos", "invoices", "[id]"];
jest.mock("expo-router", () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: jest.fn(),
    canDismiss: () => true,
    dismissAll: mockDismissAll,
  }),
  useSegments: () => mockSegments,
  Redirect: () => null,
}));
jest.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000001",
  getRandomValues: (a: Uint8Array) => a,
}));

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
const fetchOk = (() =>
  Promise.resolve(new Response("{}", { status: 200 }))) as unknown as typeof fetch;

let doLock: () => void = () => {};
let doUnlock: (userId: string) => Promise<string> = () => Promise.resolve("");
function Probe() {
  const { lock, unlock, state } = useSession();
  doLock = lock;
  doUnlock = unlock;
  return <Text>{`status:${state.status}`}</Text>;
}

const wrap = (initial: SessionState, fetchImpl: typeof fetch = fetchOk) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SessionProvider fetchImpl={fetchImpl} initial={initial}>
        <Probe />
        <LockGuard />
      </SessionProvider>
    </SafeAreaProvider>,
  );

beforeEach(() => {
  mockReplace.mockClear();
  mockDismissAll.mockClear();
  mockSegments = ["pos", "invoices", "[id]"];
  setStorageForTests(new MemoryStorage());
  const mem = new Map<string, string>();
  setSecretsForTests({
    get: (k) => Promise.resolve(mem.get(k) ?? null),
    set: (k, v) => Promise.resolve(void mem.set(k, v)),
    delete: (k) => Promise.resolve(void mem.delete(k)),
  });
});
afterAll(() => {
  setStorageForTests(null);
  setSecretsForTests(null);
});

describe("القفل على شاشات المكدّس", () => {
  it("جلسة نشطة في شاشة عميقة: لا غطاء ولا انتقال", async () => {
    await wrap(ACTIVE);
    expect(screen.queryByTestId("lock-cover", { includeHiddenElements: true })).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("القفل في شاشة فاتورة: تُحجب فوراً ويُنتقل إلى القفل بمحو ما قبله", async () => {
    await wrap(ACTIVE);
    await act(() => doLock());
    expect(await screen.findByText("status:locked")).toBeTruthy();
    expect(screen.getByTestId("lock-cover", { includeHiddenElements: true })).toBeTruthy();
    expect(mockDismissAll).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/lock");
  });

  it("على شاشة القفل نفسها: لا غطاء فوقها ولا انتقال يدور", async () => {
    mockSegments = ["lock"];
    await wrap({ ...ACTIVE, status: "locked" });
    expect(screen.queryByTestId("lock-cover", { includeHiddenElements: true })).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe("فتح القفل على هاتف مشترك", () => {
  const LOCKED: SessionState = { ...ANONYMOUS, status: "locked", setupDone: true, deviceId: "d1" };

  it("رمز مستخدم آخر لا يفتح جلسة صاحب رمز الجهاز ولا يدوّر رمزه", async () => {
    const calls: string[] = [];
    const spy = ((input: RequestInfo | URL) => {
      calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;
    const mem = new Map<string, string>([
      ["device.refresh_token", "tok"],
      ["device.id", "d1"],
      ["device.user_id", "owner-1"],
    ]);
    setSecretsForTests({
      get: (k) => Promise.resolve(mem.get(k) ?? null),
      set: (k, v) => Promise.resolve(void mem.set(k, v)),
      delete: (k) => Promise.resolve(void mem.delete(k)),
    });
    await wrap(LOCKED, spy);
    let out = "";
    await act(async () => {
      out = await doUnlock("cashier-2");
    });
    expect(out).toBe("other_user");
    expect(calls.filter((u) => u.includes("device-refresh"))).toEqual([]);
    expect(mem.get("device.refresh_token")).toBe("tok");
    expect(await screen.findByText("status:locked")).toBeTruthy();
  });
});

describe("الوقوف بإشارة من الخادم", () => {
  const deps = () => ({
    wipe: jest.fn(() => Promise.resolve()),
    forgetDevice: jest.fn(() => Promise.resolve()),
  });

  it("المحو عن بُعد: يمحو المحلي ثم ينسى اعتماد الجهاز", async () => {
    const d = deps();
    await onPushHalt({ kind: "auth", status: 401, detail: "device_wiped" }, d);
    expect(d.wipe).toHaveBeenCalledTimes(1);
    expect(d.forgetDevice).toHaveBeenCalledTimes(1);
  });

  it("غير المحو (جهاز مسحوب، جيل تغيّر، رفض دائم): لا يُمحى شيء", async () => {
    const d = deps();
    await onPushHalt({ kind: "auth", status: 401, detail: "device_revoked" }, d);
    await onPushHalt({ kind: "epoch_mismatch", currentEpoch: "e2" }, d);
    await onPushHalt({ kind: "permanent", status: 400, detail: "protocol_version_unsupported" }, d);
    expect(d.wipe).not.toHaveBeenCalled();
    expect(d.forgetDevice).not.toHaveBeenCalled();
  });
});

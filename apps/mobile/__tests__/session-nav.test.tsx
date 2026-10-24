import { MemoryStorage } from "@sting/platform/memory";
import { tx } from "@sting/texts";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LogoutButton } from "@/components/logout-button";
import "@/lib/crypto";
import { SignedInRedirect } from "@/lib/nav";
import { setSecretsForTests } from "@/lib/secrets";
import { ANONYMOUS, SessionProvider, type SessionState } from "@/lib/session";
import { setStorageForTests } from "@/lib/storage";

/**
 * بجلسة صالحة لا رجوع إلى الدخول، والخروج بخطوتين كالويب (0005 §٢٠٢).
 */
const mockReplace = jest.fn();
const mockDismissAll = jest.fn();
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: T } = require("react-native") as typeof import("react-native");
  return {
    useRouter: () => ({
      replace: mockReplace,
      push: jest.fn(),
      canDismiss: () => true,
      dismissAll: mockDismissAll,
    }),
    Redirect: ({ href }: { href: string }) => <T>{`redirect:${href}`}</T>,
  };
});
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
const wrap = (initial: SessionState, ui: React.ReactElement) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SessionProvider fetchImpl={fetchOk} initial={initial}>
        {ui}
      </SessionProvider>
    </SafeAreaProvider>,
  );

beforeEach(() => {
  mockReplace.mockClear();
  mockDismissAll.mockClear();
  setStorageForTests(new MemoryStorage());
  const mem = new Map<string, string>();
  setSecretsForTests({
    get: (k) => Promise.resolve(mem.get(k) ?? null),
    set: (k, v) => Promise.resolve(void mem.set(k, v)),
    delete: (k) => Promise.resolve(void mem.delete(k)),
  });
});

describe("الجلسة والتنقّل", () => {
  it("بجلسة صالحة: شاشات ما قبل الدخول تُعيد إلى لوحة التحكم", async () => {
    await wrap(ACTIVE, <SignedInRedirect />);
    expect(screen.getByText("redirect:/")).toBeTruthy();
  });

  it("المقفل يُعاد إلى القفل، والزائر يبقى", async () => {
    await wrap({ ...ACTIVE, status: "locked" }, <SignedInRedirect />);
    expect(screen.getByText("redirect:/lock")).toBeTruthy();
  });

  it("الزائر يبقى في شاشة الدخول", async () => {
    await wrap(
      ANONYMOUS,
      <>
        <SignedInRedirect />
        <Text>login</Text>
      </>,
    );
    expect(screen.queryByText(/redirect:/)).toBeNull();
  });

  it("تسجيل الخروج بخطوتين ثم الدخول بلا رجوع", async () => {
    const K = "shared:features/home/logout-button.tsx";
    await wrap(ACTIVE, <LogoutButton />);
    await fireEvent.press(screen.getByRole("button", { name: tx(K, "تسجيل الخروج") }));
    expect(await screen.findByText(tx(K, "كل عملك مرفوع. الجهاز يبقى مُجهَّزاً."))).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: tx(K, "اخرج") }));
    expect(mockDismissAll).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/login");
  });
});

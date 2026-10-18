import { MemoryStorage } from "@sting/platform/memory";
import { tx } from "@sting/texts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import CreateOrg from "@/app/create-org";
import OnboardingScreen from "@/app/onboarding";
import Register from "@/app/register";
import { goAfterSetup, markFreshOrg } from "@/lib/after-setup";
import { setSecretsForTests } from "@/lib/secrets";
import {
  afterSignIn,
  ANONYMOUS,
  SessionProvider,
  type SessionState,
  useSession,
} from "@/lib/session";
import { setStorageForTests } from "@/lib/storage";

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockOpenOnWeb = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  Redirect: ({ href }: { href: string }) => {
    mockReplace(href);
    return null;
  },
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
function server(routes: Record<string, Route>) {
  const calls: { method: string; path: string; headers: Headers; body: unknown }[] = [];
  const impl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(req.url).pathname;
    const text = await req.clone().text();
    calls.push({
      method: req.method,
      path,
      headers: req.headers,
      body: text ? (JSON.parse(text) as unknown) : null,
    });
    const key = `${req.method} ${path}`;
    const route =
      routes[key] ??
      Object.entries(routes).find(([k]) => k.endsWith("*") && key.startsWith(k.slice(0, -1)))?.[1];
    return route ? route(req) : json(404, { detail: "not_found" });
  });
  return { fetch: impl as unknown as typeof fetch, calls };
}

function Status() {
  return <Text testID="status">{useSession().state.status}</Text>;
}
const renderWith = (ui: ReactElement, fetchImpl: typeof fetch, initial: SessionState) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SessionProvider fetchImpl={fetchImpl} initial={initial}>
        {ui}
        <Status />
      </SessionProvider>
    </SafeAreaProvider>,
  );

beforeEach(() => {
  mockReplace.mockClear();
  mockPush.mockClear();
  mockOpenOnWeb.mockClear();
  setStorageForTests(new MemoryStorage());
  const mem = new Map<string, string>();
  setSecretsForTests({
    get: (k) => Promise.resolve(mem.get(k) ?? null),
    set: (k, v) => Promise.resolve(void mem.set(k, v)),
    delete: (k) => Promise.resolve(void mem.delete(k)),
  });
});

const A2 = "ACC-02";

describe("ACC-02 — حساب جديد (0005 §١٧٦)", () => {
  it("البريد وحده: معرّف هاتف يُرفض محلياً بلا طلب", async () => {
    const s = server({});
    await renderWith(<Register />, s.fetch, ANONYMOUS);
    await fireEvent.changeText(screen.getByLabelText(tx(A2, "اسمك")), "سميرة");
    await fireEvent.changeText(screen.getByLabelText(tx(A2, "بريدك")), "0912345678");
    await fireEvent.changeText(screen.getByLabelText(tx(A2, "رقم واتساب")), "0912345678");
    await fireEvent.press(screen.getByRole("button", { name: tx(A2, "أرسل رمز التحقق") }));
    expect(
      await screen.findByText(
        tx(A2, "التسجيل بالبريد الإلكتروني حالياً — اكتب بريدك، وإليه يصل رمز التحقق."),
      ),
    ).toBeTruthy();
    expect(s.calls).toHaveLength(0);
  });

  it("الخطوات الثلاث: رمز ← كلمة مرور ← تذكرة بلا عضويات ← إنشاء المنشأة", async () => {
    const s = server({
      "POST /api/auth/verify/request": () => json(202, { policy: { code_length: 6 } }),
      "POST /api/auth/verify/confirm": () => json(200, { verified_ticket: "vt" }),
      "POST /api/auth/account/register": () => json(201, { select_ticket: "st", memberships: [] }),
    });
    await renderWith(<Register />, s.fetch, ANONYMOUS);
    await fireEvent.changeText(screen.getByLabelText(tx(A2, "اسمك")), "سميرة");
    await fireEvent.changeText(screen.getByLabelText(tx(A2, "بريدك")), "s@x.sd");
    await fireEvent.changeText(screen.getByLabelText(tx(A2, "رقم واتساب")), "0912345678");
    await fireEvent.press(screen.getByRole("button", { name: tx(A2, "أرسل رمز التحقق") }));
    await fireEvent.changeText(await screen.findByLabelText(tx(A2, "رمز التحقق")), "123456");
    await fireEvent.press(screen.getByRole("button", { name: tx(A2, "تأكيد الرمز") }));
    await fireEvent.changeText(await screen.findByLabelText(tx(A2, "كلمة المرور")), "sting-2026x");
    await fireEvent.changeText(screen.getByLabelText(tx(A2, "تأكيد كلمة المرور")), "sting-2026x");
    await fireEvent.press(
      screen.getByRole("button", { name: tx(A2, "أنشئ الحساب وتابع إلى المنشأة") }),
    );
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/create-org"));
    expect(screen.getByTestId("status").props.children).toBe("selecting");
    expect(s.calls.map((c) => c.body)).toEqual([
      { identifier: "s@x.sd", purpose: "register" },
      { identifier: "s@x.sd", purpose: "register", code: "123456" },
      {
        verified_ticket: "vt",
        password: "sting-2026x",
        display_name: "سميرة",
        phone: "0912345678",
      },
    ]);
  });
});

const A4 = "ACC-04";
const SELECTING = afterSignIn(ANONYMOUS, { select_ticket: "st", memberships: [] });
const SECTORS = {
  sectors: [
    { code: "grocery", name: "بقالة" },
    { code: "bakery", name: "مخبز" },
  ],
  currencies: [{ code: "SDG", name: "جنيه سوداني" }],
};
const CREATED = {
  tenant_id: "t9",
  tenant_name: "بقالة الأمل",
  branch_id: "b9",
  user_id: "u9",
  created: { items: 40, groups: 6, branches: 1 },
  access: "a9",
  refresh: "r9",
  session_id: "s9",
};

describe("ACC-04 — إنشاء المنشأة", () => {
  it("حقلان فارغان: إشعار واحد يذكرهما ولا طلب إنشاء", async () => {
    const s = server({ "GET /api/tenants/sectors": () => json(200, SECTORS) });
    await renderWith(<CreateOrg />, s.fetch, SELECTING);
    await screen.findByText("بقالة");
    await fireEvent.press(screen.getByRole("button", { name: tx(A4, "إنشاء المنشأة") }));
    expect(await screen.findByText(tx(A4, "حقلان يمنعان الإنشاء"))).toBeTruthy();
    expect(s.calls.some((c) => c.path === "/api/tenants")).toBe(false);
  });

  it("خطأ خادم: يستعلم بهوية الطلب نفسها ويُكمل — منشأة واحدة لا اثنتان", async () => {
    const s = server({
      "GET /api/tenants/sectors": () => json(200, SECTORS),
      "POST /api/tenants": () => json(500, { detail: "boom" }),
      "GET /api/tenants/creation/*": () => json(200, CREATED),
    });
    await renderWith(<CreateOrg />, s.fetch, SELECTING);
    await fireEvent.changeText(screen.getByLabelText(tx(A4, "اسم المنشأة")), "بقالة الأمل");
    await fireEvent.press(await screen.findByText("بقالة"));
    await fireEvent.press(screen.getByRole("button", { name: tx(A4, "إنشاء المنشأة") }));
    expect(await screen.findByText(tx(A4, "أُنشئت المنشأة"))).toBeTruthy();
    expect(screen.getByText("40")).toBeTruthy();
    const create = s.calls.filter((c) => c.path === "/api/tenants");
    expect(create).toHaveLength(1);
    expect(create[0].headers.get("X-Select-Ticket")).toBe("st");
    const id = (create[0].body as { client_request_id: string }).client_request_id;
    // الاستعلام بهوية الطلب نفسها
    expect(s.calls.some((c) => c.path === `/api/tenants/creation/${id}`)).toBe(true);
    expect(create[0].body).toMatchObject({
      name: "بقالة الأمل",
      sector: "grocery",
      currency: "SDG",
    });
    expect(screen.getByTestId("status").props.children).toBe("active");
    await fireEvent.press(screen.getByRole("button", { name: tx(A4, "جهّز هذا الجهاز") }));
    expect(mockReplace).toHaveBeenCalledWith("/setup-device");
  });
});

const A10 = "ACC-10";
const ACTIVE: SessionState = {
  ...ANONYMOUS,
  status: "active",
  tenantId: "t9",
  userId: "u9",
  setupDone: true,
  tokens: { access: "a", refresh: "r", sessionId: "s" },
};
const ONBOARDING = {
  tenant_name: "بقالة الأمل",
  currency_name: "جنيه سوداني",
  branches: 1,
  dismissed: false,
  steps: { items: { imported: 0, rejected: 0, sales: 0 }, logo: { present: false } },
};

describe("ACC-10 — معالج البدء", () => {
  it("منشأة جديدة: الخطوات بتقدّمها، والشعار على الويب، والصرف يُحفظ خادمياً", async () => {
    const s = server({
      "GET /api/tenants/onboarding": () => json(200, ONBOARDING),
      "PATCH /api/tenants/onboarding": () => json(200, { ...ONBOARDING, dismissed: true }),
    });
    await renderWith(<OnboardingScreen />, s.fetch, ACTIVE);
    expect(await screen.findByText(tx(A10, "نقترح أصنافك بعد أول أسبوع بيع"))).toBeTruthy();
    expect(screen.getByTestId("ACC-10").props.accessibilityHint).toBe("empty");
    await fireEvent.press(screen.getByLabelText(`${tx(A10, "شعار")} — ${tx(A10, "ابدأ")}`));
    expect(mockOpenOnWeb).toHaveBeenCalledWith("/onboarding");
    await fireEvent.press(screen.getByRole("button", { name: tx(A10, "اكتمل المعالج") }));
    expect(
      await screen.findByText(
        tx(
          A10,
          "المعالج لم يعد يظهر. وما تُخطّيه يبقى متاحاً في الإعدادات بمكانه المعروف لا مخبوءاً.",
        ),
      ),
    ).toBeTruthy();
    expect(s.calls.find((c) => c.method === "PATCH")?.body).toEqual({ dismissed: true });
  });

  it("بعد التجهيز: المنشأة الجديدة إلى المعالج فوق الرئيسية مرة واحدة", () => {
    const router = { replace: jest.fn(), push: jest.fn() };
    markFreshOrg();
    goAfterSetup(router);
    expect(router.replace).toHaveBeenCalledWith("/");
    expect(router.push).toHaveBeenCalledWith("/onboarding");
    goAfterSetup(router);
    expect(router.push).toHaveBeenCalledTimes(1);
  });
});

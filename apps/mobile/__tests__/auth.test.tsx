import { tx } from "@sting/texts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import Login from "@/app/login";
import SelectOrg from "@/app/select-org";
import { afterSignIn, ANONYMOUS, SessionProvider, type SessionState } from "@/lib/session";

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  Redirect: ({ href }: { href: string }) => {
    mockReplace(href);
    return null;
  },
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Route = (req: Request) => Response | Promise<Response>;
function server(routes: Record<string, Route>) {
  const calls: Request[] = [];
  const impl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    calls.push(req);
    const key = `${req.method} ${new URL(req.url).pathname}`;
    const route = routes[key];
    return route ? route(req) : json(404, { detail: "not_found" });
  });
  return { fetch: impl as unknown as typeof fetch, calls };
}

const renderWith = (ui: ReactElement, fetchImpl: typeof fetch, initial?: SessionState) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SessionProvider fetchImpl={fetchImpl} initial={initial}>
        {ui}
      </SessionProvider>
    </SafeAreaProvider>,
  );

const TOKENS = { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" };

beforeEach(() => mockReplace.mockClear());

describe("الجلسة (0005 §١٧٢)", () => {
  it("دخول برموز = جلسة نشطة؛ وبتذكرة = اختيار منشأة بصفوف كالويب", () => {
    const active = afterSignIn(ANONYMOUS, TOKENS);
    expect(active.status).toBe("active");
    expect(active.tokens).toEqual({ access: "a", refresh: "r", sessionId: "s" });
    const selecting = afterSignIn(ANONYMOUS, {
      select_ticket: "tk",
      memberships: [{ user_id: "u", tenant_id: "t", tenant_name: "بقالة النيل", is_owner: true }],
    });
    expect(selecting.status).toBe("selecting");
    expect(selecting.selection?.memberships[0]).toMatchObject({
      tenant_name: "بقالة النيل",
      role_name: "مالك",
      scope: "كل الفروع",
      status: "active",
    });
  });
});

describe("ACC-02 — الدخول", () => {
  const fill = async () => {
    await fireEvent.changeText(
      screen.getByLabelText(tx("ACC-02", "رقم الهاتف أو البريد")),
      "o@x.sd",
    );
    await fireEvent.changeText(
      screen.getByLabelText(tx("ACC-02", "كلمة المرور")),
      "sting-demo-2026",
    );
    await fireEvent.press(screen.getByRole("button", { name: tx("ACC-02", "دخول") }));
  };

  it("منشأة واحدة: الدخول يفتح التبويبات، والجسم المعرّف وكلمة المرور", async () => {
    const s = server({ "POST /api/auth/account/login": () => json(200, TOKENS) });
    await renderWith(<Login />, s.fetch);
    await fill();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/"));
    const body = (await s.calls[0].clone().json()) as Record<string, string>;
    expect(body).toEqual({ identifier: "o@x.sd", password: "sting-demo-2026" });
  });

  it("بيانات خاطئة: رسالة واحدة للحالتين، ولا انتقال", async () => {
    const s = server({
      "POST /api/auth/account/login": () => json(401, { detail: "invalid_credentials" }),
    });
    await renderWith(<Login />, s.fetch);
    await fill();
    expect(await screen.findByText(tx("ACC-02", "بيانات الدخول غير صحيحة"))).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("عضويات متعدّدة: إلى اختيار المنشأة (ACC-03)", async () => {
    const s = server({
      "POST /api/auth/account/login": () =>
        json(200, {
          select_ticket: "tk",
          memberships: [
            { user_id: "u", tenant_id: "t1", tenant_name: "بقالة النيل", is_owner: true },
            { user_id: "u", tenant_id: "t2", tenant_name: "مخبز الصباح", is_owner: false },
          ],
        }),
    });
    await renderWith(<Login />, s.fetch);
    await fill();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/select-org"));
  });
});

describe("ACC-03 — اختيار المنشأة", () => {
  const selecting = afterSignIn(ANONYMOUS, {
    select_ticket: "tk",
    memberships: [
      { user_id: "u", tenant_id: "t1", tenant_name: "بقالة النيل", is_owner: true },
      { user_id: "u", tenant_id: "t2", tenant_name: "مخبز الصباح", is_owner: false },
    ],
  });

  it("اختيار منشأة يرسل التذكرة ويفتح التبويبات", async () => {
    const s = server({
      "GET /api/account/memberships": () =>
        json(200, {
          memberships: [
            { ...selecting.selection!.memberships[0] },
            { ...selecting.selection!.memberships[1], role_name: "كاشير", scope: "بحري" },
          ],
        }),
      "POST /api/account/select": () => json(200, { ...TOKENS, tenant_id: "t2" }),
    });
    await renderWith(<SelectOrg />, s.fetch, selecting);
    await fireEvent.press(await screen.findByText("مخبز الصباح"));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/"));
    const select = s.calls.find((c) => new URL(c.url).pathname === "/api/account/select")!;
    expect(select.headers.get("X-Select-Ticket")).toBe("tk");
    expect(await select.clone().json()).toEqual({ tenant_id: "t2" });
  });

  it("المنشأة الموقوفة لا تُفتح وتقول سبب الوقف", async () => {
    const s = server({
      "GET /api/account/memberships": () =>
        json(200, {
          memberships: [
            { ...selecting.selection!.memberships[0] },
            { ...selecting.selection!.memberships[1], status: "suspended" },
          ],
        }),
    });
    await renderWith(<SelectOrg />, s.fetch, selecting);
    await fireEvent.press(await screen.findByText("مخبز الصباح"));
    expect(
      await screen.findByText(
        tx("ACC-03", "دخولك موقوف بقرار المالك. اتصل به لرفع الوقف — بياناتك وأثرك محفوظان."),
      ),
    ).toBeTruthy();
    expect(s.calls.some((c) => new URL(c.url).pathname === "/api/account/select")).toBe(false);
  });
});

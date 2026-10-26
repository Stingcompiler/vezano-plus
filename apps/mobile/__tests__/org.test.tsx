import { MemoryStorage } from "@sting/platform/memory";
import { tx } from "@sting/texts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import OrgAudit from "@/app/org/audit";
import OrgBranches from "@/app/org/branches";
import OrgDevices from "@/app/org/devices";
import OrgRoles from "@/app/org/roles";
import OrgSettings from "@/app/org/settings";
import OrgExpiry from "@/app/org/subscription/expiry";
import OrgSubscription from "@/app/org/subscription/index";
import OrgRenew from "@/app/org/subscription/renew";
import OrgUsers from "@/app/org/users/index";
import OrgRevoke from "@/app/org/users/[id]/revoke";
import { changesOf } from "@/features/org/roles";
import { auditQuery, widen } from "@/features/org/audit";
import { confirmBlocker } from "@/features/org/revoke";
import { proofKind } from "@/features/org/renew";
import { arabicDigits, tooWideField } from "@/features/org/settings";
import "@/lib/crypto";
import { setSecretsForTests } from "@/lib/secrets";
import { ANONYMOUS, SessionProvider, type SessionState } from "@/lib/session";
import { setStorageForTests } from "@/lib/storage";

const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: jest.fn(), push: mockPush }),
  useLocalSearchParams: () => mockParams,
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
const calls: { key: string; body: unknown }[] = [];
function server(routes: Record<string, Route>, down = false) {
  const impl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    if (down) throw new TypeError("Network request failed");
    const key = `${req.method} ${new URL(req.url).pathname}`;
    const text = req.method === "GET" ? "" : await req.clone().text();
    calls.push({ key, body: text ? JSON.parse(text) : null });
    const route = routes[key];
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
  mockPush.mockClear();
  mockParams = {};
  calls.length = 0;
  storage = new MemoryStorage();
  setStorageForTests(storage);
  const mem = new Map<string, string>();
  setSecretsForTests({
    get: (k) => Promise.resolve(mem.get(k) ?? null),
    set: (k, v) => Promise.resolve(void mem.set(k, v)),
    delete: (k) => Promise.resolve(void mem.delete(k)),
  });
});

const hint = (id: string) => screen.getByTestId(id).props.accessibilityHint as string;
const NOW = new Date().toISOString();

const USERS = {
  users: [
    {
      id: "u1",
      display_name: "مالك المحل",
      is_owner: true,
      status: "active",
      roles: [{ code: "owner", name: "مالك" }],
      branches: [],
      all_branches: true,
      operations: 10,
    },
    {
      id: "u2",
      display_name: "سارة",
      is_owner: false,
      status: "active",
      roles: [{ code: "cashier", name: "كاشير" }],
      branches: [{ id: "b1", name: "الرئيسي" }],
      all_branches: false,
      operations: 3,
    },
  ],
  invitations: [
    {
      id: "i1",
      identifier_masked: "a***@x.com",
      role_code: "cashier",
      role_name: "كاشير",
      branch_id: "b1",
      branch_name: "الرئيسي",
      status: "sent",
      sent_at: NOW,
      expires_at: NOW,
      inviter_name: "مالك المحل",
    },
  ],
  counts: { users: 2, open_invitations: 1 },
  invite_ttl_hours: 72,
  branches: [{ id: "b1", name: "الرئيسي" }],
  roles: [{ id: "r1", code: "cashier", name: "كاشير" }],
  can_invite: true,
};

describe("ORG-01 — المستخدمون والدعوات", () => {
  it("ready: صفوف المستخدمين والدعوات؛ المالك بلا «سحب الوصول» والموظف معه", async () => {
    await renderWith(<OrgUsers />, server({ "GET /api/org/users": () => json(200, USERS) }));
    await waitFor(() => expect(hint("ORG-01")).toBe("ready"));
    expect(screen.getAllByText(tx("ORG-01", "سحب الوصول"))).toHaveLength(1);
    expect(screen.getByText(tx("ORG-01", "أعد إرسالها"))).toBeTruthy();
    await fireEvent.press(screen.getByText(tx("ORG-01", "سحب الوصول")));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/org/users/[id]/revoke",
      params: { id: "u2" },
    });
  });

  it("empty: مستخدم واحد وبلا دعوات", async () => {
    await renderWith(
      <OrgUsers />,
      server({
        "GET /api/org/users": () =>
          json(200, { ...USERS, users: [USERS.users[0]], invitations: [] }),
      }),
    );
    await waitFor(() => expect(hint("ORG-01")).toBe("empty"));
  });

  it("الدعوة بلا صلاحية: الزر معطّل بسببه الظاهر", async () => {
    await renderWith(
      <OrgUsers />,
      server({ "GET /api/org/users": () => json(200, { ...USERS, can_invite: false }) }),
    );
    await waitFor(() => expect(hint("ORG-01")).toBe("ready"));
    expect(screen.getByText(tx("ORG-01", "الدعوة للمالك ومدير الفرع"))).toBeTruthy();
  });

  it("دعوة لمعرّف مدعوّ أصلاً (409): validation_error ومخرجان", async () => {
    await renderWith(
      <OrgUsers />,
      server({
        "GET /api/org/users": () => json(200, USERS),
        "POST /api/org/invitations": () =>
          json(409, { detail: "duplicate", existing: USERS.invitations[0] }),
      }),
    );
    await waitFor(() => expect(hint("ORG-01")).toBe("ready"));
    await fireEvent.press(screen.getByText(tx("ORG-01", "دعوة مستخدم")));
    await fireEvent.changeText(
      screen.getByLabelText(tx("ORG-01", "رقم الهاتف أو البريد")),
      "a@x.com",
    );
    await fireEvent.press(screen.getByText(tx("ORG-01", "إرسال الدعوة")));
    await waitFor(() => expect(hint("ORG-01")).toBe("validation_error"));
    expect(screen.getByText(tx("ORG-01", "دعوة لرقم مدعوّ أصلاً"))).toBeTruthy();
    expect(calls.find((c) => c.key === "POST /api/org/invitations")?.body).toEqual({
      identifier: "a@x.com",
      role_id: "r1",
      branch_id: "b1",
    });
  });

  it("إرسال ناجح: success مع رابط الدعوة", async () => {
    await renderWith(
      <OrgUsers />,
      server({
        "GET /api/org/users": () => json(200, USERS),
        "POST /api/org/invitations": () =>
          json(200, { invitation: USERS.invitations[0], link: "https://x/invite/abc", grants: [] }),
      }),
    );
    await waitFor(() => expect(hint("ORG-01")).toBe("ready"));
    await fireEvent.press(screen.getByText(tx("ORG-01", "دعوة مستخدم")));
    await fireEvent.changeText(
      screen.getByLabelText(tx("ORG-01", "رقم الهاتف أو البريد")),
      "a@x.com",
    );
    await fireEvent.press(screen.getByText(tx("ORG-01", "إرسال الدعوة")));
    await waitFor(() => expect(hint("ORG-01")).toBe("success"));
    expect(screen.getByText("https://x/invite/abc")).toBeTruthy();
  });
});

const ROLES = {
  tenant_name: "محل الأمل",
  roles: [
    { id: "r1", code: "cashier", name: "كاشير", users: 2, locked: false },
    { id: "r4", code: "owner", name: "مالك", users: 1, locked: true },
  ],
  rows: [
    {
      key: "discount",
      label: "الخصم",
      note: "حدّ للعملية",
      financial: true,
      cells: [
        { role_id: "r1", label: "لا", value: "no", limit_minor: null, period: "" },
        { role_id: "r4", label: "بلا حد", value: "unlimited", limit_minor: null, period: "" },
      ],
    },
  ],
  can_edit: true,
};

describe("ORG-02 — مصفوفة الأدوار", () => {
  it("لغير المالك: permission_denied بلا زر حفظ", async () => {
    await renderWith(
      <OrgRoles />,
      server({ "GET /api/org/roles": () => json(200, { ...ROLES, can_edit: false }) }),
    );
    await waitFor(() => expect(hint("ORG-02")).toBe("permission_denied"));
    expect(screen.queryByText(tx("ORG-02", "حفظ المصفوفة"))).toBeNull();
  });

  it("تحرير حدّ مالي ثم الحفظ يرسل الحمولة نفسها ويعرض الأثر (success)", async () => {
    await renderWith(
      <OrgRoles />,
      server({
        "GET /api/org/roles": () => json(200, ROLES),
        "PUT /api/org/roles": () => json(200, { ...ROLES, changed_cells: 1, affected_users: 2 }),
      }),
    );
    await waitFor(() => expect(hint("ORG-02")).toBe("ready"));
    // لا تغيير بعد: الحفظ معطّل بسببه
    expect(screen.getByText(tx("ORG-02", "لا تغيير بعد"))).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "الخصم" }));
    await fireEvent.press(screen.getByText(tx("ORG-02", "حد مالي")));
    await fireEvent.changeText(screen.getByLabelText(tx("ORG-02", "حدّ")), "200");
    await fireEvent.press(screen.getByText(tx("ORG-01", "حسناً")));
    await fireEvent.press(screen.getByText(tx("ORG-02", "حفظ المصفوفة")));
    await waitFor(() => expect(hint("ORG-02")).toBe("success"));
    expect(calls.find((c) => c.key === "PUT /api/org/roles")?.body).toEqual({
      changes: [
        { role_id: "r1", key: "discount", value: "limit", limit_minor: "20000", period: "per_op" },
      ],
    });
  });

  it("changesOf: حدّ مالي يحمل القيمة والنطاق وغيره يُفرَّغ", () => {
    const m = new Map([
      [
        "r1:discount",
        { role_id: "r1", label: "", value: "limit" as const, limit_minor: "20000", period: "" },
      ],
      [
        "r1:refund",
        { role_id: "r1", label: "", value: "yes" as const, limit_minor: "5", period: "daily" },
      ],
    ]);
    expect(changesOf(m)).toEqual([
      { role_id: "r1", key: "discount", value: "limit", limit_minor: "20000", period: "per_op" },
      { role_id: "r1", key: "refund", value: "yes", limit_minor: null, period: "" },
    ]);
  });
});

describe("ORG-03 — الفروع", () => {
  const BR = {
    can_create: true,
    branches: [
      {
        id: "b1",
        name: "الرئيسي",
        code: "MAIN",
        is_active: true,
        is_default: true,
        code_locked: true,
        ledger: {
          invoices: 4,
          shifts: 2,
          open_shifts: 0,
          stock_items: 0,
          receivables_minor: "0",
          has_ledger: true,
        },
        devices: [],
        staff: 2,
      },
      {
        id: "b2",
        name: "الفرع الثاني",
        code: "B2",
        is_active: true,
        is_default: false,
        code_locked: false,
        ledger: {
          invoices: 9,
          shifts: 3,
          open_shifts: 1,
          stock_items: 7,
          receivables_minor: "12345",
          has_ledger: true,
        },
        devices: [],
        staff: 1,
      },
    ],
  };
  it("«حذف» يفتح المحجوب: validation_error والإقفال معطّل بسببه والحذف غير متاح", async () => {
    await renderWith(<OrgBranches />, server({ "GET /api/org/branches": () => json(200, BR) }));
    await waitFor(() => expect(hint("ORG-03")).toBe("ready"));
    await fireEvent.press(screen.getByText(tx("ORG-03", "حذف")));
    await waitFor(() => expect(hint("ORG-03")).toBe("validation_error"));
    expect(screen.getByText(tx("ORG-03", "المخزون المتبقي يُحوَّل أولاً"))).toBeTruthy();
    expect(screen.getByText(tx("ORG-03", "الحذف يترك فواتير بلا فرع"))).toBeTruthy();
  });
  it("مدير فرع: permission_denied ولا «فرع جديد»", async () => {
    await renderWith(
      <OrgBranches />,
      server({ "GET /api/org/branches": () => json(200, { ...BR, can_create: false }) }),
    );
    await waitFor(() => expect(hint("ORG-03")).toBe("permission_denied"));
    expect(screen.queryByText(tx("ORG-03", "فرع جديد"))).toBeNull();
  });
});

describe("ORG-04 — الأجهزة", () => {
  const DEV = {
    devices: [
      {
        id: "d1",
        name: "كاشير 1",
        prefix: "POS1",
        branch_id: "b1",
        branch_name: "الرئيسي",
        status: "active",
        connectivity: "connected",
        last_seen_at: NOW,
        pending: 0,
        pending_at: "",
        users: ["سارة"],
        registered_at: NOW,
        sells: true,
      },
    ],
    counts: { total: 1, active: 1, pending_total: 0 },
    device_limit: 3,
    as_of: NOW,
  };
  it("ready ويحفظ آخر ردّ ناجح للعمل بلا اتصال", async () => {
    await renderWith(<OrgDevices />, server({ "GET /api/org/devices": () => json(200, DEV) }));
    await waitFor(() => expect(hint("ORG-04")).toBe("ready"));
    await waitFor(async () =>
      expect(await storage.read((t) => t.getMeta("org.devices_cache"))).toContain("POS1"),
    );
  });
  it("بلا شبكة مع محفوظ: offline ويعرض المحفوظ", async () => {
    await storage.transaction((t) => t.putMeta("org.devices_cache", JSON.stringify(DEV)));
    await renderWith(<OrgDevices />, server({}, true));
    await waitFor(() => expect(hint("ORG-04")).toBe("offline"));
    await waitFor(() => expect(screen.getByText("كاشير 1")).toBeTruthy());
    expect(
      screen.getByText(tx("ORG-04", "بلا اتصال — القائمة كما كانت عند آخر تحديث")),
    ).toBeTruthy();
  });
  it("بلا شبكة ولا محفوظ: offline برسالة «لا قائمة مخزَّنة بعد»", async () => {
    await renderWith(<OrgDevices />, server({}, true));
    await waitFor(() => expect(hint("ORG-04")).toBe("offline"));
    expect(screen.getByText(tx("ORG-04", "بلا اتصال — لا قائمة مخزَّنة بعد"))).toBeTruthy();
  });
  it("خطأ خادم مع محفوظ: stale", async () => {
    await storage.transaction((t) => t.putMeta("org.devices_cache", JSON.stringify(DEV)));
    await renderWith(
      <OrgDevices />,
      server({ "GET /api/org/devices": () => json(500, { detail: "x" }) }),
    );
    await waitFor(() => expect(hint("ORG-04")).toBe("stale"));
  });
});

const PREVIEW = {
  user: {
    id: "u2",
    display_name: "سارة",
    is_owner: false,
    status: "active",
    deactivated_at: "",
  },
  scopes: [{ branch_id: "b1", branch_name: "الرئيسي", role_name: "كاشير", in_actor_scope: true }],
  devices: [
    {
      id: "d1",
      name: "كاشير 1",
      branch_name: "الرئيسي",
      status: "active",
      pending: 0,
      shared_with: [],
    },
  ],
  pending_total: 0,
  ledger: { invoices: 5, shifts: 2, open_shift: null },
  can: { disable_user: true, revoke_branch: true, wipe_device: true },
  blockers: [],
};

describe("ORG-05 — السحب", () => {
  it("وردية مفتوحة: validation_error والتعطيل معطّل بسببه", async () => {
    mockParams = { id: "u2" };
    await renderWith(
      <OrgRevoke />,
      server({
        "GET /api/org/users/u2/revocation": () =>
          json(200, {
            ...PREVIEW,
            blockers: ["open_shift"],
            ledger: {
              ...PREVIEW.ledger,
              open_shift: { id: "s1", opened_at: NOW, branch_name: "x" },
            },
          }),
      }),
    );
    await waitFor(() => expect(hint("ORG-05")).toBe("validation_error"));
    expect(
      screen.getByText(tx("ORG-05", "وردية مفتوحة باسمه — تُقفل إدارياً بعدّ حاضر أولاً")),
    ).toBeTruthy();
  });

  it("ready: التأكيد معطّل حتى يُختار الخيار ثم يرسل disable بنمط now", async () => {
    mockParams = { id: "u2" };
    await renderWith(
      <OrgRevoke />,
      server({
        "GET /api/org/users/u2/revocation": () => json(200, PREVIEW),
        "POST /api/org/users/u2/revocation": () =>
          json(200, { ...PREVIEW, action: "disable", remaining_branches: [] }),
      }),
    );
    await waitFor(() => expect(hint("ORG-05")).toBe("ready"));
    expect(screen.getByText(tx("ORG-05", "اختر كيف يُسحب"))).toBeTruthy();
    await fireEvent.press(
      screen.getByText(tx("ORG-05", "اسحب الآن — ويبقى المعلّق محفوظاً للاسترداد لاحقاً")),
    );
    await fireEvent.press(screen.getByText(tx("ORG-05", "تأكيد السحب")));
    await waitFor(() => expect(hint("ORG-05")).toBe("success"));
    expect(calls.find((c) => c.key === "POST /api/org/users/u2/revocation")?.body).toEqual({
      action: "disable",
      mode: "now",
      reason: "",
    });
  });

  it("لا صلاحية (403): permission_denied", async () => {
    mockParams = { id: "u2" };
    await renderWith(
      <OrgRevoke />,
      server({ "GET /api/org/users/u2/revocation": () => json(403, { detail: "forbidden" }) }),
    );
    await waitFor(() => expect(hint("ORG-05")).toBe("permission_denied"));
  });

  it("confirmBlocker: المحو يطلب الإقرار المكتوب", () => {
    expect(confirmBlocker(null, null, "")).toBe(tx("ORG-05", "اختر كيف يُسحب"));
    expect(confirmBlocker("wipe", null, "  ")).toBe(tx("ORG-05", "الإقرار المكتوب إلزامي"));
    expect(confirmBlocker("wipe", null, "أقرّ")).toBeUndefined();
    expect(confirmBlocker(null, "b1", "")).toBeUndefined();
  });
});

const SUB = {
  plan: {
    code: "basic",
    name: "الأساسية",
    trial: false,
    state: "active",
    expires_at: "2026-11-20T00:00:00Z",
    days_since_expiry: 0,
    price_minor: "5000000",
    currency: "SDG",
  },
  limits: {
    branches: { used: 1, max: 2 },
    devices: { used: 1, max: 3 },
    users: { used: 2, max: null },
    campaign_quota: { used: 0, max: 1000 },
  },
  features: [{ code: "market", label: "السوق", note: "حتى 50 عرضاً", status: "open" }],
  if_expired: { continues: [], stops: [] },
  plans: [
    {
      code: "basic",
      name: "الأساسية",
      price_minor: "5000000",
      period: "month",
      trial_days: null,
      blurb: "فرعان",
      current: true,
    },
    {
      code: "pro",
      name: "المتقدمة",
      price_minor: "9000000",
      period: "month",
      trial_days: null,
      blurb: "5 فروع",
      current: false,
    },
  ],
  can_see_amounts: true,
  can_renew: true,
};

describe("ORG-06 — الاشتراك", () => {
  it("ready: «ترقية» على الباقة الأعلى يجلب العرض ثم يفتح التجديد بمعامل upgrade", async () => {
    await renderWith(
      <OrgSubscription />,
      server({
        "GET /api/org/subscription": () => json(200, SUB),
        "GET /api/org/subscription/change": () =>
          json(200, {
            quote: {
              from: { code: "basic", name: "الأساسية", price_minor: "1" },
              to: { code: "pro", name: "المتقدمة", price_minor: "2" },
              kind: "upgrade",
              remaining_days: 10,
              expires_at: NOW,
              amount_minor: "100000",
              currency: "SDG",
              effective: "now",
              blocked_reasons: [],
              pending_downgrade: "",
              note: "ملاحظة",
            },
          }),
      }),
    );
    await waitFor(() => expect(hint("ORG-06")).toBe("ready"));
    await fireEvent.press(screen.getByText(tx("ORG-06", "ترقية")));
    const pay = await screen.findByText(tx("ORG-06", "ادفع الفرق وارفع الإثبات"));
    await fireEvent.press(pay);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/org/subscription/renew",
      params: { upgrade: "pro" },
    });
  });
  it("المبالغ لغير المالك: permission_denied بلا قائمة الباقات", async () => {
    await renderWith(
      <OrgSubscription />,
      server({
        "GET /api/org/subscription": () => json(200, { ...SUB, can_see_amounts: false }),
      }),
    );
    await waitFor(() => expect(hint("ORG-06")).toBe("permission_denied"));
    expect(screen.queryByText(tx("ORG-06", "الباقات"))).toBeNull();
  });
  it("منتهي: expired", async () => {
    await renderWith(
      <OrgSubscription />,
      server({
        "GET /api/org/subscription": () =>
          json(200, { ...SUB, plan: { ...SUB.plan, state: "expired", days_since_expiry: 3 } }),
      }),
    );
    await waitFor(() => expect(hint("ORG-06")).toBe("expired"));
  });
});

const DUE = {
  due: {
    plan_code: "basic",
    plan_name: "الأساسية",
    amount_minor: "5000000",
    currency: "SDG",
    period_label: "شهر",
    review_sla: "يوم عمل",
    covers_until: "2026-12-20T00:00:00Z",
    pay_to: { bank: "بنك الخرطوم", account: "1234567", holder: "فيزانو" },
  },
  proofs: [],
  can_submit: true,
  review_sla: "يوم عمل",
};

describe("ORG-07 — إثبات التحويل", () => {
  it("بطاقة «حوّل إلى» ورقم الحساب mono وتغطية الفترة؛ بلا رقم عملية: validation_error ولا طلب", async () => {
    await renderWith(
      <OrgRenew />,
      server({ "GET /api/org/subscription/proofs": () => json(200, DUE) }),
    );
    await waitFor(() => expect(hint("ORG-07")).toBe("ready"));
    expect(screen.getByText("1234567")).toBeTruthy();
    expect(screen.getByText("2026-12-20")).toBeTruthy();
    await fireEvent.press(screen.getByText(tx("ORG-07", "إرسال الإثبات")));
    await waitFor(() => expect(hint("ORG-07")).toBe("validation_error"));
    expect(calls.some((c) => c.key === "POST /api/org/subscription/proofs")).toBe(false);
  });

  it("الإرسال بالرقم نصاً بلا صورة: الحمولة صحيحة ثم success معلّق للمراجعة", async () => {
    await renderWith(
      <OrgRenew />,
      server({
        "GET /api/org/subscription/proofs": () => json(200, DUE),
        "POST /api/org/subscription/proofs": () =>
          json(200, {
            ...DUE,
            proof: {
              id: "p1",
              reference: "TX-9",
              plan_code: "basic",
              amount_minor: "5000000",
              period_label: "شهر",
              image_name: "",
              image_size: 0,
              has_image: false,
              status: "pending",
              submitted_at: NOW,
              reviewed_at: "",
              reviewed_by_name: "",
              rejection_reason: "",
              extension_days: 0,
            },
            proofs: [],
          }),
      }),
    );
    await waitFor(() => expect(hint("ORG-07")).toBe("ready"));
    await fireEvent.changeText(
      screen.getByLabelText(`${tx("ORG-07", "رقم العملية البنكية — مطلوب")} *`.replace(" *", "")),
      "TX-9",
    );
    await fireEvent.press(screen.getByText(tx("ORG-07", "إرسال الإثبات")));
    await waitFor(() => expect(hint("ORG-07")).toBe("success"));
    expect(calls.find((c) => c.key === "POST /api/org/subscription/proofs")?.body).toEqual({
      reference: "TX-9",
      cycle: "monthly",
      plan_code: "basic",
      kind: "renewal",
      addon_kind: "",
      addon_qty: 0,
      image_name: "",
      image_size: 0,
      image_data: "",
    });
  });

  it("رقم مكرَّر (409): validation_error بعرض الاعتماد الأول", async () => {
    await renderWith(
      <OrgRenew />,
      server({
        "GET /api/org/subscription/proofs": () => json(200, DUE),
        "POST /api/org/subscription/proofs": () =>
          json(409, {
            detail: "dup",
            existing: { status: "approved", submitted_at: "2026-10-01T00:00:00Z" },
          }),
      }),
    );
    await waitFor(() => expect(hint("ORG-07")).toBe("ready"));
    await fireEvent.changeText(
      screen.getByLabelText(tx("ORG-07", "رقم العملية البنكية — مطلوب")),
      "TX-1",
    );
    await fireEvent.press(screen.getByText(tx("ORG-07", "إرسال الإثبات")));
    await waitFor(() => expect(hint("ORG-07")).toBe("validation_error"));
    expect(
      screen.getByText(tx("ORG-07", "هذا الرقم رُفع من قبل —"), { exact: false }),
    ).toBeTruthy();
  });

  it("فشل الإرسال (لا شبكة): server_error ويبقى النموذج", async () => {
    await renderWith(
      <OrgRenew />,
      server({
        "GET /api/org/subscription/proofs": () => json(200, DUE),
        "POST /api/org/subscription/proofs": () => json(500, { detail: "x" }),
      }),
    );
    await waitFor(() => expect(hint("ORG-07")).toBe("ready"));
    await fireEvent.changeText(
      screen.getByLabelText(tx("ORG-07", "رقم العملية البنكية — مطلوب")),
      "TX-2",
    );
    await fireEvent.press(screen.getByText(tx("ORG-07", "إرسال الإثبات")));
    await waitFor(() => expect(hint("ORG-07")).toBe("server_error"));
    expect(screen.getByText(tx("ORG-07", "فشل رفع الإثبات"))).toBeTruthy();
  });

  it("proofKind: إضافة ثم ترقية ثم تجديد", () => {
    const addon = { kind: "devices", qty: 2, plan_code: "basic" } as never;
    const up = { to: { code: "pro", name: "x" } } as never;
    expect(proofKind(addon, null, "basic")).toMatchObject({ kind: "addon", addon_qty: 2 });
    expect(proofKind(null, up, "basic")).toMatchObject({ kind: "upgrade", plan_code: "pro" });
    expect(proofKind(null, null, "basic")).toMatchObject({ kind: "renewal", plan_code: "basic" });
  });
});

describe("ORG-08 — انتهاء الاشتراك", () => {
  const EXP = {
    state: "expired",
    expired: true,
    expired_at: "2026-10-01T00:00:00Z",
    days_since_expiry: 20,
    continues: ["البيع"],
    stops: ["الحملات"],
    can_renew: true,
    can_see_amounts: true,
    plan_name: "الأساسية",
  };
  it("expired للمالك مع زر التجديد وقائمتي ما يستمر وما يتوقف", async () => {
    await renderWith(
      <OrgExpiry />,
      server({ "GET /api/org/subscription/expiry": () => json(200, EXP) }),
    );
    await waitFor(() => expect(hint("ORG-08")).toBe("expired"));
    expect(screen.getByText(tx("ORG-08", "تجديد الاشتراك"))).toBeTruthy();
    expect(screen.getByText("البيع")).toBeTruthy();
    expect(screen.getByText("الحملات")).toBeTruthy();
  });
  it("الموظف لا يجدّد: permission_denied", async () => {
    await renderWith(
      <OrgExpiry />,
      server({
        "GET /api/org/subscription/expiry": () => json(200, { ...EXP, can_renew: false }),
      }),
    );
    await waitFor(() => expect(hint("ORG-08")).toBe("permission_denied"));
    expect(screen.queryByText(tx("ORG-08", "تجديد الاشتراك"))).toBeNull();
  });
});

describe("ORG-09 — الإعدادات", () => {
  const SET = {
    version: 3,
    updated_at: NOW,
    updated_by_name: "x",
    name: "محل الأمل",
    currency: "SDG",
    currency_exponent: 2,
    receipt: { header: "أهلاً", footer: "شكراً", paper_width: "58", max_chars: 32 },
    locale: { language: "ar", numerals: "latin" },
    payment_methods: [],
    can_edit: true,
  };
  it("حفظ بإصدار قديم (409): conflict برسالة «حُفظت نسخة أحدث»", async () => {
    await renderWith(
      <OrgSettings />,
      server({
        "GET /api/org/settings": () => json(200, SET),
        "GET /api/org/ownership": () => json(403, { detail: "forbidden" }),
        "PUT /api/org/settings": () =>
          json(409, {
            detail: "conflict",
            extra: { version: 4, updated_at: NOW, updated_by_name: "علي" },
          }),
      }),
    );
    await waitFor(() => expect(hint("ORG-09")).toBe("ready"));
    await fireEvent.press(screen.getByText(tx("ORG-09", "حفظ")));
    await waitFor(() => expect(hint("ORG-09")).toBe("conflict"));
    expect(screen.getByText(tx("ORG-09", "أعد التحميل ثم عدّل"))).toBeTruthy();
    expect(calls.find((c) => c.key === "PUT /api/org/settings")?.body).toMatchObject({
      version: 3,
      name: "محل الأمل",
      paper_width: "58",
      numerals: "latin",
    });
  });
  it("اسم أطول من عرض الورق: validation_error والحفظ معطّل بسببه", async () => {
    await renderWith(
      <OrgSettings />,
      server({
        "GET /api/org/settings": () => json(200, SET),
        "GET /api/org/ownership": () => json(403, {}),
      }),
    );
    await waitFor(() => expect(hint("ORG-09")).toBe("ready"));
    await fireEvent.changeText(screen.getByLabelText(tx("ORG-09", "اسم المنشأة")), "ن".repeat(40));
    await waitFor(() => expect(hint("ORG-09")).toBe("validation_error"));
    expect(screen.getAllByText(tx("ORG-09", "نص أطول من عرض الورق")).length).toBeGreaterThan(0);
  });
  it("مساعدات: tooWideField وarabicDigits", () => {
    expect(tooWideField("58", [["name", "x".repeat(33)]])?.[0]).toBe("name");
    expect(tooWideField("80", [["name", "x".repeat(33)]])).toBeNull();
    expect(arabicDigits("1,180.50")).toBe("١٬١٨٠٫٥٠");
  });
});

describe("ORG-10 — سجل التدقيق", () => {
  const AUD = {
    range: "today",
    since: NOW,
    rows: [
      {
        id: "e1",
        at: "2026-10-20T10:00:00Z",
        actor_name: "سارة",
        actor_role: "كاشير",
        branch_id: "b1",
        branch_name: "الرئيسي",
        kind: "discount",
        title: "خصم 5%",
        detail: "",
        reason: "عميل دائم",
        sensitive: true,
      },
    ],
    count: 1,
    last_event_at: NOW,
    scope: "all",
    can_export: true,
    branches: [{ id: "b1", name: "الرئيسي" }],
  };
  it("ready مع السبب المكتوب وزر التصدير للمالك", async () => {
    await renderWith(<OrgAudit />, server({ "GET /api/org/audit": () => json(200, AUD) }));
    await waitFor(() => expect(hint("ORG-10")).toBe("ready"));
    expect(screen.getByText(tx("ORG-10", "تصدير"))).toBeTruthy();
    expect(screen.getByText(tx("ORG-10", "حسّاس"))).toBeTruthy();
  });
  it("نطاق الكاشير: permission_denied بلا تصدير", async () => {
    await renderWith(
      <OrgAudit />,
      server({
        "GET /api/org/audit": () => json(200, { ...AUD, scope: "own", can_export: false }),
      }),
    );
    await waitFor(() => expect(hint("ORG-10")).toBe("permission_denied"));
    expect(screen.getByText(tx("ORG-10", "ترى أفعالك وحدها."), { exact: false })).toBeTruthy();
    expect(screen.queryByText(tx("ORG-10", "تصدير"))).toBeNull();
  });
  it("مدى بلا أحداث: empty و«وسّع المدى» ينتقل إلى 7 أيام", async () => {
    await renderWith(
      <OrgAudit />,
      server({ "GET /api/org/audit": () => json(200, { ...AUD, rows: [], count: 0 }) }),
    );
    await waitFor(() => expect(hint("ORG-10")).toBe("empty"));
    await fireEvent.press(screen.getByText(tx("ORG-10", "وسّع المدى")));
    await waitFor(() =>
      expect(calls.filter((c) => c.key === "GET /api/org/audit").length).toBeGreaterThan(1),
    );
  });
  it("auditQuery وwiden", () => {
    expect(auditQuery("7d", "b1", true)).toEqual({ range: "7d", branch_id: "b1", sensitive: "1" });
    expect(auditQuery("today", "", false)).toEqual({ range: "today" });
    expect([widen("today"), widen("7d"), widen("30d")]).toEqual(["7d", "30d", "all"]);
  });
});

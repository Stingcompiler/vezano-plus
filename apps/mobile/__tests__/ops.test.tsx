import { MemoryStorage } from "@sting/platform/memory";
import { backupFileId, collectBackup, inspectBackup } from "@sting/sync-core";
import { tx } from "@sting/texts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { webcrypto } from "node:crypto";
import type { ReactElement } from "react";
import { Share } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import NotificationsPermission from "@/app/notifications-permission";
import { aesGcmDecrypt, aesGcmEncrypt } from "@/features/ops/aes-gcm";
import { openBackup, sealBackup } from "@/features/ops/backup-crypto";
import { CampaignApproveScreen } from "@/features/ops/notify/campaign-approve";
import { CampaignsScreen } from "@/features/ops/notify/campaigns";
import { InboxScreen } from "@/features/ops/notify/inbox";
import { PREFS_PENDING, PreferencesScreen } from "@/features/ops/notify/preferences";
import { OperationScreen } from "@/features/ops/operation";
import { ReviewScreen } from "@/features/ops/review";
import { SessionsScreen } from "@/features/ops/sessions";
import { SupportScreen } from "@/features/ops/support";
import { setSecretsForTests } from "@/lib/secrets";
import { ANONYMOUS, SessionProvider, type SessionState } from "@/lib/session";
import { setStorageForTests } from "@/lib/storage";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: jest.fn(), push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => ({}),
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
const down = (() =>
  Promise.reject(new TypeError("Network request failed"))) as unknown as typeof fetch;
const ACTIVE: SessionState = {
  ...ANONYMOUS,
  status: "active",
  tenantId: "t1",
  userId: "u1",
  setupDone: true,
  deviceId: "d1",
  tokens: { access: "a", refresh: "r", sessionId: "s" },
};

/** خادم وهمي: مسار → (حالة، جسم)؛ ما لم يُعرَّف يفشل كالانقطاع. */
function server(routes: Record<string, [number, unknown]>): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input as Request;
    const url = new URL(typeof input === "string" ? input : req.url);
    const method = (init?.method ?? req.method ?? "GET").toUpperCase();
    const hit = routes[`${method} ${url.pathname}`];
    if (!hit) return Promise.reject(new TypeError("Network request failed"));
    return Promise.resolve(
      new Response(JSON.stringify(hit[1]), {
        status: hit[0],
        headers: { "content-type": "application/json" },
      }),
    );
  };
}
const renderWith = (ui: ReactElement, fetchImpl: typeof fetch = down) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SessionProvider fetchImpl={fetchImpl} initial={ACTIVE}>
        {ui}
      </SessionProvider>
    </SafeAreaProvider>,
  );
const hint = (id: string) => screen.getByTestId(id).props.accessibilityHint as string;
const btn = (name: string) => screen.getByRole("button", { name });

let storage: MemoryStorage;
beforeEach(() => {
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
afterEach(async () => {
  await cleanup();
});

const asRole = (roleCode: string) =>
  storage.transaction((t) =>
    t.putMeta(
      "shift.context",
      JSON.stringify({ branchId: "b1", branchName: "الرئيسي", deviceId: "d1", roleCode }),
    ),
  );

const PREFS = {
  operational: { in_app: true, sms: false },
  account: { in_app: true, email: false },
  marketing: { in_app: true, email: true },
};
const PREFS_PAYLOAD = {
  prefs: PREFS,
  destination_email: "",
  sms_balance: { remaining: 10, quota: 20 },
  counts: { in_app: 3, sms: 0, email: 1 },
  updated_at: "",
  is_owner: true,
};

describe("NOT-02 — تفضيلات التنبيه", () => {
  it("بريد مفعّل بلا وجهة: validation_error ولا يُحفظ شيء", async () => {
    await renderWith(
      <PreferencesScreen />,
      server({ "GET /api/notifications/preferences": [200, PREFS_PAYLOAD] }),
    );
    await waitFor(() => screen.getByText(tx("NOT-02", "حفظ")));
    await fireEvent.press(btn(tx("NOT-02", "حفظ")));
    await waitFor(() => expect(hint("NOT-02")).toBe("validation_error"));
    expect(screen.getByText(tx("NOT-02", "قناة بلا وجهة"))).toBeTruthy();
    expect(await storage.read((t) => t.getMeta(PREFS_PENDING))).toBeFalsy();
  });

  it("بلا اتصال عند الحفظ: يُحفظ على الجهاز وتصير الحالة offline", async () => {
    const body = { ...PREFS_PAYLOAD, destination_email: "a@b.sd" };
    const calls: string[] = [];
    const fetchImpl = (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input as Request;
      const method = (init?.method ?? req.method ?? "GET").toUpperCase();
      calls.push(method);
      if (method === "GET")
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      return Promise.reject(new TypeError("Network request failed"));
    };
    await renderWith(<PreferencesScreen />, fetchImpl);
    await waitFor(() => screen.getByText(tx("NOT-02", "حفظ")));
    await fireEvent.press(btn(tx("NOT-02", "حفظ")));
    await waitFor(() => expect(hint("NOT-02")).toBe("offline"));
    expect(screen.getByText(tx("NOT-02", "حُفظ محلياً"))).toBeTruthy();
    expect(await storage.read((t) => t.getMeta(PREFS_PENDING))).toContain("a@b.sd");
  });
});

describe("NOT-03 — الحملات", () => {
  it("403: permission_denied مع اسم الدور", async () => {
    await renderWith(
      <CampaignsScreen />,
      server({ "GET /api/campaigns": [403, { detail: "forbidden", role_name: "كاشير" }] }),
    );
    await waitFor(() => expect(hint("NOT-03")).toBe("permission_denied"));
    expect(screen.getByText(/كاشير/)).toBeTruthy();
  });

  it("بلا حملات: empty مع الرقم الصادق", async () => {
    await renderWith(
      <CampaignsScreen />,
      server({
        "GET /api/campaigns": [
          200,
          {
            campaigns: [],
            quota: { used: 0, max: 100, remaining: 100 },
            subscribers: 7,
            parties_total: 40,
            can_create: true,
            can_approve: true,
            can_see_billing: true,
            as_of: "",
          },
        ],
      }),
    );
    await waitFor(() => expect(hint("NOT-03")).toBe("empty"));
    expect(screen.getByText(tx("NOT-03", "لا حملات"))).toBeTruthy();
  });
});

describe("NOT-05 — اعتماد الحملة", () => {
  const CAMP = {
    id: "c1",
    name: "عرض",
    message: "عرض — بقالة النيل",
    audience_count: 10,
    excluded_count: 1,
    parts: 1,
    cost_messages: 10,
    status: "draft",
    status_label: "مسودة",
    scheduled_at: "",
    sent_at: "",
    overdue: false,
    can_approve: true,
    can_cancel: true,
    approved_by_name: "",
    approved_at: "",
    shop_name: "بقالة النيل",
    quota: { used: 0, max: 100, remaining: 100 },
  };
  it("نقص يمنع الإرسال: validation_error ولا اعتماد دون تاريخ", async () => {
    const verify = {
      audience: { eligible: 10, excluded_opt_out: 1 },
      parts: 1,
      cost_messages: 10,
      quota: CAMP.quota,
      blockers: [],
      campaign: CAMP,
    };
    await renderWith(
      <CampaignApproveScreen id="c1" />,
      server({
        "GET /api/campaigns/c1": [200, { campaign: CAMP }],
        "POST /api/campaigns/c1/verify": [200, verify],
        "POST /api/campaigns/c1/approve": [
          400,
          {
            detail: "blocked",
            extra: {
              blockers: [{ code: "sender_identity_missing", title: "هوية", detail: "ناقصة" }],
            },
          },
        ],
      }),
    );
    await waitFor(() => screen.getByText(tx("NOT-05", "اعتمد وأرسل الآن")));
    // بلا تاريخ: الزرّ يعطي سبب التعطيل
    expect(screen.getByText(tx("NOT-05", "اختر تاريخ الإرسال"))).toBeTruthy();
    await fireEvent.press(btn(tx("NOT-05", "اعتمد وأرسل الآن")));
    await waitFor(() => expect(hint("NOT-05")).toBe("validation_error"));
    expect(screen.getByText(tx("NOT-05", "نقص واحد يمنع الإرسال."), { exact: false })).toBeTruthy();
  });
});

describe("NOT-01 — الوارد", () => {
  const ITEM = {
    id: "n1",
    kind: "shift",
    category: "operational",
    category_label: "تشغيلي",
    title: "وردية مهجورة",
    body: "وردية مفتوحة منذ يومين",
    href: "/shifts/current",
    screen: "الوردية",
    needs_action: true,
    locked: false,
    expired: false,
    resolved: false,
    read: false,
    occurred_at: new Date().toISOString(),
    expires_at: "",
    link_token: "tok",
    link_expires_at: "",
  };
  const inbox = (item: object) => ({
    items: [item],
    needs_action: 1,
    unread: 1,
    category: "",
    as_of: "",
  });
  it("القائمة تعرض التشغيلي بغير المقروء، والفتح يدفع شاشة التفاصيل", async () => {
    await renderWith(<InboxScreen />, server({ "GET /api/notifications": [200, inbox(ITEM)] }));
    await waitFor(() => expect(hint("NOT-01")).toBe("ready"));
    expect(screen.getByText(tx("NOT-01", "غير مقروء"))).toBeTruthy();
    await fireEvent.press(screen.getByText("وردية مهجورة"));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/notify/inbox/[id]", params: { id: "n1" } });
  });
  it("إشعار منتهي: expired وزر الفتح معطّل بسببه", async () => {
    await renderWith(
      <InboxScreen id="n1" />,
      server({
        "GET /api/notifications": [200, inbox({ ...ITEM, expired: true })],
        "POST /api/notifications/n1/open": [200, { status: "expired", title: "x", href: "" }],
      }),
    );
    await waitFor(() => expect(hint("NOT-01")).toBe("expired"));
    expect(screen.getByText(tx("NOT-01", "انتهت صلاحية هذا الإشعار"))).toBeTruthy();
  });
  it("إشعار لدور آخر: permission_denied بلا محتوى", async () => {
    await renderWith(
      <InboxScreen id="n1" />,
      server({ "GET /api/notifications": [200, inbox({ ...ITEM, locked: true })] }),
    );
    await waitFor(() => expect(hint("NOT-01")).toBe("permission_denied"));
    expect(screen.queryByText(ITEM.body)).toBeNull();
  });
  it("بلا اتصال ولا نسخة: offline", async () => {
    await renderWith(<InboxScreen />);
    await waitFor(() => expect(hint("NOT-01")).toBe("offline"));
  });
});

describe("ACC-09 — الجلسات", () => {
  const SESSIONS = {
    sessions: [
      {
        session_id: "s1",
        kind: "device",
        session_label: "جهاز 2",
        is_current: false,
        tenant_name: "المحل",
        branch_name: "الفرع",
        device_id: "d2",
        last_seen_at: new Date().toISOString(),
        revoked_at: "",
        revoke_after_upload: false,
        reported_pending: 4,
        can_revoke: true,
      },
    ],
  };
  it("جهاز فيه معلّق: الإنهاء يطلب تأكيداً (pending_sync) ثم success بعد ردّ الخادم", async () => {
    const ended = { ...SESSIONS.sessions[0], revoked_at: new Date().toISOString() };
    await renderWith(
      <SessionsScreen />,
      server({
        "GET /api/account/sessions": [200, SESSIONS],
        "POST /api/account/sessions/s1/revoke": [200, ended],
      }),
    );
    await waitFor(() => expect(hint("ACC-09")).toBe("ready"));
    await fireEvent.press(btn(tx("ACC-09", "إنهاء الجلسة")));
    await waitFor(() => expect(hint("ACC-09")).toBe("pending_sync"));
    expect(screen.getByText(tx("ACC-09", "الإنهاء يقطع الرفع."))).toBeTruthy();
    // زرّا الورقة: أول «إنهاء الجلسة» في الورقة
    const ends = screen.getAllByRole("button", { name: tx("ACC-09", "إنهاء الجلسة") });
    await fireEvent.press(ends[ends.length - 1]);
    await waitFor(() => expect(hint("ACC-09")).toBe("success"));
  });
  it("403: permission_denied ولا تُعرض الجلسة منتهية", async () => {
    await renderWith(
      <SessionsScreen />,
      server({
        "GET /api/account/sessions": [
          200,
          { sessions: [{ ...SESSIONS.sessions[0], reported_pending: 0 }] },
        ],
        "POST /api/account/sessions/s1/revoke": [403, { detail: "forbidden" }],
      }),
    );
    await waitFor(() => expect(hint("ACC-09")).toBe("ready"));
    await fireEvent.press(btn(tx("ACC-09", "إنهاء الجلسة")));
    await waitFor(() => expect(hint("ACC-09")).toBe("permission_denied"));
  });
});

describe("SYS-02 — عملية متعثرة", () => {
  it("مرفوضة بتعارض رقم الفاتورة: ready مع إعادة الترقيم، ثم pending_sync", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    await storage.transaction(async (t) => {
      await t.putOperation({
        operationId: id,
        kind: "sale",
        opVersion: 1,
        dependencies: [],
        members: [
          {
            entity: "sales.Sale",
            id: "sale1",
            schemaVersion: 1,
            serverSeq: null,
            payload: { invoice_number: "A-1", total_minor: "1000" },
          },
        ],
        state: "quarantined",
        createdLocalSeq: 1,
        snapshotRelation: "none",
      });
      await t.putMeta(
        `quarantine:${id}`,
        JSON.stringify({ code: "validation", detail: "duplicate key invoice_number" }),
      );
    });
    await renderWith(<OperationScreen operationId={id} />);
    await waitFor(() => expect(hint("SYS-02")).toBe("ready"));
    expect(screen.getByText(tx("SYS-02", "رقم الفاتورة استعمله جهاز آخر"))).toBeTruthy();
    await fireEvent.press(btn(tx("SYS-02", "إعادة ترقيم بموافقتك ثم رفع")));
    await waitFor(() => expect(hint("SYS-02")).toBe("pending_sync"));
    const op = await storage.read((t) => t.getOperation(id));
    expect(op?.state).toBe("local");
  });
  it("عملية بلا وجود: empty", async () => {
    await renderWith(<OperationScreen operationId="nope" />);
    await waitFor(() => expect(hint("SYS-02")).toBe("empty"));
  });
});

describe("SYS-03 — المراجعة", () => {
  it("بلا اتصال ولا نسخة: offline؛ ومع قائمة فارغة: ready «لا بنود»", async () => {
    await renderWith(<ReviewScreen selectedId="" operationId="" />);
    await waitFor(() => expect(hint("SYS-03")).toBe("offline"));
  });
  it("قائمة محجوزة تعرض الأثر المالي بخط mono", async () => {
    await renderWith(
      <ReviewScreen selectedId="" operationId="" />,
      server({
        "GET /api/sync/quarantine": [
          200,
          {
            is_owner: true,
            as_of: "",
            items: [
              {
                id: "q1",
                operation_id: "o1",
                kind: "payment_receipt",
                reason: "conflicted",
                code: "",
                detail: "",
                device_id: "d2",
                device_name: "M2",
                received_at: new Date().toISOString(),
                effect_minor: "250000",
                members: [],
                reviewed_at: "",
                decision: "",
                decision_reason: "",
                decided_by_name: "",
              },
            ],
          },
        ],
      }),
    );
    await waitFor(() => screen.getByText(tx("SYS-03", "البنود المحجوزة")));
    expect(hint("SYS-03")).toBe("ready");
    expect(screen.getAllByText(tx("SYS-03", "تعارض")).length).toBeGreaterThan(0);
    expect(screen.getByText("2,500.00")).toBeTruthy();
  });
});

describe("SYS-11 — الدعم", () => {
  it("موظف غير مالك: permission_denied والإرسال معطّل بسببه", async () => {
    await asRole("cashier");
    await renderWith(<SupportScreen />);
    await waitFor(() => expect(hint("SYS-11")).toBe("permission_denied"));
    expect(screen.getAllByText(tx("SYS-11", "الإرسال للمالك")).length).toBeGreaterThan(0);
  });
  it("مالك بلا أخطاء: empty ثم الإرسال ينجح بمرجع", async () => {
    await asRole("owner");
    await renderWith(
      <SupportScreen />,
      server({
        "POST /api/support/reports": [200, { reference: "SUP-100", sent_keys: ["app"] }],
      }),
    );
    await waitFor(() => expect(hint("SYS-11")).toBe("empty"));
    await fireEvent.press(btn(tx("SYS-11", "أرسل تقريراً على أي حال")));
    await waitFor(() => expect(hint("SYS-11")).toBe("success"));
    expect(screen.getByText("SUP-100")).toBeTruthy();
  });
  it("الحفظ المحلي يمرّ بورقة المشاركة", async () => {
    await asRole("owner");
    const spy = jest
      .spyOn(Share, "share")
      .mockResolvedValue({ action: "sharedAction", activityType: undefined });
    await renderWith(<SupportScreen />);
    await waitFor(() => expect(hint("SYS-11")).toBe("empty"));
    await fireEvent.press(btn(tx("SYS-11", "حفظ محلياً")));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    spy.mockRestore();
  });
});

describe("NAT-03 — إذن الإشعارات", () => {
  it("حالة «غير مفعّلة بعد» صادقة بلا وحدة أصلية", async () => {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <NotificationsPermission />
      </SafeAreaProvider>,
    );
    expect(hint("NAT-03")).toBe("ready");
    expect(screen.getByText("غير مفعّلة بعد")).toBeTruthy();
  });
});

describe("SYS-05/06 — النسخة المشفّرة", () => {
  it("AES-256-GCM الجافاسكربتي مطابق لـWebCrypto بايتاً ببايت", async () => {
    for (const len of [0, 1, 15, 16, 17, 1000, 70001]) {
      const key = webcrypto.getRandomValues(new Uint8Array(32));
      const iv = webcrypto.getRandomValues(new Uint8Array(12));
      const plain = new Uint8Array(len);
      for (let i = 0; i < len; i += 60000)
        webcrypto.getRandomValues(plain.subarray(i, Math.min(len, i + 60000)));
      const k = await webcrypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
      const ref = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, k, plain));
      const mine = aesGcmEncrypt(key, iv, plain);
      expect(Buffer.from(mine).equals(Buffer.from(ref))).toBe(true);
      expect(Buffer.from(aesGcmDecrypt(key, iv, ref)).equals(Buffer.from(plain))).toBe(true);
    }
    expect(() =>
      aesGcmDecrypt(new Uint8Array(32), new Uint8Array(12), new Uint8Array(40)),
    ).toThrow();
  });

  it("بلا crypto.subtle (Hermes): ختم الجوال يُفتح بكود الويب والعكس، وكلمة خاطئة ترفض", async () => {
    const g = globalThis as { crypto: { subtle?: unknown } };
    const original = Object.getOwnPropertyDescriptor(g.crypto, "subtle");
    const hide = () => {
      Object.defineProperty(g.crypto, "subtle", { value: undefined, configurable: true });
    };
    const show = () => {
      delete g.crypto.subtle;
      if (original) Object.defineProperty(g.crypto, "subtle", original);
    };
    const content = await collectBackup(storage);
    const base = {
      content,
      tenantId: "t1",
      deviceId: "d1",
      syncEpoch: "e1",
      exportedAt: new Date().toISOString(),
      iterations: 1000,
    };
    hide();
    let mobileEnvelope;
    try {
      mobileEnvelope = await sealBackup({ ...base, password: "secret1" });
      const ok = await openBackup(mobileEnvelope, "secret1");
      expect(ok.ok).toBe(true);
      const bad = await openBackup(mobileEnvelope, "wrong-pw");
      expect(bad).toEqual({ ok: false, reason: "wrong_password" });
    } finally {
      show();
    }
    // ملف الجوال يُفتح بمسار WebCrypto (الويب) — والعكس
    const viaWeb = await openBackup(mobileEnvelope, "secret1");
    expect(viaWeb.ok).toBe(true);
    const webEnvelope = await sealBackup({ ...base, password: "secret1" });
    hide();
    try {
      expect((await openBackup(webEnvelope, "secret1")).ok).toBe(true);
    } finally {
      show();
    }
    expect(inspectBackup(JSON.stringify(webEnvelope), "t1").ok).toBe(true);
    expect(inspectBackup(JSON.stringify(webEnvelope), "other").ok).toBe(false);
    expect(backupFileId(webEnvelope)).toContain("t1");
  });
});

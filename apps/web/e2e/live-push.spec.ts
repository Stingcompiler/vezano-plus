import { expect, type Page, test } from "@playwright/test";

import { json, login } from "./pos-invoices-fixtures";
import { goSection } from "./platform-nav";

/**
 * 0005 §٢١٦ — الإشعارات الفورية: NOT-02 يحفظ «فوري» لكل فئة وساعات الهدوء، وPLT-15 يشترك متصفح
 * المشغّل بزرّ واحد (إذن المتصفح مزيَّف — لا مزوّد حقيقي في الاختبار).
 */

interface Fake {
  permission?: "default" | "granted" | "denied" | "unsupported";
  request?: "granted" | "denied";
  subscription?: { endpoint: string; p256dh: string; auth: string } | null;
}

async function fakePush(page: Page, fake: Fake) {
  await page.addInitScript((fake) => {
    const w = window as unknown as { __stingPushFake?: (f: Fake) => void };
    let installed = false;
    Object.defineProperty(w, "__stingPushFake", {
      configurable: true,
      get: () => undefined,
      set: (fn: (f: Fake) => void) => {
        Object.defineProperty(w, "__stingPushFake", {
          value: fn,
          configurable: true,
          writable: true,
        });
        if (!installed) {
          installed = true;
          fn(fake);
        }
      },
    });
  }, fake);
}

const PREFS = {
  prefs: {
    operational: { in_app: true, sms: false, push: true },
    account: { in_app: true, email: false, push: true },
    marketing: { in_app: false, email: false, push: false },
  },
  quiet_hours: false,
  destination_email: "",
  phone: "",
  sms_balance: { remaining: 100, quota: 100 },
  counts: { in_app: 2, sms: 0, email: 0, push: 2 },
  updated_at: "2026-11-07T10:00:00Z",
  is_owner: true,
};

test("NOT-02: «فوري» لكل فئة وساعات الهدوء تُحفظ مع التفضيلات", async ({ page }) => {
  let saved: Record<string, unknown> | null = null;
  await page.route("**/api/notifications/preferences", (route) => {
    if (route.request().method() === "PUT") {
      saved = route.request().postDataJSON() as Record<string, unknown>;
      const body = saved as { prefs: unknown; quiet_hours: boolean };
      return route.fulfill(
        json(200, { ...PREFS, prefs: body.prefs, quiet_hours: body.quiet_hours }),
      );
    }
    return route.fulfill(json(200, PREFS));
  });
  await login(page, "/notify/preferences");
  const root = page.locator('[data-screen="NOT-02"]');
  await expect(root.getByText("الإشعارات الفورية", { exact: true })).toBeVisible();
  await expect(root.getByRole("link", { name: "فعّلها على هذا الجهاز" })).toHaveAttribute(
    "href",
    "/notify",
  );
  await root.getByRole("switch", { name: "فوري — الاشتراك والفواتير" }).click();
  await root.getByRole("switch", { name: "ساعات الهدوء" }).click();
  await root.getByRole("button", { name: "حفظ" }).click();
  await expect.poll(() => saved).not.toBeNull();
  const body = saved as unknown as {
    prefs: { account: { push: boolean }; operational: { push: boolean } };
    quiet_hours: boolean;
  };
  expect(body.prefs.account.push).toBe(false);
  expect(body.prefs.operational.push).toBe(true);
  expect(body.quiet_hours).toBe(true);
});

test("PLT-15: «فعّل التنبيهات هنا» يشترك متصفح المشغّل ثم يُوقَف", async ({ page }) => {
  await fakePush(page, {
    permission: "default",
    request: "granted",
    subscription: { endpoint: "https://push.example/op", p256dh: "k", auth: "a" },
  });
  let subscribed = false;
  let subscribeBody: Record<string, unknown> | null = null;
  await page.route("**/api/platform/login", (route) =>
    route.fulfill(
      json(200, { access: "op", refresh: "r", session_id: "s", display_name: "هدى — تشغيل" }),
    ),
  );
  await page.route(/\/api\/platform\/notices(\?.*)?$/, (route) =>
    route.fulfill(json(200, { unread: 0, new_messages: 0, notices: [] })),
  );
  await page.route("**/api/platform/push", (route) =>
    route.fulfill(json(200, { configured: true, public_key: "BPk", subscribed })),
  );
  await page.route("**/api/platform/push/subscribe", (route) => {
    subscribeBody = route.request().postDataJSON() as Record<string, unknown>;
    subscribed = true;
    return route.fulfill(json(200, { configured: true, public_key: "BPk", subscribed: true }));
  });
  await page.route("**/api/platform/push/unsubscribe", (route) => {
    subscribed = false;
    return route.fulfill(json(200, { configured: true, public_key: "BPk", subscribed: false }));
  });
  await page.goto("/platform/login");
  await page.getByLabel("بريد المشغّل").fill("ops.huda@sting.internal");
  await page.getByLabel("كلمة المرور").fill("very-secret-ops");
  await page.getByRole("button", { name: "دخول مساحة المشغّل" }).click();
  await expect(page).toHaveURL(/\/platform$/);
  await goSection(page, "الإشعارات");
  const root = page.locator('[data-screen="PLT-15"]');
  await expect(root.getByText("تنبيهات هذا المتصفح")).toBeVisible();
  await root.getByRole("button", { name: "فعّل التنبيهات هنا" }).click();
  await expect(root.getByRole("button", { name: "أوقف التنبيهات هنا" })).toBeVisible();
  expect(subscribeBody).toMatchObject({ endpoint: "https://push.example/op" });
  await root.getByRole("button", { name: "أوقف التنبيهات هنا" }).click();
  await expect(root.getByRole("button", { name: "فعّل التنبيهات هنا" })).toBeVisible();
});

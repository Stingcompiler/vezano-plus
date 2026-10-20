import { expect, type Page, type Route, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { navTo } from "./nav";

/**
 * رمز PIN يضبطه المستخدم بنفسه (0005 §١٧٤) — `POST /api/account/pin {pin, password}`: 204، أو 403
 * `password_invalid`، أو 400 `pin_invalid`. بلا إطار مرسوم → بلا `fromFrame`؛ النصوص من القرار.
 * المتصفح المجهَّز بجلسة جهاز يعيد تنزيل المتحققات فيُفتح القفل بالرمز الجديد فوراً.
 */
const json = (status: number, body: unknown) => ({ status, json: body });
// PIN 123456 (المتجه نفسه في lock-logic.spec.ts وacc-invite-lock.spec.ts)
const ENCODED =
  "pbkdf2_sha256$1000$AAAAAAAAAAAAAAAAAAAAAA==$xLL5EYZbGlWr9962Y1Y77xBK9jK/wka5FYHqDqwRYw8=";

const READY_TEXTS = [
  "رمز PIN للقفل",
  "أرقام بدل كلمة المرور، ويعمل بلا اتصال.",
  "الرمز الجديد",
  "أعد كتابة الرمز",
  "كلمة المرور الحالية",
  "احفظ الرمز",
];

async function login(page: Page, next = "") {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.getByLabel("رقم الهاتف أو البريد").fill("cashier@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(next ? new RegExp(`${next.replace(/\//g, "\\/")}$`) : /\/$/);
}

/** يحاكي نقطة الضبط ويجمع ما أُرسل إليها. */
function pinRoute(page: Page, reply: (body: { pin: string; password: string }) => object) {
  const sent: { pin: string; password: string }[] = [];
  return {
    sent,
    install: () =>
      page.route("**/api/account/pin", (route: Route) => {
        const body = JSON.parse(route.request().postData() ?? "{}") as {
          pin: string;
          password: string;
        };
        sent.push(body);
        return route.fulfill(reply(body));
      }),
  };
}

const form = (page: Page) => page.locator('[data-screen="ACC-PIN"]');
async function fill(page: Page, pin: string, confirm: string, password: string) {
  await form(page).getByLabel("الرمز الجديد").fill(pin);
  await form(page).getByLabel("أعد كتابة الرمز").fill(confirm);
  await form(page).getByLabel("كلمة المرور الحالية").fill(password);
}

test.describe("رمز PIN — يضبطه المستخدم", () => {
  // ما لم يُحاكَ صراحةً لا يصل إلى خادم حقيقي (المسارات تُطابَق من الأحدث تسجيلاً)
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/**", (route) => route.fulfill(json(404, { detail: "not_mocked" })));
  });

  test("ready ← validation_error: رمز غير صالح ورمزان مختلفان لا يُرسلان، والخادم يرفض الطول", async ({
    page,
  }, info) => {
    await login(page);
    const api = pinRoute(page, () => json(400, { detail: "pin_invalid", extra: { length: 6 } }));
    await api.install();
    await navTo(page, "رمز PIN");
    await expect(page).toHaveURL(/\/account\/pin$/);
    await expectFrame(page, info, { screenId: "ACC-PIN", state: "ready", texts: READY_TEXTS });
    await expect(form(page).locator(".sting-mono").first()).toHaveText("6");

    // حروف في الرمز: خطأ تحت الحقل، ولا طلب
    await fill(page, "12ab", "12ab", "sting-demo-2026");
    await page.getByRole("button", { name: "احفظ الرمز" }).click();
    await expectFrame(page, info, {
      screenId: "ACC-PIN",
      state: "validation_error",
      texts: ["اكتب ستة أرقام بالضبط — أرقام فقط، بلا حروف ولا مسافات."],
    });
    await expect(form(page).getByLabel("الرمز الجديد")).toHaveAttribute("aria-invalid", "true");

    // رمزان مختلفان
    await fill(page, "246810", "246811", "sting-demo-2026");
    await page.getByRole("button", { name: "احفظ الرمز" }).click();
    await expect(form(page)).toContainText("الرمزان مختلفان — أعد كتابة الرمز نفسه.");
    await expect(form(page).getByLabel("أعد كتابة الرمز")).toHaveAttribute("aria-invalid", "true");
    expect(api.sent).toHaveLength(0);

    // الخادم يرفض الرمز (400 pin_invalid): الخطأ نفسه تحت حقل الرمز
    await fill(page, "246810", "246810", "sting-demo-2026");
    await page.getByRole("button", { name: "احفظ الرمز" }).click();
    await expect(form(page)).toHaveAttribute("data-state", "validation_error");
    await expect(form(page)).toContainText("اكتب ستة أرقام بالضبط");
    expect(api.sent).toEqual([{ pin: "246810", password: "sting-demo-2026" }]);
  });

  test("validation_error: كلمة مرور خاطئة (403) — تُمسح ويُقال السبب، والرمز لا يتغيّر", async ({
    page,
  }, info) => {
    await login(page);
    const api = pinRoute(page, () => json(403, { detail: "password_invalid" }));
    await api.install();
    await navTo(page, "رمز PIN");
    await fill(page, "246810", "246810", "wrong-password");
    await page.getByRole("button", { name: "احفظ الرمز" }).click();
    await expectFrame(page, info, {
      screenId: "ACC-PIN",
      state: "validation_error",
      texts: ["كلمة المرور غير صحيحة — اكتب كلمة مرور دخولك إلى فيزانو بلص."],
    });
    await expect(form(page).getByLabel("كلمة المرور الحالية")).toHaveValue("");
    await expect(form(page).getByLabel("كلمة المرور الحالية")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(api.sent).toEqual([{ pin: "246810", password: "wrong-password" }]);
  });

  test("success بلا جهاز مجهَّز: الأرقام العربية تُرسل لاتينية، ويُقال إن الرمز يصل عند الاتصال", async ({
    page,
  }, info) => {
    await login(page);
    const api = pinRoute(page, () => ({ status: 204 }));
    await api.install();
    await navTo(page, "رمز PIN");
    await fill(page, "٢٤٦٨١٠", "٢٤٦٨١٠", "sting-demo-2026");
    await page.getByRole("button", { name: "احفظ الرمز" }).click();
    await expectFrame(page, info, {
      screenId: "ACC-PIN",
      state: "success",
      texts: [
        "حُفظ رمزك",
        "يصل إلى أجهزة فرعك المجهَّزة عند اتصالها التالي.",
        "هذا المتصفح لم يُجهَّز جهازاً، فلا قفل عليه قبل تجهيزه.",
      ],
    });
    expect(api.sent).toEqual([{ pin: "246810", password: "sting-demo-2026" }]);
    await expect(form(page).getByLabel("الرمز الجديد")).toHaveValue("");
    await expect(form(page).getByLabel("كلمة المرور الحالية")).toHaveValue("");
  });

  test("server_error ثم offline: لا يتغيّر الرمز، وبلا اتصال يُعطَّل الحفظ بسببه", async ({
    page,
    context,
  }, info) => {
    await login(page);
    await pinRoute(page, () => json(500, { detail: "boom" })).install();
    await navTo(page, "رمز PIN");
    await fill(page, "246810", "246810", "sting-demo-2026");
    await page.getByRole("button", { name: "احفظ الرمز" }).click();
    await expectFrame(page, info, {
      screenId: "ACC-PIN",
      state: "server_error",
      texts: ["تعذّر حفظ الرمز", "لم يتغيّر رمزك. أعد المحاولة بعد قليل."],
    });
    await context.setOffline(true);
    await expectFrame(page, info, {
      screenId: "ACC-PIN",
      state: "offline",
      texts: ["ضبط الرمز يحتاج اتصالاً", "يحتاج اتصالاً"],
    });
    await expect(page.getByRole("button", { name: "احفظ الرمز" })).toBeDisabled();
    await context.setOffline(false);
  });

  test("success على جهاز مجهَّز: المتحققات تُنزَّل فوراً والقفل يُفتح بالرمز الجديد", async ({
    page,
  }, info) => {
    // Chromium بلا واجهة لا يمنح التخزين الدائم أبداً — والتجهيز يعطّل البيع بدونه (كما في e2e-gate/fixtures.ts)
    await page.addInitScript(() => {
      navigator.storage.persist = () => Promise.resolve(true);
      navigator.storage.persisted = () => Promise.resolve(true);
    });
    // تجهيز الجهاز بصورة فارغة — يمنح جلسة جهاز في الذاكرة
    await page.route("**/api/devices/register", (route) =>
      route.fulfill(
        json(201, {
          device_id: "33333333-3333-7333-8333-333333333333",
          prefix: "A2",
          branch_id: "44444444-4444-7444-8444-444444444444",
          registration_secret: "secret",
          access: "da",
          refresh: "dr",
        }),
      ),
    );
    await page.route("**/api/bootstrap/start", (route) =>
      route.fulfill(
        json(201, {
          image_id: "11111111-1111-7111-8111-111111111111",
          sync_epoch: "E1",
          snapshot_id: "22222222-2222-7222-8222-222222222222",
          cutoff_server_seq: "7",
          schema_version: 1,
          as_of: "2026-09-16T08:00:00Z",
          expires_at: "2099-09-17T08:00:00Z",
          page_size: 2,
          scopes: [{ group: "settings", total: 0, pages: 1 }],
          balances: [],
        }),
      ),
    );
    await page.route("**/api/bootstrap/*/page**", (route) =>
      route.fulfill(
        json(200, {
          image_id: "11111111-1111-7111-8111-111111111111",
          group: "settings",
          page_no: 1,
          pages: 1,
          entities: [],
        }),
      ),
    );
    await page.route("**/api/bootstrap/*/complete", (route) =>
      route.fulfill(
        json(200, {
          image_id: "11111111-1111-7111-8111-111111111111",
          completed_at: "2026-09-16T08:05:00Z",
        }),
      ),
    );
    let set = false;
    await pinRoute(page, () => {
      set = true;
      return { status: 204 };
    }).install();
    // قبل الضبط لا متحقق لهذا المستخدم؛ بعده يظهر — القائمة كاملة كل مرة
    await page.route("**/api/devices/verifiers", (route) =>
      route.fulfill(
        json(200, {
          device_id: "33333333-3333-7333-8333-333333333333",
          prefix: "A2",
          branch_name: "فرع بحري",
          pin_length: 6,
          verifiers: set
            ? [
                {
                  user_id: "u1",
                  display_name: "سميّة عبد الله",
                  role_name: "كاشير",
                  branch_name: "فرع بحري",
                  encoded: ENCODED,
                  version: 1,
                },
              ]
            : [],
        }),
      ),
    );

    // الانتقال داخل التطبيق يحفظ الجلسة في الذاكرة: التجهيز ← فتح الوردية ← رمز PIN
    await login(page, "/setup-device");
    await page.getByRole("button", { name: "افتح وردية وابدأ البيع" }).click();
    await expect(page).toHaveURL(/\/shifts\/open$/);
    await navTo(page, "رمز PIN");
    await fill(page, "123456", "123456", "sting-demo-2026");
    await page.getByRole("button", { name: "احفظ الرمز" }).click();
    await expectFrame(page, info, {
      screenId: "ACC-PIN",
      state: "success",
      texts: ["حُفظ رمزك", "نُزّل إلى هذا الجهاز — القفل يُفتح به الآن، ولو بلا اتصال."],
    });
    // المتحقق الجديد في المخزن المحلي — القفل يعمل بلا شبكة
    const stored = await page.evaluate(async () => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      return new Promise<unknown>((res) => {
        const r = db.transaction("meta").objectStore("meta").get("pin.verifiers");
        r.onsuccess = () => res(r.result);
      });
    });
    expect(JSON.stringify(stored)).toContain("u1");

    // «جرّب القفل»: الرمز الجديد يفتح ويعود إلى الشاشة نفسها
    await page.getByRole("button", { name: "جرّب القفل" }).click();
    await expect(page).toHaveURL(/\/lock\?next=%2Faccount%2Fpin$/);
    await expect(page.locator('[data-screen="ACC-07"]')).toContainText("سميّة عبد الله");
    for (const d of "123456")
      await page.locator(".acc-keypad").getByRole("button", { name: d, exact: true }).click();
    await expect(page).toHaveURL(/\/account\/pin$/);
  });

  test("القفل بلا رمز محفوظ يدلّ على الضبط — وبلا جلسة يمرّ بالدخول أولاً", async ({ page }) => {
    await page.goto("/lock");
    await expect(page.locator('[data-screen="ACC-07"]')).toContainText(
      "لا رمز PIN محفوظ على هذا الجهاز",
    );
    await page.getByRole("button", { name: "اضبط رمز PIN" }).click();
    await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Fpin$/);
  });
});

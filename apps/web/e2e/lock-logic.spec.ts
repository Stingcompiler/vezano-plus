import { expect, type Page, test } from "@playwright/test";

/**
 * مراجعة منطق القفل (0005 §١٢٠): جهاز بلا متحققات يقول ذلك ويعرض الدخول بكلمة المرور؛ قفل الخمول
 * بعد 20 دقيقة يعود إلى الشاشة نفسها؛ رمز مستخدم آخر لا يفتح جلسة غيره؛ صاحب جلسة بلا رمز على
 * جهاز فيه رموز غيره يُقال له ذلك بدل عرض غيره (§١٧٩).
 * بلا إطار مرسوم لهذه المسارات → بلا `fromFrame`.
 */
const json = (status: number, body: unknown) => ({ status, json: body });
// PIN 123456 (المتجه نفسه في acc-invite-lock.spec.ts)
const ENCODED =
  "pbkdf2_sha256$1000$AAAAAAAAAAAAAAAAAAAAAA==$xLL5EYZbGlWr9962Y1Y77xBK9jK/wka5FYHqDqwRYw8=";
// PIN 654321 — رمز ثانٍ لصاحب الجلسة حين يُختبر رمز مستخدم آخر
const ENCODED_654321 =
  "pbkdf2_sha256$1000$AAAAAAAAAAAAAAAAAAAAAA==$nOp225KblbKetuYeCcvpE8NNoromzHRKcQcnwVr3zbA=";
const row = (user_id: string, display_name: string, encoded = ENCODED) => ({
  user_id,
  display_name,
  role_name: "مدير فرع",
  branch_name: "فرع بحري",
  encoded,
  version: 1,
});

async function seedDevice(page: Page, rows: unknown[]) {
  await page.evaluate(
    async ({ rows }) => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      await new Promise<void>((res, rej) => {
        const tx = db.transaction("meta", "readwrite");
        const store = tx.objectStore("meta");
        store.put({ key: "device.setup", value: "done" });
        store.put({
          key: "pin.verifiers",
          value: JSON.stringify({
            device_id: "d1",
            prefix: "DV-A19",
            branch_name: "فرع بحري",
            pin_length: 6,
            fetched_at: new Date().toISOString(),
            verifiers: rows,
          }),
        });
        tx.oncomplete = () => res();
        tx.onerror = () => rej(new Error(String(tx.error)));
      });
      db.close();
    },
    { rows },
  );
}

async function typePin(page: Page, digits: string) {
  for (const d of digits)
    await page.locator(".acc-keypad").getByRole("button", { name: d, exact: true }).click();
}

/** دخول بجلسة حيّة (user u1، منشأة t1) إلى شاشة داخلية. */
async function liveSession(page: Page, next: string) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.route("**/api/org/subscription", (route) =>
    route.fulfill(json(403, { detail: "owner_required" })),
  );
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/\//g, "\\/")}$`));
}

test.describe("القفل — مراجعة المنطق", () => {
  test("جهاز بلا رمز محفوظ: يُقال ذلك، والدخول بكلمة المرور متاح", async ({ page }) => {
    await page.goto("/lock");
    await expect(page.locator('[data-screen="ACC-07"]')).toContainText(
      "لا رمز PIN محفوظ على هذا الجهاز",
    );
    await page.getByRole("button", { name: "نسيت الرمز؟ ادخل بكلمة المرور" }).click();
    await expect(page).toHaveURL(/\/login\?next=%2F$/);
  });

  test("جهاز مُجهَّز بعد إعادة التحميل: الترحيب ← القفل ← الرمز ← الدخول برسالة — لا حلقة", async ({
    page,
  }) => {
    await page.goto("/lock");
    await seedDevice(page, [row("u1", "سميّة عبد الله")]);
    // 0005 §٣: الجهاز المهيّأ يذهب إلى القفل؛ بلا جلسة (أُعيد التحميل) لا يعود الرمز إلى الصفحة العامة
    await page.goto("/welcome");
    await expect(page).toHaveURL(/\/lock$/);
    await typePin(page, "123456");
    await expect(page).toHaveURL(/\/login\?unlocked=1&next=%2F$/);
    await expect(page.locator('[data-screen="ACC-02"]')).toContainText(
      "رمزك صحيح — ادخل بكلمة المرور مرة واحدة",
    );
  });

  test("خمول 20 دقيقة → القفل؛ رمز صاحب الجلسة يعيد إلى الشاشة نفسها", async ({ page }) => {
    await page.clock.install();
    await liveSession(page, "/org/subscription");
    await seedDevice(page, [row("u1", "سميّة عبد الله")]);
    await page.clock.fastForward("19:00");
    await expect(page).toHaveURL(/\/org\/subscription$/);
    await page.clock.fastForward("02:00");
    await expect(page).toHaveURL(/\/lock\?next=%2Forg%2Fsubscription$/);
    await expect(page.locator('[data-screen="ACC-07"]')).toContainText("سميّة عبد الله");
    await typePin(page, "123456");
    await expect(page).toHaveURL(/\/org\/subscription$/);
  });

  test("رمز مستخدم آخر لا يفتح جلسة غيره", async ({ page }) => {
    await page.clock.install();
    await liveSession(page, "/org/subscription");
    // لصاحب الجلسة رمزه على الجهاز (القفل لمن له رمز وحده — مراجعة 2026-10-19 B1)
    await seedDevice(page, [row("u1", "سميّة عبد الله", ENCODED_654321), row("u2", "أحمد ياسين")]);
    await page.clock.fastForward("21:00");
    await expect(page).toHaveURL(/\/lock\?next=/);
    await expect(page.locator('[data-screen="ACC-07"]')).toContainText("سميّة عبد الله");
    await typePin(page, "123456");
    await expect(page.locator('[data-screen="ACC-07"]')).toContainText(
      "هذا رمز أحمد ياسين — الجلسة المفتوحة لغيره",
    );
    await expect(page).toHaveURL(/\/lock\?next=/);
  });

  test("مراجعة 2026-10-19 B1: صاحب جلسة بلا رمز على الجهاز لا يُقفل عند الخمول — قفل لا يفتحه", async ({
    page,
  }) => {
    await page.clock.install();
    await liveSession(page, "/org/subscription");
    await seedDevice(page, [row("u2", "أحمد ياسين")]);
    await page.clock.fastForward("21:00");
    await expect(page).toHaveURL(/\/org\/subscription$/);
  });

  test("صاحب الجلسة يصل إلى القفل بلا رمز له والجهاز فيه رموز غيره: لا يُعرض غيره، والضبط يمرّ بالدخول (§١٧٩)", async ({
    page,
  }) => {
    await liveSession(page, "/org/subscription");
    await seedDevice(page, [row("u2", "أحمد ياسين")]);
    // قفل الخمول لا يقود إلى هنا بعد B1؛ الوصول بتنقّل داخلي تبقى معه الجلسة في الذاكرة
    await page.evaluate(() =>
      (window as unknown as { next: { router: { push(href: string): void } } }).next.router.push(
        "/lock?next=%2Forg%2Fsubscription",
      ),
    );
    await expect(page).toHaveURL(/\/lock\?next=%2Forg%2Fsubscription$/);
    const screen = page.locator('[data-screen="ACC-07"]');
    await expect(screen).toContainText("لا رمز PIN لك على هذا الجهاز");
    await expect(screen).not.toContainText("أحمد ياسين");
    await expect(page.locator(".acc-keypad")).toHaveCount(0);
    await page.getByRole("button", { name: "اضبط رمز PIN" }).click();
    await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Fpin$/);
    await page.goBack();
    await page.getByRole("button", { name: "ادخل بكلمة المرور", exact: true }).click();
    await expect(page).toHaveURL(/\/login\?next=%2Forg%2Fsubscription$/);
  });
});

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { openSeedPage } from "./seed-page";

/**
 * 0005 §٢٦٤ — «ملاحظاتك» في SYS-11: أي دور يرسل اقتراحاً أو مشكلة أو رأياً؛ «ملاحظاتي» تعرض الحالة
 * وردّ الفريق؛ بلا اتصال تُحفظ على الجهاز وتُرسل عند عودته (إعادة الإرسال بالمعرّف نفسه).
 * نصوص جديدة غير مرسومة — تُفحص بـtoContainText لا fromFrame (§١٦٩).
 */
const json = (status: number, body: unknown) => ({ status, json: body });

async function seed(page: Page, role: "owner" | "cashier") {
  await openSeedPage(page);
  await page.evaluate(async (role) => {
    const req = indexedDB.open("sting-bootstrap");
    const db = await new Promise<IDBDatabase>((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(new Error(String(req.error)));
    });
    await new Promise<void>((res) => {
      const tx = db.transaction(["meta"], "readwrite");
      const m = tx.objectStore("meta");
      m.put({
        key: "device.registration",
        value: JSON.stringify({
          deviceId: "d1",
          prefix: "POS1",
          branchId: "b1",
          branchCode: "KRT",
        }),
      });
      m.put({ key: "sync_epoch", value: "epoch-A" });
      m.put({
        key: "shift.context",
        value: JSON.stringify({
          branchId: "b1",
          branchName: "الرئيسي",
          branchCode: "KRT",
          deviceId: "d1",
          deviceName: "حاسوب الكاشير 1",
          devicePrefix: "POS1",
          userId: "u1",
          userName: role === "owner" ? "سالم" : "سميرة ع.",
          roleName: role === "owner" ? "مالك" : "كاشير",
          roleCode: role,
        }),
      });
      tx.oncomplete = () => res();
    });
    db.close();
  }, role);
}

async function login(page: Page) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.goto(`/login?next=${encodeURIComponent("/support")}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/support$/);
}

const row = (over: Record<string, unknown> = {}) => ({
  id: "f1",
  client_id: "c1",
  reference: "FB-261112-0001",
  kind: "suggestion",
  kind_label: "اقتراح",
  text: "تقرير المبيعات حسب الساعة",
  contact_ok: true,
  status: "studying",
  status_label: "قيد الدراسة",
  reply: "سنضيفه في الإصدار القادم",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  unseen: true,
  ...over,
});

async function checkLayout(page: Page) {
  const section = page.locator("#feedback");
  const small = await section
    .locator("button:visible, input:not([type=file]):visible, textarea:visible")
    .evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect().height).filter((h) => h > 0 && h < 44),
    );
  expect(small, "أهداف لمس أقل من 44px").toEqual([]);
  const monoArabic = await section
    .locator(".sting-mono")
    .evaluateAll((els) => els.map((e) => e.textContent ?? "").filter((t) => /[؀-ۿ]/.test(t)));
  expect(monoArabic, "حرف عربي داخل mono").toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  const axe = await new AxeBuilder({ page }).include("#feedback").analyze();
  expect(
    axe.violations.map(
      (v) =>
        `${v.id}: ${v.help} — ${v.nodes.map((n) => `${n.target.join(" ")} :: ${(n.failureSummary ?? "").replace(/\s+/g, " ").slice(0, 160)}`).join(" | ")}`,
    ),
  ).toEqual([]);
}

test.describe("SYS-11 · ملاحظاتك", () => {
  test("الكاشير يرسل ملاحظة ويرى ردّ الفريق؛ الحقول المرسلة بلا بيانات منشأة", async ({ page }) => {
    await seed(page, "cashier");
    const sent: Record<string, unknown>[] = [];
    let seen = 0;
    let list = [row()];
    await page.route(/\/api\/support\/feedback(\?.*)?$/, (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill(
          json(200, { items: list, unseen: list.filter((r) => r.unseen).length }),
        );
      }
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      sent.push(body);
      const created = row({
        id: "f2",
        client_id: body["client_id"],
        reference: "FB-261112-0002",
        kind: "problem",
        kind_label: "مشكلة",
        text: body["text"],
        status: "new",
        status_label: "جديدة",
        reply: "",
        updated_at: "",
        unseen: false,
      });
      list = [created, ...list];
      return route.fulfill(json(201, created));
    });
    await page.route("**/api/support/feedback/seen", (route) => {
      seen += 1;
      return route.fulfill(json(200, { items: list, unseen: 0 }));
    });
    await login(page);
    const section = page.locator("#feedback");
    await expect(section).toHaveAttribute("data-state", "ready");
    await expect(section).toContainText("ملاحظاتك");
    await expect(section).toContainText("ردّ فريق فيزانو");
    await expect(section).toContainText("سنضيفه في الإصدار القادم");
    await expect(section).toContainText("ردّ جديد");
    await expect(section).toContainText("قيد الدراسة");
    // StrictMode في dev يشغّل التحميل الأول مرتين
    await expect.poll(() => seen).toBeGreaterThanOrEqual(1);
    await checkLayout(page);

    // النص فارغ: validation_error بلا طلب
    await section.getByRole("button", { name: "أرسل الملاحظة" }).click();
    await expect(section).toHaveAttribute("data-state", "validation_error");
    await expect(section).toContainText("اكتب ملاحظتك أولاً.");
    expect(sent).toHaveLength(0);

    await section.getByRole("radio", { name: "مشكلة" }).check();
    await section.getByLabel("ملاحظتك").fill("الطابعة تطبع سطراً فارغاً");
    await section.getByRole("switch", { name: "يمكن للفريق التواصل معي" }).click();
    await section.getByRole("button", { name: "أرسل الملاحظة" }).click();
    await expect(section).toHaveAttribute("data-state", "success");
    await expect(section).toContainText("وصلت ملاحظتك");
    await expect(section.locator(".sting-mono").first()).toHaveText("FB-261112-0002");
    expect(sent).toHaveLength(1);
    expect(Object.keys(sent[0]!).sort()).toEqual([
      "app_version",
      "attachment",
      "attachment_name",
      "client_id",
      "contact_ok",
      "created_at",
      "kind",
      "platform",
      "screen",
      "text",
    ]);
    expect(sent[0]).toMatchObject({
      kind: "problem",
      text: "الطابعة تطبع سطراً فارغاً",
      contact_ok: true,
      screen: "SYS-11",
      platform: "web",
    });
    await checkLayout(page);
  });

  test("بلا اتصال: saved_local ثم تُرسل عند العودة بالمعرّف نفسه", async ({ page, context }) => {
    await seed(page, "owner");
    let offline = true;
    const posted: string[] = [];
    await page.route(/\/api\/support\/feedback(\?.*)?$/, (route) => {
      if (offline) return route.abort("internetdisconnected");
      if (route.request().method() === "GET")
        return route.fulfill(json(200, { items: [], unseen: 0 }));
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      posted.push(String(body["client_id"]));
      return route.fulfill(
        json(201, row({ client_id: body["client_id"], reply: "", unseen: false })),
      );
    });
    await login(page);
    const section = page.locator("#feedback");
    await section.getByLabel("ملاحظتك").fill("أريد وضعاً ليلياً");
    await section.getByRole("button", { name: "أرسل الملاحظة" }).click();
    await expect(section).toHaveAttribute("data-state", "saved_local");
    await expect(section).toContainText("حُفظت الملاحظة على الجهاز — تُرسل عند عودة الاتصال");
    await expect(section).toContainText("بانتظار الإرسال");
    expect(posted).toHaveLength(0);
    offline = false;
    await context.setOffline(true);
    await context.setOffline(false);
    await expect.poll(() => posted.length).toBe(1);
    await expect(section).not.toContainText("بانتظار الإرسال");
  });

  test("لقطة شاشة (§٢٦٧): صورة تُرفق، وغير الصورة تُرفض قبل الإرسال", async ({ page }) => {
    await seed(page, "owner");
    const sent: Record<string, unknown>[] = [];
    await page.route(/\/api\/support\/feedback(\?.*)?$/, (route) => {
      if (route.request().method() === "GET")
        return route.fulfill(json(200, { items: [], unseen: 0 }));
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      sent.push(body);
      return route.fulfill(
        json(
          201,
          row({ client_id: body["client_id"], reply: "", unseen: false, has_attachment: true }),
        ),
      );
    });
    await login(page);
    const section = page.locator("#feedback");
    const input = section.locator('input[type="file"]').first();
    await input.setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("x"),
    });
    await expect(section).toContainText("اللقطة صورة PNG أو JPEG أو WebP حتى 1.5 ميغابايت.");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    await input.setInputFiles({ name: "screen.png", mimeType: "image/png", buffer: png });
    await expect(section).toContainText("screen.png");
    await section.getByLabel("ملاحظتك").fill("الشاشة تظهر هكذا");
    await section.getByRole("button", { name: "أرسل الملاحظة" }).click();
    await expect(section).toHaveAttribute("data-state", "success");
    const shot = sent[0]!["attachment"];
    expect(typeof shot === "string" ? shot : "").toMatch(/^data:image\/png;base64,/);
    expect(sent[0]!["attachment_name"]).toBe("screen.png");
  });

  test("390: القسم يتسع للهاتف بلا تمرير أفقي، empty بلا ملاحظات", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page, "owner");
    await page.route(/\/api\/support\/feedback(\?.*)?$/, (route) =>
      route.fulfill(json(200, { items: [], unseen: 0 })),
    );
    await login(page);
    const section = page.locator("#feedback");
    await expect(section).toHaveAttribute("data-state", "empty");
    await expect(section).toContainText("ما ترسله يظهر هنا مع حالته وردّ الفريق.");
    await checkLayout(page);
  });

  test("ردّ فاشل لقائمة «ملاحظاتي»: server_error مع «أعد المحاولة» لا تحميل بلا نهاية (§٢٧٣)", async ({
    page,
  }) => {
    await seed(page, "owner");
    let broken = true;
    await page.route(/\/api\/support\/feedback(\?.*)?$/, (route) =>
      broken
        ? route.fulfill(json(500, { detail: "server_error" }))
        : route.fulfill(json(200, { items: [row()], unseen: 0 })),
    );
    await login(page);
    const section = page.locator("#feedback");
    await expect(section).toHaveAttribute("data-state", "server_error");
    broken = false;
    await section.getByRole("button", { name: "أعد المحاولة" }).click();
    await expect(section).toHaveAttribute("data-state", "ready");
  });

  test("الطابور لا يُحذف بصمت: 429 عند إعادة الإرسال تُبقي المسودة «بانتظار الإرسال» (§٢٧٣)", async ({
    page,
    context,
  }) => {
    await seed(page, "owner");
    let mode: "offline" | "limited" | "open" = "offline";
    const posted: string[] = [];
    await page.route(/\/api\/support\/feedback(\?.*)?$/, (route) => {
      if (mode === "offline") return route.abort("internetdisconnected");
      if (route.request().method() === "GET")
        return route.fulfill(json(200, { items: [], unseen: 0 }));
      if (mode === "limited") return route.fulfill(json(429, { detail: "rate_limited" }));
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      posted.push(String(body["client_id"]));
      return route.fulfill(
        json(201, row({ client_id: body["client_id"], reply: "", unseen: false })),
      );
    });
    await login(page);
    const section = page.locator("#feedback");
    await section.getByLabel("ملاحظتك").fill("ملاحظة كُتبت بلا اتصال");
    await section.getByRole("button", { name: "أرسل الملاحظة" }).click();
    await expect(section).toHaveAttribute("data-state", "saved_local");
    const limited = page.waitForResponse(
      (r) => r.url().endsWith("/api/support/feedback") && r.status() === 429,
    );
    mode = "limited";
    await context.setOffline(true);
    await context.setOffline(false);
    await limited;
    await expect(section).toContainText("بانتظار الإرسال");
    await expect(section).toContainText("ملاحظة كُتبت بلا اتصال");
    mode = "open";
    await context.setOffline(true);
    await context.setOffline(false);
    await expect.poll(() => posted.length).toBe(1);
    await expect(section).not.toContainText("بانتظار الإرسال");
  });
});

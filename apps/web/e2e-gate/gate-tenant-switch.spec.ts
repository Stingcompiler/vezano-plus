import { expect, type Page, test } from "@playwright/test";

import {
  addSugar,
  CUSTOMER,
  cutNetwork,
  goHome,
  ITEM,
  newDevice,
  openInvoice,
  openShift,
  OWNER,
  pendingCount,
  resetScenario,
  restoreNetwork,
  revealLink,
  saveCash,
  SHOP,
  syncNow,
} from "./fixtures";

/**
 * مراجعة 2026-11-10 (ع-٤): جهاز واحد ومنشأتان. كانت القاعدة المحلية واحدة ثابتة الاسم والخروج لا
 * يمحوها، فالدخول بعده إلى منشأة أخرى يعرض كتالوج الأولى وعملاءها ويعدّ بيعها المعلّق معلّقاً له.
 * الآن لكل منشأة قاعدتها: الثانية لا ترى شيئاً من الأولى، ومعلّق الأولى محفوظ حتى تعود فيُرفع.
 */
const OTHER = "مخزن البركة";

/** كم صفاً في قاعدة محلية بعينها يحوي النص، وكم عملية لم تُرفع فيها. */
async function inspect(page: Page, database: string, needle: string) {
  return page.evaluate(
    async ([name, text]) => {
      const names = (await indexedDB.databases()).map((d) => d.name);
      if (!names.includes(name)) return { exists: false, hits: 0, unsent: 0 };
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(new Error(String(r.error)));
      });
      let hits = 0;
      let unsent = 0;
      for (const store of Array.from(db.objectStoreNames)) {
        const rows = await new Promise<unknown[]>((res) => {
          const r = db.transaction(store).objectStore(store).getAll();
          r.onsuccess = () => res(r.result as unknown[]);
        });
        for (const row of rows) {
          if (JSON.stringify(row).includes(text)) hits++;
          const state = (row as { state?: string }).state;
          if (store === "operations" && (state === "local" || state === "pending")) unsent++;
        }
      }
      db.close();
      return { exists: true, hits, unsent };
    },
    [database, needle] as const,
  );
}

/**
 * الخروج بخطوتيه. التأكيد حالة في زر الخروج نفسه: إن أُعيد تركيب شريط التنقل بين النقرتين (انتقال
 * لم يستقرّ بعد) ضاع التأكيد وبقي الاختبار ينتظر «اخرج» إلى نهاية مهلته — فتُعاد الخطوتان حتى
 * نبلغ صفحة الدخول.
 */
async function logout(page: Page) {
  const confirm = page.getByRole("button", { name: "اخرج", exact: true });
  await expect(async () => {
    if (/\/login/.test(page.url())) return;
    // داخل الإعادة: تنقّل تأخّر وصوله قد ينقل الصفحة بعد أن حسبناها «الرئيسية» — وشاشات وضع البيع
    // بلا زر خروج، فكان الاختبار ينتظره إلى نهاية مهلته (فشل gate على ‎#277)
    await goHome(page);
    if (!(await confirm.isVisible()))
      await page.getByRole("button", { name: "تسجيل الخروج" }).first().click({ timeout: 5_000 });
    await confirm.click({ timeout: 5_000 });
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  }).toPass({ timeout: 90_000 });
}

async function loginTo(page: Page, shop: string) {
  await page.getByLabel("رقم الهاتف أو البريد").fill(OWNER.identifier);
  await page.getByLabel("كلمة المرور").fill(OWNER.password);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/select-org/);
  await page.getByRole("button", { name: new RegExp(shop) }).click();
  await expect(page).not.toHaveURL(/\/select-org/);
}

test("منشأة ثانية على الجهاز نفسه لا ترى بيانات الأولى، ومعلّق الأولى يُرفع عند عودتها", async ({
  browser,
  request,
}) => {
  test.setTimeout(420_000);
  const scenario = await resetScenario(request);
  const d = await newDevice(browser, "جهاز مشترك", OWNER);
  const page = d.page;
  await openShift(page);
  await addSugar(page, "1");
  await cutNetwork(d);
  const invoice = await saveCash(page);
  expect(await pendingCount(page)).toBe(1);

  // خروج دون اتصال: المعلّق يبقى على الجهاز
  await logout(page);
  await restoreNetwork(d);

  // دخول إلى المنشأة الأخرى: قاعدتها الخاصة، فارغة من بيانات الأولى
  await loginTo(page, OTHER);
  const active = await page.evaluate(() => localStorage.getItem("sting.db.active"));
  expect(active).toBe(`sting-${scenario.tenant_b}`);
  expect(await inspect(page, active!, CUSTOMER)).toMatchObject({ hits: 0, unsent: 0 });
  await goHome(page);
  await expect(page.locator("body")).toContainText(OTHER);
  await expect(page.locator("body")).not.toContainText("عمليات معلّقة");
  // ما كان يظهر: أصناف الأولى في نقطة البيع وعميلها في قائمة العملاء. المنشأة الثانية بلا جهاز
  // مجهَّز فقد لا تُفتح الشاشة أصلاً — المهم ألا يظهر فيها شيء من الأولى حيثما وصلنا
  for (const [label, text] of [
    ["نقطة البيع", ITEM],
    ["العملاء والذمم", CUSTOMER],
  ] as const) {
    const link = await revealLink(page, label);
    if (await link.count()) await link.click({ timeout: 15_000 }).catch(() => undefined);
    // ننتظر وصول التنقّل إن كان سيصل: الفحص على الشاشة المقصودة لا على الرئيسية قبل مغادرتها
    await page.waitForURL((u) => u.pathname !== "/", { timeout: 5_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await expect(page.locator("body")).not.toContainText(text);
    await expect(page.locator("body")).not.toContainText("عمليات معلّقة");
    // العودة عبر روابط التنقل لا بزرّ الرجوع: تنتظر استقرار الرئيسية قبل الخطوة التالية
    await goHome(page);
  }
  // وبيع الأولى المعلّق ما زال في قاعدتها لم يُمسّ
  expect(await inspect(page, "sting-bootstrap", CUSTOMER)).toMatchObject({
    exists: true,
    unsent: 1,
  });

  // العودة إلى الأولى: الجهاز ما زال مجهَّزاً لها، والمعلّق يُرفع مرة واحدة
  await logout(page);
  await loginTo(page, SHOP);
  expect(await page.evaluate(() => localStorage.getItem("sting.db.active"))).toBe(
    "sting-bootstrap",
  );
  expect(await pendingCount(page)).toBe(1);
  await syncNow(page);
  await openInvoice(page, invoice);
  await expect(page.locator("main")).toContainText(invoice);
});

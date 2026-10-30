import { expect, type Page, test } from "@playwright/test";

/**
 * ط٥ (0005 §٢٠٩): الطباعة الأصلية من الطابور، وتنفيذ الاختصارات. العتاد مزيّف عبر `window.__stingDesk`.
 */
async function open(page: Page, path: string, fake: Record<string, unknown>, queue?: unknown[]) {
  await page.addInitScript(
    ({ fake, queue }) => {
      (window as unknown as { __stingDesk: unknown }).__stingDesk = fake;
      if (queue) (window as unknown as { __stingDeskQueue: unknown }).__stingDeskQueue = queue;
    },
    { fake, queue },
  );
  await page.goto(path);
}

const failedJob = {
  id: "INV-2001-1",
  name: "فاتورة",
  ref: "INV-2001",
  copy: false,
  source: "2026-10-30 13:19",
  at: "2026-10-30T13:19:00Z",
  state: "failed",
  effect: "لا أثر على الدفتر.",
  bytes: "G0BB",
  target: { printer: "XP-80C" },
};

test.describe("DESK-02 · الطباعة الأصلية", () => {
  test("إعادة طباعة الطابور ترسل البتّات نفسها للطابعة نفسها — ثم يفرغ الطابور: طُبع", async ({
    page,
  }) => {
    await open(page, "/desktop/printers", { printOk: [true] }, [failedJob]);
    const root = page.locator('[data-screen="DESK-02"]');
    await expect(root).toHaveAttribute("data-state", "server_error");
    await page.getByRole("button", { name: "إعادة طباعة المهام الثلاث" }).click();
    await expect(root).toHaveAttribute("data-state", "success");
    const printed = await page.evaluate(
      () =>
        (window as unknown as { __stingDesk: { printed?: { target: unknown; size: number }[] } })
          .__stingDesk.printed,
    );
    expect(printed).toEqual([{ target: { printer: "XP-80C" }, size: 3 }]);
  });

  test("الطابعة ما زالت متوقفة: المهمة تبقى فاشلة في الطابور — لا بيع ولا ورقة مكررة", async ({
    page,
  }) => {
    await open(page, "/desktop/printers", { printOk: [false] }, [failedJob]);
    await page.getByRole("button", { name: "إعادة طباعة المهام الثلاث" }).click();
    const root = page.locator('[data-screen="DESK-02"]');
    await expect(root).toHaveAttribute("data-state", "server_error");
    await expect(root).toContainText("INV-2001");
  });
});

test.describe("DESK-03 · تنفيذ الاختصارات", () => {
  test("F2 خارج شاشة البيع يفتح البحث", async ({ page }) => {
    await open(page, "/desktop/setup", { shortcuts: true });
    await expect(page.locator('[data-screen="DESK-01"]')).toBeVisible();
    await page.keyboard.press("F2");
    // بلا جلسة يعيد البحث إلى الدخول بوجهته — المهم أن الوجهة البحث
    await expect(page).toHaveURL(/\/search$|next=%2Fsearch/);
  });

  test("داخل خريطة الاختصارات لا يُنفَّذ شيء — الضغطة للتعديل", async ({ page }) => {
    await open(page, "/desktop/shortcuts", { shortcuts: true });
    await expect(page.locator('[data-screen="DESK-03"]')).toBeVisible();
    await page.keyboard.press("F2");
    await expect(page).toHaveURL(/\/desktop\/shortcuts$/);
  });
});

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * PUB-07 (0005 §٢٦٦) — «أرسل ملاحظة»: زائر بلا حساب؛ خاصة بالفريق؛ «ملاحظة عن هذا المحل» من صفحة المحل
 * فقط؛ الفخّ المخفي يبقى فارغاً لدى البشر. نصوص من عند المنفّذ — toContainText.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

test.describe("PUB-07", () => {
  test("زائر يرسل اقتراحاً للمنصة ببريد اختياري", async ({ page }) => {
    const sent: Record<string, unknown>[] = [];
    await page.route("**/api/public/feedback", (route) => {
      sent.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill(json(201, { reference: "PF-261112-0001" }));
    });
    await page.goto("/feedback");
    const root = page.locator('[data-screen="PUB-07"]');
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(root).toContainText("أرسل ملاحظة");
    await expect(root).toContainText("تصل إلى فريق فيزانو وحده، ولا تُنشر.");
    await expect(root.getByRole("radio", { name: "ملاحظة عن هذا المحل" })).toHaveCount(0);
    // فارغ: validation_error بلا طلب
    await root.getByRole("button", { name: "أرسل الملاحظة" }).click();
    await expect(root).toHaveAttribute("data-state", "validation_error");
    await expect(root).toContainText("اكتب ملاحظتك أولاً.");
    expect(sent).toHaveLength(0);
    await root.getByRole("radio", { name: "مشكلة في الموقع" }).check();
    await root.getByLabel("ملاحظتك").fill("صفحة الباقات بطيئة على الهاتف");
    await root.getByLabel("بريدك (اختياري)").fill("visitor@example.com");
    await root.getByRole("button", { name: "أرسل الملاحظة" }).click();
    await expect(root).toHaveAttribute("data-state", "success");
    await expect(root).toContainText("وصلت ملاحظتك");
    await expect(root.locator(".sting-mono")).toHaveText("PF-261112-0001");
    expect(sent[0]).toEqual({
      kind: "site",
      text: "صفحة الباقات بطيئة على الهاتف",
      email: "visitor@example.com",
      shop: "",
      page: "/feedback",
      website: "",
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    const axe = await new AxeBuilder({ page }).include('[data-screen="PUB-07"]').analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  test("من صفحة محل: «ملاحظة عن هذا المحل» مختارة، والخطأ من الخادم يظهر", async ({ page }) => {
    const sent: Record<string, unknown>[] = [];
    await page.route("**/api/public/feedback", (route) => {
      sent.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill(json(429, { detail: "rate_limited" }));
    });
    await page.goto("/feedback?shop=wahat");
    const root = page.locator('[data-screen="PUB-07"]');
    await expect(root.getByRole("radio", { name: "ملاحظة عن هذا المحل" })).toBeChecked();
    await root.getByLabel("ملاحظتك").fill("الأسعار غير ظاهرة");
    await root.getByRole("button", { name: "أرسل الملاحظة" }).click();
    await expect(root).toHaveAttribute("data-state", "validation_error");
    await expect(root).toContainText("أرسلت ملاحظات كثيرة الآن — جرّب بعد ساعة.");
    expect(sent[0]).toMatchObject({ kind: "shop", shop: "wahat", page: "/portal/wahat" });
    const axe = await new AxeBuilder({ page }).include('[data-screen="PUB-07"]').analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

import type { Page } from "@playwright/test";

/**
 * صفحة البذر: يفتحها وينتظر أن ينشئ التطبيق قاعدته بمخازنها، ثم يكتب الاختبار فيها.
 *
 * التطبيق يفتح قاعدته في أثر بعد حدث التحميل؛ والبذر كان يفتحها فور `goto` — فإن سبق التطبيقَ أنشأ
 * قاعدة فارغة بلا مخازن وفشل بـ«One of the specified object stores was not found». يظهر تحت الحمل
 * (CI، خادم بارد، لقطات المراجعة) ويختفي بالإعادة (مراجعة 2026-11-10 ع-٢٠).
 */
export async function openSeedPage(page: Page, path = "/welcome"): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(async () =>
    (await indexedDB.databases()).some(
      // Dexie `version(1)` = الإصدار 10 في IndexedDB
      (d) => d.name === "sting-bootstrap" && (d.version ?? 0) >= 10,
    ),
  );
}

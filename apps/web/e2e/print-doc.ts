import { expect, type Page } from "@playwright/test";

/**
 * الورقة المطبوعة (0005 §٢٠٥): يُطبع مستند الشاشة وحده (`.c-print-doc`) — لا ترويسة ولا قائمة ولا
 * إشعار ولا زرّ — وهامش الصفحة صفر فلا يكتب المتصفح فوقها عنوان الصفحة ورابطها (localhost…)
 * وتاريخها، وعنوان الصفحة لحظة الطباعة اسمُ المستند (اسم ملف PDF) لا «فيزانو بلص».
 *
 * `print` ينقر زرّ الطباعة؛ نلفّ `window.print` لنقرأ العنوان لحظتها (الحوار لا يُفتح في الاختبار).
 * المستند المخفي على الشاشة (`screen="hidden"`) موجود قبل النقر، فتُفحص الورقة أولاً.
 */
export async function expectPrintDoc(
  page: Page,
  opts: { print: () => Promise<void>; title: RegExp; contains: readonly string[] },
): Promise<void> {
  await page.emulateMedia({ media: "print" });
  try {
    const doc = page.locator(".c-print-doc");
    await expect(doc).toHaveCount(1);
    await expect(doc).toBeVisible();
    for (const t of opts.contains) await expect(doc).toContainText(t);
    const report = await page.evaluate(() => {
      const d = document.querySelector(".c-print-doc")!;
      // ما يُرسم خارج المستند وآبائه = ما سيظهر على الورقة زائداً
      const outside = Array.from(document.body.querySelectorAll("*"))
        .filter((el) => !d.contains(el) && !el.contains(d))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 1 && r.height > 1 && getComputedStyle(el).display !== "none";
        })
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className)}`.slice(0, 80));
      // قاعدة @page في وسط الطباعة بهامش صفر
      const margins: string[] = [];
      const walk = (rules: CSSRuleList) => {
        for (const r of Array.from(rules)) {
          if (r instanceof CSSPageRule) margins.push(r.style.margin);
          else if ("cssRules" in r) walk((r as CSSGroupingRule).cssRules);
        }
      };
      for (const s of Array.from(document.styleSheets)) {
        try {
          walk(s.cssRules);
        } catch {
          /* ورقة من أصل آخر */
        }
      }
      return { outside, margins, text: (d as HTMLElement).innerText };
    });
    expect(report.outside).toEqual([]);
    expect(report.margins.length).toBeGreaterThan(0);
    expect(report.margins.every((m) => /^0(px)?$/.test(m))).toBe(true);
    expect(report.text).not.toMatch(/localhost|https?:\/\/|undefined|NaN/);
  } finally {
    await page.emulateMedia({ media: null });
  }

  // بعد فحص الورقة: النقر قد ينقل الصفحة (POS-11 «اطبع وابدأ بيعاً جديداً»)
  await page.evaluate(() => {
    const w = window as unknown as { __printTitle?: string };
    const orig = window.print.bind(window);
    window.print = () => {
      w.__printTitle = document.title;
      orig();
    };
  });
  const titles = page.waitForFunction(
    () => (window as unknown as { __printTitle?: string }).__printTitle,
  );
  await opts.print();
  expect(await (await titles).jsonValue()).toMatch(opts.title);
}

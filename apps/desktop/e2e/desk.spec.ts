import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "../../web/e2e/frame-match";
import { fromFrame } from "../../web/e2e/frame-provenance";

/**
 * شاشات الحاسوب وحده DESK-01…05 بكل حالاتها المرسومة (0005 §٢٠٨). العتاد مزيّف عبر
 * `window.__stingDesk` (platform/native.ts) — الطابعات والحفظ والإذن والتحديث.
 */
type Fake = Record<string, unknown>;

async function open(page: Page, path: string, fake: Fake = {}, queue?: unknown[]) {
  await page.addInitScript(
    ({ fake, queue }) => {
      (window as unknown as { __stingDesk: unknown }).__stingDesk = fake;
      if (queue) (window as unknown as { __stingDeskQueue: unknown }).__stingDeskQueue = queue;
      window.print = () => undefined;
    },
    { fake, queue },
  );
  await page.goto(path);
}

async function seedMeta(page: Page, entries: Record<string, string>) {
  await page.evaluate(async (entries) => {
    const req = indexedDB.open("sting-bootstrap");
    const db = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
    await new Promise<void>((res) => {
      const tx = db.transaction("meta", "readwrite");
      for (const [key, value] of Object.entries(entries))
        tx.objectStore("meta").put({ key, value });
      tx.oncomplete = () => res();
    });
    db.close();
  }, entries);
}

test.describe("DESK-01", () => {
  test("loading → ready: الفحص لا يتجاوز ثانيتين ثم أول تشغيل بخطواته الثلاث", async ({
    page,
  }, info) => {
    await open(page, "/desktop/setup", { updateDelayMs: 10_000 });
    await expectFrame(page, info, {
      screenId: "DESK-01",
      state: "loading",
      texts: fromFrame("DESK-01", "loading", [
        "جارٍ التحقق من التحديثات",
        "فحصٌ سريع عند الإقلاع، ولا يحجب الواجهة.",
      ]),
    });
    await expectFrame(page, info, {
      screenId: "DESK-01",
      state: "ready",
      texts: fromFrame("DESK-01", "ready", [
        "أول تشغيل",
        "ثلاث خطوات: الاتصال بالمنشأة، ثم الطابعة، ثم الاختصارات. ولا شيء منها يمنع البيع لو أُجّل.",
      ]),
    });
  });

  test("server_error: تحديث لا يُثبَّت على هذا الجهاز — النسخة الحالية تعمل ولن نوقفها", async ({
    page,
  }, info) => {
    await open(page, "/desktop/setup", {
      update: { status: "unsupported", current: "1.3.2", next: "1.4.0" },
    });
    await expectFrame(page, info, {
      screenId: "DESK-01",
      state: "server_error",
      texts: fromFrame("DESK-01", "server_error", [
        "التحديث 1.4.0 لا يمكن تثبيته على هذا الجهاز",
        "يتطلب نظاماً أحدث من المثبَّت هنا.",
        "نسختك الحالية",
        "حالة المزامنة على 1.3.2",
        "مدعومة",
        "متابعة على 1.3.2",
      ]),
    });
  });

  test("success: الجهاز موصول والطابعة مختارة — الجهاز جاهز", async ({ page }, info) => {
    await open(page, "/desktop/setup");
    await seedMeta(page, {
      "device.registration": JSON.stringify({
        deviceId: "d1",
        registrationSecret: "s1",
        prefix: "A1",
        branchId: "b1",
      }),
      "desktop.printers": JSON.stringify({ receipts: "XP-80C", reports: "XP-80C", networkIp: "" }),
    });
    await page.reload();
    await expectFrame(page, info, {
      screenId: "DESK-01",
      state: "success",
      texts: fromFrame("DESK-01", "success", [
        "الجهاز جاهز",
        "موصولٌ بالمنشأة والفرع، والطابعة مختارة، والاختصارات مفعّلة.",
        "اطبع إيصالاً تجريبياً",
      ]),
    });
  });
});

test.describe("DESK-02", () => {
  test("ready → success: طابعتان لكل نوع مستند، ثم إيصال تجريبي — طُبع", async ({ page }, info) => {
    await open(page, "/desktop/printers", {
      printers: [
        { name: "XP-80C", default: true },
        { name: "HP A4", default: false },
      ],
    });
    await expectFrame(page, info, {
      screenId: "DESK-02",
      state: "ready",
      texts: fromFrame("DESK-02", "ready", [
        "الطابعة والطابور",
        "طابعتان",
        "إيصالات على الحرارية وتقارير على A4. الافتراضي لكل نوع مستند لا للنظام كلّه.",
      ]),
    });
    await page.getByRole("button", { name: "اطبع إيصالاً تجريبياً" }).click();
    await expectFrame(page, info, {
      screenId: "DESK-02",
      state: "success",
      texts: fromFrame("DESK-02", "success", [
        "طُبع",
        "خرج المستند. والسؤال يبقى: هل خرج سليماً؟",
        "إعادة الطباعة بنفس الرقم",
      ]),
    });
  });

  test("empty: بحثنا ولم نجد — والبيع مستمر بلا طابعة", async ({ page }, info) => {
    await open(page, "/desktop/printers", { printers: [] });
    await expectFrame(page, info, {
      screenId: "DESK-02",
      state: "empty",
      texts: fromFrame("DESK-02", "empty", [
        "لا طابعات",
        "نقول ما فعلناه",
        "البيع مستمر",
        "بلا طابعة يُباع وتُشارَك الفاتورة رقمياً. الطباعة راحةٌ لا شرطٌ للبيع.",
      ]),
    });
    await expect(page.getByLabel("عنوان IP")).toBeVisible();
  });

  test("server_error: الطابعة توقفت — إعادة نسخة لا إعادة بيع، وحذف الطابور لا يمس الفواتير", async ({
    page,
  }, info) => {
    const job = (id: string, state: string) => ({
      id,
      name: "إيصال بيع",
      ref: id,
      copy: true,
      source: "فاتورة مزامَنة — 13:19",
      at: "2026-10-30T13:19:00Z",
      state,
      effect: "لا أثر على الدفتر.",
    });
    await open(page, "/desktop/printers", {}, [
      job("INV-1045", "waiting"),
      job("INV-1046", "failed"),
    ]);
    await expectFrame(page, info, {
      screenId: "DESK-02",
      state: "server_error",
      texts: fromFrame("DESK-02", "server_error", [
        "طابور الطباعة",
        "الطابعة الحرارية توقفت عن الاستجابة",
        "إعادة الطباعة لا تنشئ شيئاً.",
        "حذف الطابور — لا يمس الفواتير",
        "الأثر على الدفتر",
      ]),
    });
    await page.getByRole("button", { name: "حذف الطابور — لا يمس الفواتير" }).click();
    await expect(page.locator('[data-screen="DESK-02"]')).toHaveAttribute("data-state", "ready");
  });
});

test.describe("DESK-03", () => {
  test("ready → validation_error → conflict: المستخدم يُسمّى مالكه، والمحجوز للنظام يُرفض", async ({
    page,
  }, info) => {
    await open(page, "/desktop/shortcuts");
    await expectFrame(page, info, {
      screenId: "DESK-03",
      state: "ready",
      texts: fromFrame("DESK-03", "ready", [
        "خريطة الاختصارات",
        "التركيز يتبع العمل",
        "بحث عن صنف",
        "لا اختصار",
      ]),
    });
    const replace = page.getByRole("button", { name: "استبدله" }).first();
    await replace.click();
    await page.keyboard.press("F4");
    await expectFrame(page, info, {
      screenId: "DESK-03",
      state: "validation_error",
      texts: fromFrame("DESK-03", "validation_error", [
        "اختصار مستخدم",
        "الاختصار المطلوب محجوز لفعلٍ آخر أو للنظام نفسه.",
        "محجوز لـ",
      ]),
    });
    await replace.click();
    await page.keyboard.press("Control+P");
    await expectFrame(page, info, {
      screenId: "DESK-03",
      state: "conflict",
      texts: fromFrame("DESK-03", "conflict", [
        "تعارض اختصار",
        "اختر تركيبة أخرى من قائمة المتاح.",
      ]),
    });
    await expect(page.getByText("Ctrl+P", { exact: true }).first()).toBeVisible();
  });
});

test.describe("DESK-04", () => {
  const download = (page: Page) =>
    page.evaluate(() => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(["a,b"], { type: "text/csv" }));
      a.download = "تقرير-المبيعات-30-يوماً.csv";
      a.click();
    });

  test("success: المسار كاملاً و«افتح المجلّد» — بلا فتح تلقائي", async ({ page }, info) => {
    await open(page, "/desktop/setup", { downloads: true });
    await download(page);
    await expectFrame(page, info, {
      screenId: "DESK-04",
      state: "success",
      texts: fromFrame("DESK-04", "success", [
        "حُفظ",
        "المسار كاملاً و«افتح المجلّد». الملف الذي لا يُعرف مكانه ضائعٌ فعلياً.",
      ]),
    });
    await page.getByRole("button", { name: "افتح المجلّد" }).click();
    const revealed = await page.evaluate(
      () => (window as unknown as { __stingDesk: { revealed?: string[] } }).__stingDesk.revealed,
    );
    expect(revealed?.[0]).toContain("تقرير-المبيعات-30-يوماً.csv");
  });

  test("validation_error → success: وجهة للقراءة فقط — اختيار مجلد آخر بالملف نفسه", async ({
    page,
  }, info) => {
    await open(page, "/desktop/setup", {
      downloads: true,
      save: [{ status: "not_writable", reason: "permission" }],
    });
    await download(page);
    await expectFrame(page, info, {
      screenId: "DESK-04",
      state: "validation_error",
      texts: fromFrame("DESK-04", "validation_error", [
        "الوجهة غير قابلة للكتابة",
        "مجلّد للقراءة فقط أو ملف مفتوح في برنامج آخر.",
      ]),
    });
    await page.getByRole("button", { name: "اختيار مجلد آخر" }).click();
    await expect(page.locator('[data-screen="DESK-04"]')).toHaveAttribute("data-state", "success");
  });

  test("server_error: فشل الحفظ — إعداداتك محفوظة وإعادة المحاولة بالملف نفسه", async ({
    page,
  }, info) => {
    await open(page, "/desktop/setup", {
      downloads: true,
      save: [{ status: "failed", reason: "full" }],
    });
    await download(page);
    await expectFrame(page, info, {
      screenId: "DESK-04",
      state: "server_error",
      texts: fromFrame("DESK-04", "server_error", [
        "فشل حفظ الملف — وإعداداتك محفوظة",
        "إعادة المحاولة",
      ]),
    });
    await page.getByRole("button", { name: "إعادة المحاولة" }).click();
    await expect(page.locator('[data-screen="DESK-04"]')).toHaveAttribute("data-state", "success");
  });
});

test.describe("DESK-05", () => {
  test("ready: ما نملك دليله وما لا نملكه — والإغلاق يُصغّر ما دام معلّق", async ({
    page,
  }, info) => {
    await open(page, "/desktop/notifications");
    await expectFrame(page, info, {
      screenId: "DESK-05",
      state: "ready",
      texts: fromFrame("DESK-05", "ready", [
        "الإشعارات وسلوك الإغلاق",
        "لماذا لا يُنهي",
        "التطبيق مفتوح",
        "مفتوح في الخلفية",
        "التطبيق مُغلق كلياً",
        "غير مضمون",
      ]),
    });
  });

  test("permission_denied: الإذن مرفوض — لا وعد بإشعار بعد الإغلاق الكامل", async ({
    page,
  }, info) => {
    await open(page, "/desktop/notifications", { permission: "denied" });
    await expectFrame(page, info, {
      screenId: "DESK-05",
      state: "permission_denied",
      texts: fromFrame("DESK-05", "permission_denied", ["لا وعد بإشعار بعد الإغلاق الكامل"]),
    });
  });

  test("offline: بلا اتصال — الحد يُقال بصراحة", async ({ page, context }, info) => {
    await open(page, "/desktop/notifications");
    await expect(page.locator('[data-screen="DESK-05"][data-state="ready"]')).toBeVisible();
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "DESK-05",
      state: "offline",
      texts: fromFrame("DESK-05", "offline", ["الحد يُقال بصراحة بدل وعد لا نملك دليله."]),
    });
    await context.setOffline(false);
  });
});

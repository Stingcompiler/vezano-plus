import { defineConfig, devices } from "@playwright/test";

/**
 * دليل «طبق الأصل» (docs/desktop-plan.md ط٢): مواصفات الويب نفسها (apps/web/e2e) تُشغَّل على بناء الحاسوب.
 * المقاسات: 1440 مقاس الويب المرسوم، و1366 و1920 مقاسا الحاسوب في states-matrix.csv (D).
 * المستثنى ما ليس في تطبيق الحاسوب: لوحة المشغّل وصفحات الفحص (scripts/gen-routes.mjs EXCLUDED)، وما يخصّ
 * المتصفح وحده — تثبيت PWA وإشعارات الويب وترويسات الخادم وSEO (بدائلها الأصلية DESK-01/05 في طبقة المنصة).
 * الخادم بناءٌ ثابت بوضع التطوير (`vite build --mode development`): خطافات الاختبار (`__sting*`) حاضرة كما في
 * `next dev`، والصفحات لا تُترجم عند الطلب — خادم Vite للتطوير كان يترجم مئات الوحدات لكل اختبار فتسقط
 * المواصفات الحسّاسة للتوقيت على مشغّل CI البطيء.
 */
const PORT = process.env.DESKTOP_PORT ?? "1421";

export default defineConfig({
  // مواصفات الويب نفسها + مواصفات شاشات الحاسوب وحده (e2e/)
  testDir: "..",
  testMatch: /(web\/e2e|desktop\/e2e)\/.*\.spec\.ts$/,
  testIgnore: [/platform-/, /probe\.spec/, /web-install/, /web-notify/, /pwa-icons/, /seo-headers/],
  // صفحة الهبوط التسويقية لا تُعرض في تطبيق الحاسوب (يفتح على الدخول — platform/desktop-root.tsx)، ومقياس
  // انزياح التخطيط فيها يقيس تحميل خط Next المسبق بمقاييسه المضبوطة، لا شيئاً في التطبيق
  grepInvert: /الهبوط: العنوان كلمةً كلمة/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "ar",
    trace: "retain-on-failure",
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [
    {
      name: "desktop-1440",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "desk-1366",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } },
    },
    {
      name: "desk-1920",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } },
    },
  ],
  webServer: {
    command: `pnpm prepare-app && vite build --mode development --outDir dist-e2e && vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

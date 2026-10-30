import { defineConfig, devices } from "@playwright/test";

/**
 * دليل «طبق الأصل» (docs/desktop-plan.md ط٢): مواصفات الويب نفسها (apps/web/e2e) تُشغَّل على بناء الحاسوب.
 * المقاسات: 1440 مقاس الويب المرسوم، و1366 و1920 مقاسا الحاسوب في states-matrix.csv (D).
 * المستثنى ما ليس في تطبيق الحاسوب: لوحة المشغّل وصفحات الفحص (scripts/gen-routes.mjs EXCLUDED)، وما يخصّ
 * المتصفح وحده — تثبيت PWA وإشعارات الويب وترويسات الخادم وSEO (بدائلها الأصلية DESK-01/05 في طبقة المنصة).
 * الخادم وضع التطوير كما في الويب (`next dev`): خطافات الاختبار (`__sting*`) لا تُبنى في الإنتاج.
 */
const PORT = process.env.DESKTOP_PORT ?? "1421";

export default defineConfig({
  testDir: "../web/e2e",
  testIgnore: [/platform-/, /probe\.spec/, /web-install/, /web-notify/, /pwa-icons/, /seo-headers/],
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
    command: `pnpm prepare-app && vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

import type { NextConfig } from "next";

/**
 * فحص 2026-10-17 F13 — إصدار بناء قابل للتتبّع بدل `0.0.0-dev`: تاريخ البناء + أول 7 من الالتزام
 * (`STING_BUILD_SHA` يمرّره النشر إلى صورة Docker، وCI يملك `GITHUB_SHA`). `next dev` يبقى «dev».
 */
function buildVersion(): string {
  if (process.env.NEXT_PUBLIC_APP_VERSION) return process.env.NEXT_PUBLIC_APP_VERSION;
  if (process.env.NODE_ENV !== "production") return "dev";
  const d = new Date().toISOString();
  const day = `${d.slice(0, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)}`;
  const sha = (process.env.STING_BUILD_SHA || process.env.GITHUB_SHA || "").slice(0, 7);
  return sha ? `${day}+${sha}` : day;
}

const config: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_APP_VERSION: buildVersion() },
  // خادما التطوير (المعاينة 3100 والاختبار 3011/3100) لا يتشاركان مخرجات البناء — وإلا يكتب أحدهما
  // بيئة الآخر (NEXT_PUBLIC_API_URL) فتطلب المعاينة localhost:8000 مباشرةً وتسقط بـCORS
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // زر أدوات التطوير العائم يغطي التنقل السفلي في 390 ويعترض النقر في Playwright — لا أثر له في الإنتاج
  devIndicators: false,
  // لا يُستعمل `next/image` في أي ملف، فنقطة `/_next/image` مغلقة كلها: ثغرة تنفيذ شيفرة عن بُعد عبر
  // تحسين الصور مع SVG (GHSA-2464-fhr4-w9xw) — تقرير الفحص الشامل 2026-10-24
  images: { unoptimized: true },
  // الحزم المشتركة تُترجم من المصدر (TS) داخل مساحة العمل
  transpilePackages: [
    "@sting/ui-web",
    "@sting/design",
    "@sting/domain",
    "@sting/sync-core",
    "@sting/platform",
    "@sting/contracts",
    "@sting/app-core",
  ],
  // بيانات المستأجر لا تدخل كاشاً عاماً (§١٢.٤): لا ISR افتراضي؛ SSG للعام فقط عند بنائه
  experimental: {
    // الإنتاج: CSS مضمَّن في HTML بدل تسعة ملفات تحجب الرسم الأول (PageSpeed: ‎3.3 ث على شبكة الجوال؛
    // 0005 §١٤٢). لا أثر في التطوير.
    inlineCss: true,
  },
  // ترويسات الأمان (0005 §١٥٤): لا تضمين في إطار غريب (clickjacking)، ولا تخمين نوع المحتوى، ولا
  // تسريب المسار الكامل لمواقع أخرى، وHTTPS إلزامي سنة. لا CSP كامل بعد: CSS المضمَّن (inlineCss)
  // وسكربتات Next المضمَّنة تحتاج nonce — `frame-ancestors` وحده يكفي ضد التضمين.
  headers() {
    return Promise.resolve([
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ]);
  },
  // بوابة T1.43 والنشر بنفس الأصل: `/api/*` يُمرَّر إلى الخادم حين يُضبط `STING_API_UPSTREAM`
  // (مع `NEXT_PUBLIC_API_URL=""` فتصبح طلبات المتصفح نسبية — لا CORS ولا أصل ثانٍ)
  rewrites() {
    const raw = process.env.STING_API_UPSTREAM;
    if (!raw) return Promise.resolve([]);
    // Render يعطي عنوان الخدمة الخاصة «مضيف:منفذ» بلا بروتوكول (0005 §١١٨)
    const upstream = /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
    return Promise.resolve([{ source: "/api/:path*", destination: `${upstream}/api/:path*` }]);
  },
};

export default config;

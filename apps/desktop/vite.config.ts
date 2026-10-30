import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const web = fileURLToPath(new URL("../web", import.meta.url));
const repo = fileURLToPath(new URL("../..", import.meta.url));
const shim = (f: string) => fileURLToPath(new URL(`./src/shims/${f}`, import.meta.url));
const platform = (f: string) => fileURLToPath(new URL(`./src/platform/${f}`, import.meta.url));

/**
 * الشاشات من apps/web/src كما هي: `@/` يشير إليها، و`next/navigation`/`next/link` إلى بدائل React Router.
 * عنوان الخادم من `VITE_API_URL` (الإنتاج plus.vezano.app) ويصل إلى الشيفرة باسم الويب نفسه.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ["VITE_", "NEXT_PUBLIC_"]);
  const api = env.VITE_API_URL ?? env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  return {
    plugins: [react()],
    publicDir: `${web}/public`,
    resolve: {
      alias: [
        // طبقة المنصة: وحدتان من الويب لهما بديل في الحاسوب (مخزن المفاتيح، ولا عامل خدمة) — قبل `@/` العام
        { find: /^@\/lib\/session-store$/, replacement: platform("session-store.ts") },
        { find: /^@\/lib\/pwa$/, replacement: platform("pwa.ts") },
        { find: /^@\//, replacement: `${web}/src/` },
        { find: /^next\/navigation$/, replacement: shim("navigation.ts") },
        { find: /^next\/link$/, replacement: shim("link.tsx") },
      ],
      dedupe: ["react", "react-dom", "@tanstack/react-query", "dexie"],
    },
    define: {
      // خطافات الاختبار وعناصر التطوير في شيفرة الويب تقرأ NODE_ENV كما في Next
      "process.env.NODE_ENV": JSON.stringify(mode === "production" ? "production" : "development"),
      "process.env.NEXT_PUBLIC_API_URL": JSON.stringify(api),
      "process.env.NEXT_PUBLIC_APP_VERSION": JSON.stringify(env.VITE_APP_VERSION ?? "desktop-dev"),
      "process.env.NEXT_PUBLIC_SITE_URL": JSON.stringify("https://plus.vezano.app"),
    },
    // Tauri يتوقّع منفذاً ثابتاً، ولا يمسح الطرفية فتبقى أخطاء Rust ظاهرة
    clearScreen: false,
    server: { port: 1420, strictPort: true, fs: { allow: [repo] } },
    build: {
      target: ["es2022", "safari16"],
      outDir: "dist",
      rollupOptions: {
        onwarn(w, warn) {
          // توجيه "use client" في ملفات الويب لا معنى له خارج Next
          if (w.code === "MODULE_LEVEL_DIRECTIVE") return;
          warn(w);
        },
      },
    },
  };
});

/**
 * بديل `@/lib/session-store` في تطبيق الحاسوب (يُربط باسمه في vite.config.ts وtsconfig).
 * الويب يحفظ رمز التجديد في Cookie `HttpOnly` يضعه الخادم (`/api/auth/remember`) ويستأنف منه
 * (`/api/auth/resume`). أصل التطبيق المحلي لا يحمل Cookies الخادم، فالرمز هنا في مخزن مفاتيح النظام
 * والاستئناف بـ`/api/auth/refresh` نفسه الذي يستعمله الجوال (0005 §٢٠٧). خارج Tauri: سلوك الويب كما هو.
 */
import { apiBaseUrl } from "@/lib/api";

import * as web from "../../../web/src/lib/session-store";
import { readClaims } from "./claims";
import { inTauri, secrets } from "./tauri";

export * from "../../../web/src/lib/session-store";

export async function rememberRefresh(refresh: string): Promise<void> {
  if (!inTauri) return web.rememberRefresh(refresh);
  try {
    await secrets.set("refresh", refresh);
  } catch {
    /* المخزن غير متاح: تبقى الجلسة في الذاكرة كما في الويب حين يفشل الحفظ */
  }
}

let inflight: Promise<web.Resumed | null> | null = null;

export function resumeSession(): Promise<web.Resumed | null> {
  if (!inTauri) return web.resumeSession();
  inflight ??= (async () => {
    try {
      const refresh = await secrets.get("refresh");
      if (!refresh) return null;
      const r = await fetch(`${apiBaseUrl()}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh }),
      });
      if (r.status === 401) {
        // مُلغى أو مسحوب أو مستعمل: لا يُعاد تجريبه
        await secrets.delete("refresh");
        return null;
      }
      if (!r.ok) return null;
      const t = (await r.json()) as { access: string; refresh: string; session_id: string };
      await secrets.set("refresh", t.refresh);
      const c = readClaims(t.access);
      if (!c.user_id) return null;
      return { ...t, user_id: c.user_id, tenant_id: c.tid ?? null };
    } catch {
      // بلا شبكة: الرمز يبقى للمحاولة التالية
      return null;
    } finally {
      setTimeout(() => {
        inflight = null;
      }, 0);
    }
  })();
  return inflight;
}

export async function forgetSession(): Promise<void> {
  if (!inTauri) return web.forgetSession();
  await web.clearContext();
  try {
    await secrets.delete("refresh");
  } catch {
    /* لا شيء محفوظ */
  }
}

"use client";

/**
 * جلسة المشغّل (PLT-01): حساب من نوع آخر، إطار منفصل عن تطبيق المتاجر. الرمز في الذاكرة، والاستئناف
 * بعد إعادة التحميل أو الرابط المباشر من Cookie `HttpOnly` بسقف ثماني ساعات من الدخول (0005 §١٦٨ —
 * كان كل تحديث يعيد إلى الدخول، فحص 2026-10-17 VP01). كل دخول واستئناف وخروج يُسجَّل في الخادم.
 */
import { createApiClient } from "@sting/app-core";
import type { ContractsClient } from "@sting/contracts";

import { apiBaseUrl } from "@/lib/api";

let token: string | null = null;
let name = "";
// 0005 §١١٨ — «الدعم» يقرأ ولا يغيّر؛ الخادم يفرض والواجهة تُعلن
// غياب الدور في الاستجابة (خادم أقدم) يُعرض «مديراً» — الوسم للإعلان فقط والفرض على الخادم
let role: "admin" | "support" = "admin";
// 0005 §١٣٨ — كلمة مرور وضعها مشغّل آخر: لا شاشة قبل تغييرها (الخادم يفرض بـ403 أيضاً)
let mustChange = false;
let client: ContractsClient | null = null;

export function setOperatorSession(
  access: string,
  displayName: string,
  operatorRole: "admin" | "support" = "admin",
  mustChangePassword = false,
): void {
  token = access;
  name = displayName;
  role = operatorRole;
  mustChange = mustChangePassword;
}

export function clearOperatorSession(): void {
  token = null;
  name = "";
  role = "admin";
  mustChange = false;
}

export function operatorMustChangePassword(): boolean {
  return mustChange;
}

export function markOperatorPasswordChanged(): void {
  mustChange = false;
}

export function operatorRole(): "admin" | "support" {
  return role;
}

export function operatorToken(): string | null {
  return token;
}

export function operatorName(): string {
  return name;
}

let onExpired: ((next: string) => void) | null = null;

/** ما يحدث حين تنتهي جلسة المشغّل فعلاً (فشل الاستئناف): يضعه حاجز المساحة بموجّه Next. */
export function setOperatorExpiredHandler(handler: ((next: string) => void) | null): void {
  onExpired = handler;
}

/**
 * 0005 §٢٦٣ — رمز وصول المشغّل يعيش 15 دقيقة في الذاكرة، والعميل كان يُنشأ من `@sting/contracts`
 * مباشرة بلا تجديد، فكل طلب بعد ربع ساعة على الشاشة (حفظ إعلان كُتب على مهل) يُرفض 401
 * `token_not_valid`. الآن العميل نفسه الذي يستعمله المتجر (§١٢١): عند 401 يُستأنف من الـCookie مرة
 * ويُعاد الطلب نفسه، وفشل الاستئناف وحده (سقف الثماني ساعات أو جلسة مُبطَلة) يمسح الجلسة ويقود إلى
 * الدخول بوجهة العودة.
 */
export function platformApi(): ContractsClient {
  client ??= createApiClient({
    baseUrl: apiBaseUrl(),
    getAccessToken: () => token,
    resume: async () => ((await resumeOperator()) && token ? { access: token } : null),
    onUnauthorized: () => expireOperator(),
  });
  return client;
}

/** انتهت الجلسة فعلاً (فشل الاستئناف بعد 401): تُمسح ويقود الحاجز إلى الدخول بوجهة العودة. */
function expireOperator(): void {
  clearOperatorSession();
  if (typeof window === "undefined") return;
  const here = `${location.pathname}${location.search}`;
  if (!here.startsWith("/platform") || here.startsWith("/platform/login")) return;
  onExpired?.(here);
}

/**
 * 0005 §٢٧١ — للطلبات خارج `platformApi()` (XMLHttpRequest لتقدّم الرفع): بعد 401 يُستأنف من الـCookie
 * مرة ويعيد رمز الوصول الجديد لإعادة الطلب نفسه؛ `null` = الجلسة انتهت فعلاً (مُسحت، والحاجز يقود إلى
 * الدخول).
 */
export async function renewOperatorAfter401(): Promise<string | null> {
  if ((await resumeOperator()) && token) return token;
  expireOperator();
  return null;
}

/**
 * 0005 §٢٧١ — `fetch` لمسار مشغّل خارج العقد المكتوب (معاملات لا يصفها OpenAPI): الرمز الحالي، وعند
 * 401 استئناف مرة وإعادة الطلب نفسه — السلوك نفسه الذي يعطيه `platformApi()`.
 */
export async function operatorFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const send = (access: string | null) => {
    const headers = new Headers(init.headers);
    if (access) headers.set("Authorization", `Bearer ${access}`);
    return fetch(`${apiBaseUrl()}${path}`, { ...init, headers });
  };
  const first = await send(token);
  if (first.status !== 401 || !token) return first;
  const fresh = await renewOperatorAfter401();
  if (!fresh) return first;
  const retried = await send(fresh);
  if (retried.status === 401) expireOperator();
  return retried;
}

let resumeInflight: Promise<boolean> | null = null;

/** يستأنف من الـCookie مرة (طلب واحد مهما تعدّد): يضع الجلسة ويعيد `true`، أو `false` بلا جلسة. */
export function resumeOperator(): Promise<boolean> {
  resumeInflight ??= (async () => {
    try {
      const r = await fetch(`${apiBaseUrl()}/api/platform/resume`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!r.ok) return false;
      const b = (await r.json()) as {
        access: string;
        display_name: string;
        role?: "admin" | "support";
        must_change_password?: boolean;
      };
      setOperatorSession(b.access, b.display_name, b.role ?? "admin", b.must_change_password);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => {
        resumeInflight = null;
      }, 0);
    }
  })();
  return resumeInflight;
}

/** خروج حقيقي: الخادم يُلغي الجلسة ويمسح الـCookie، ثم تُمسح الذاكرة. */
export async function logoutOperator(): Promise<void> {
  try {
    await fetch(`${apiBaseUrl()}/api/platform/logout`, {
      method: "POST",
      credentials: "same-origin",
    });
  } catch {
    /* بلا اتصال: الجلسة تنتهي بسقفها في الخادم */
  }
  clearOperatorSession();
}

/** وجهة آمنة بعد الدخول: مسار داخل مساحة المشغّل فقط. */
export function safePlatformNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/platform") || raw.startsWith("/platform/login")) return "/platform";
  return raw;
}

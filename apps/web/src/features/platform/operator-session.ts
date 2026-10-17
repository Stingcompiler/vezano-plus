"use client";

/**
 * جلسة المشغّل (PLT-01): حساب من نوع آخر، إطار منفصل عن تطبيق المتاجر. الرمز في الذاكرة، والاستئناف
 * بعد إعادة التحميل أو الرابط المباشر من Cookie `HttpOnly` بسقف ثماني ساعات من الدخول (0005 §١٦٨ —
 * كان كل تحديث يعيد إلى الدخول، فحص 2026-10-17 VP01). كل دخول واستئناف وخروج يُسجَّل في الخادم.
 */
import { type ContractsClient, createContractsClient } from "@sting/contracts";

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

export function platformApi(): ContractsClient {
  if (!client)
    client = createContractsClient({ baseUrl: apiBaseUrl(), getAccessToken: () => token });
  return client;
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

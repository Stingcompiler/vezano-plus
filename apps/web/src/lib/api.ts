"use client";

/**
 * عميل الخادم المكتوب الأنواع (@sting/contracts) — لبيانات الخادم فقط (§٤.٥).
 * العنوان من NEXT_PUBLIC_API_URL؛ الافتراضي خادم التطوير المحلي.
 * 401 على مسار مُصادَق = جلسة منتهية أو مُبطَلة → ACC-08 (لا يمنع الحفظ المحلي).
 * المنطق (الاستئناف الصامت وإعادة الطلب) في `@sting/app-core` المشترك مع الجوال؛ هنا ما يخصّ الويب.
 */
import { createApiClient } from "@sting/app-core";
import type { ContractsClient } from "@sting/contracts";

let client: ContractsClient | null = null;
let accessToken: string | null = null;
let onUnauthorized: ((path: string) => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** للرفع بتقدّم (XMLHttpRequest) حيث لا يعطي fetch نسبةً — CAT-02 «رفع الصورة 60%». */
let deviceRefresh: string | null = null;

/** رمز تجديد الجهاز — للاعتماد المقيّد وحده (SYS-07: تسليم عمل جهاز مسحوب إلى الحجر). */
export function setDeviceRefresh(token: string | null): void {
  deviceRefresh = token;
}

export function getDeviceRefresh(): string | null {
  return deviceRefresh;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

export function setUnauthorizedHandler(handler: ((path: string) => void) | null): void {
  onUnauthorized = handler;
}

/**
 * 0005 §١٢١ — الاستئناف الصامت: رمز الوصول يعيش 15 دقيقة ولم يكن يُجدَّد، فكانت الجلسة تسقط إلى
 * ACC-08 أثناء العمل. عند 401 على مسار مُصادَق: يُستأنف من الـCookie مرة (طلب واحد مهما تعدّد)،
 * ويُعاد الطلب نفسه بالرمز الجديد؛ فشل الاستئناف وحده يقود إلى ACC-08.
 */
type Resumer = () => Promise<{ access: string } | null>;
let resumer: Resumer | null = null;

export function setResumer(fn: Resumer | null): void {
  resumer = fn;
}

export function api(): ContractsClient {
  client ??= createApiClient({
    baseUrl: apiBaseUrl(),
    getAccessToken: () => accessToken,
    resume: () => (resumer ? resumer() : Promise.resolve(null)),
    onUnauthorized: (path) => onUnauthorized?.(path),
  });
  return client;
}

/**
 * 0005 §٢٧٢ — للرفع بـXMLHttpRequest (تقدّم): بعد 401 يُستأنف مرة ويُعاد رمز الوصول الجديد لإعادة
 * الطلب نفسه؛ `null` = الجلسة انتهت فعلاً (يُستدعى معالج ACC-08).
 */
export async function renewAccessAfter401(path: string): Promise<string | null> {
  const fresh = resumer ? await resumer() : null;
  if (fresh) return fresh.access;
  onUnauthorized?.(path);
  return null;
}

/**
 * 0005 §٢٧٢ — `fetch` لمسار مُصادَق خارج العقد المكتوب (تصدير CSV، ملف، معامل لا يصفه OpenAPI): الرمز
 * الحالي، وعند 401 استئناف مرة وإعادة الطلب نفسه — السلوك الذي يعطيه `api()`. كانت هذه الطلبات ترسل
 * رمزاً انتهى عمره (15 دقيقة) فيفشل التصدير بصمت.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const send = (access: string | null) => {
    const headers = new Headers(init.headers);
    if (access) headers.set("Authorization", `Bearer ${access}`);
    return fetch(`${apiBaseUrl()}${path}`, { ...init, headers });
  };
  const first = await send(accessToken);
  if (first.status !== 401 || !accessToken) return first;
  const fresh = await renewAccessAfter401(path);
  if (!fresh) return first;
  const retried = await send(fresh);
  if (retried.status === 401) onUnauthorized?.(path);
  return retried;
}

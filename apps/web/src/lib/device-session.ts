"use client";

/**
 * جلسة الجهاز بعد كل دخول أو استئناف (مراجعة 2026-10-19 B2).
 *
 * الرفع والسحب وحالة المزامنة تطلب جلسة جهاز (`device_session_required` — §٩.١)، ورموزها في الذاكرة
 * وحدها. كان التجهيز (ACC-05) وحده يضعها، فبعد أي دخول جديد أو إعادة تحميل أو استئناف صامت يعود
 * الرمز رمز مستخدم: الرفع يردّ 403 والواجهة تقول «ينتظر الاتصال» إلى الأبد. المخرج قائم في الخادم
 * (`/api/devices/renew` باعتماد التسجيل المحفوظ محلياً) ولم يكن يُستدعى إلا من التجهيز.
 *
 * هنا يُجدَّد تلقائياً: عند كل جلسة مستخدم جديدة على جهاز مسجَّل، وعند 403 من الرفع أو الحالة.
 */
import type { DeviceTokens } from "@/lib/app-context";
import { apiBaseUrl, setAccessToken } from "@/lib/api";
import { getStorage } from "@/lib/storage";

/** اعتماد تسجيل الجهاز — يكتبه ACC-05 (`use-bootstrap.ts`). */
export const DEVICE_META = "device.registration";

interface StoredDevice {
  readonly deviceId: string;
  readonly registrationSecret: string;
}

type Adopter = (d: DeviceTokens) => void;
let adopter: Adopter | null = null;

/** يسجّله سياق الواجهة: رموز الجهاز المجدَّدة تصل إلى `app.device` (مؤشّر الجهاز والقفل). */
export function setDeviceAdopter(fn: Adopter | null): void {
  adopter = fn;
}

export async function hasDeviceRegistration(): Promise<boolean> {
  return (await readStored()) !== null;
}

async function readStored(): Promise<StoredDevice | null> {
  try {
    const raw = await getStorage().read((tx) => tx.getMeta(DEVICE_META));
    const v = raw ? (JSON.parse(raw) as Partial<StoredDevice>) : null;
    return v?.deviceId && v.registrationSecret
      ? { deviceId: v.deviceId, registrationSecret: v.registrationSecret }
      : null;
  } catch {
    return null;
  }
}

/** رمز وصول جلسة المستخدم الحالية — التجديد لها وحدها (يضعه `BackgroundSync`). */
let sessionAccess: string | null = null;

export function setSessionAccess(access: string | null): void {
  sessionAccess = access;
}

interface Renewed {
  readonly device_id: string;
  readonly prefix: string;
  readonly branch_id: string;
  readonly access: string;
  readonly refresh: string;
}

let inflight: { readonly for: string; readonly p: Promise<DeviceTokens | null> } | null = null;

/**
 * يحوّل جلسة المستخدم الحالية إلى جلسة جهاز لهذا الجهاز المسجَّل — طلب واحد لكل جلسة مهما تعدّد
 * الطالبون. بلا تسجيل محلي أو برفض الخادم (جهاز مسحوب، منشأة أخرى): `null` ولا يتغيّر شيء.
 *
 * مربوط بالجلسة التي طلبته: على جهاز مشترك قد يدخل مستخدم آخر والطلب جارٍ — نتيجة الأول لا تُطبَّق
 * على جلسة الثاني (كانت تستبدل رمز المالك برمز جهاز الكاشير فيُرفض في إدارة المستخدمين). ولذلك
 * يُرسل الطلب بـ`fetch` مباشرة برمز تلك الجلسة: عميل العقد يضع الرمز العام الحالي دائماً.
 */
export function renewDeviceSession(): Promise<DeviceTokens | null> {
  const forAccess = sessionAccess;
  if (!forAccess) return Promise.resolve(null);
  if (inflight?.for === forAccess) return inflight.p;
  const p = (async (): Promise<DeviceTokens | null> => {
    try {
      const stored = await readStored();
      if (!stored) return null;
      const r = await fetch(`${apiBaseUrl()}/api/devices/renew`, {
        method: "POST",
        credentials: "same-origin",
        headers: { Authorization: `Bearer ${forAccess}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: stored.deviceId,
          registration_secret: stored.registrationSecret,
        }),
      });
      if (!r.ok) return null;
      const data = (await r.json()) as Renewed;
      // الجلسة تغيّرت أثناء الطلب — لا تُطبَّق على غير صاحبها
      if (sessionAccess !== forAccess) return null;
      const d: DeviceTokens = {
        deviceId: data.device_id,
        prefix: data.prefix,
        branchId: data.branch_id,
        access: data.access,
        refresh: data.refresh,
      };
      setAccessToken(d.access);
      adopter?.(d);
      return d;
    } catch {
      return null;
    } finally {
      setTimeout(() => {
        if (inflight?.for === forAccess) inflight = null;
      }, 0);
    }
  })();
  inflight = { for: forAccess, p };
  return p;
}

// 403 «جلسة جهاز مطلوبة» — القاعدة في المحرّك المشترك
export { needsDeviceSession } from "@sting/app-core";

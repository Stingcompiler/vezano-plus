"use client";

/**
 * هل هذا الجهاز مهيّأ (ACC-05 سجّله ونزّل نسخته)؟ يقرّر ACC-01/ACC-02 قبل الرسم:
 * «وجود تهيئة محلية يغيّر الشاشة لا نصّها» (34-D26). المفتاح يكتبه ACC-05 (T1.3).
 * لكل منشأة مهيّأة على الجهاز إدخال في `device.setup.tenants` (ACC-03 offline: «المنشآت التي هُيّئت
 * على هذا الجهاز وحدها قابلة للفتح»).
 */
import { readVerifiers } from "@sting/sync-core";

import { getStorage, readTenantMeta, tenantsWithStorage } from "@/lib/storage";

export const DEVICE_SETUP_KEY = "device.setup";
export const DEVICE_SETUP_TENANTS_KEY = "device.setup.tenants";

export async function hasLocalSetup(): Promise<boolean> {
  try {
    const value = await getStorage().read((tx) => tx.getMeta(DEVICE_SETUP_KEY));
    return value === "done";
  } catch {
    return false;
  }
}

/**
 * هل لهذا المستخدم متحقق PIN منزَّل على هذا الجهاز؟ القفل بلا متحققه لا يُفتح — فلا يُرسَل إليه
 * (مراجعة 2026-10-19 B1: إعادة التحميل وقفل الخمول كانا يقودان من لا رمز له إلى قفل مسدود ثم الدخول).
 */
export async function hasPinFor(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  try {
    const v = await readVerifiers(getStorage());
    return Boolean(v?.verifiers.some((x) => x.user_id === userId));
  } catch {
    return false;
  }
}

/**
 * المنشآت المهيّأة على هذا الجهاز. لكل منشأة قاعدتها (مراجعة 2026-11-10 ع-٤)، فالقائمة اتحاد ما
 * في القاعدة النشطة وما في قواعد المنشآت الأخرى على الجهاز.
 */
export async function localSetupTenants(): Promise<readonly string[]> {
  const parse = (raw: string | null): string[] => {
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  };
  const found = new Set<string>();
  try {
    const raw = await getStorage().read((tx) => tx.getMeta(DEVICE_SETUP_TENANTS_KEY));
    for (const t of parse(raw)) found.add(t);
  } catch {
    /* لا قاعدة نشطة مقروءة */
  }
  for (const tenantId of tenantsWithStorage()) {
    if (found.has(tenantId)) continue;
    try {
      const listed = parse(await readTenantMeta(tenantId, DEVICE_SETUP_TENANTS_KEY));
      if (listed.includes(tenantId)) found.add(tenantId);
    } catch {
      /* قاعدة منشأة أخرى غير مقروءة: ليست قابلة للفتح دون اتصال */
    }
  }
  return [...found];
}

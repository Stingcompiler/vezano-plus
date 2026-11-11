"use client";

/**
 * تخزين الجهاز: Dexie عبر عقد @sting/platform — **قاعدة لكل منشأة** على الجهاز (مراجعة 2026-11-10
 * ع-٤؛ منطق التسمية في `@sting/app-core` `tenant-storage`). أول منشأة تأخذ الاسم القديم
 * `sting-bootstrap`، وكل منشأة بعدها `sting-<معرّفها>`؛ المنشأة النشطة في التخزين المحلي للمتصفح.
 */
import {
  activateTenantDatabase,
  activeDatabase,
  databaseOf,
  type KeyValueStore,
  LEGACY_DATABASE,
  legacyInspected,
  recordLegacyOwner,
  releaseDatabase,
  tenantsWithDatabase,
} from "@sting/app-core";
import { DexieStorage, type StoragePort } from "@sting/platform/dexie";
import { BOOTSTRAP_KEY, DEVICE_SETUP_TENANTS_KEY } from "@sting/sync-core";

let instance: DexieStorage | null = null;
let currentName: string | null = null;

/** التخزين المحلي للمتصفح بعقد `KeyValueStore`؛ `null` إن مُنع (تصفّح خاص) — قاعدة واحدة كما كان. */
function keys(): KeyValueStore | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const ls = localStorage;
    return {
      getItem: (k) => ls.getItem(k),
      setItem: (k, v) => ls.setItem(k, v),
      removeItem: (k) => ls.removeItem(k),
      keys: () => Array.from({ length: ls.length }, (_, i) => ls.key(i) ?? ""),
    };
  } catch {
    return null;
  }
}

export function getStorage(databaseName?: string): StoragePort {
  if (typeof indexedDB === "undefined")
    throw new Error("IndexedDB غير متاح — التخزين المحلي مطلوب لوضع البيع (§١٣.١)");
  const name = databaseName ?? currentName ?? activeDatabase(keys());
  if (instance && name !== currentName) {
    instance = null;
  }
  currentName = name;
  instance ??= new DexieStorage({ databaseName: name });
  return instance;
}

/** صاحب القاعدة القديمة من بياناتها: آخر منشأة جُهّز لها الجهاز. */
async function readLegacyOwner(): Promise<string> {
  const legacy = new DexieStorage({ databaseName: LEGACY_DATABASE });
  try {
    const { progress, tenants } = await legacy.read(async (tx) => ({
      progress: await tx.getMeta(BOOTSTRAP_KEY),
      tenants: await tx.getMeta(DEVICE_SETUP_TENANTS_KEY),
    }));
    const fromProgress: unknown = progress
      ? (JSON.parse(progress) as { tenantId?: unknown }).tenantId
      : undefined;
    if (typeof fromProgress === "string" && fromProgress) return fromProgress;
    const list: unknown = tenants ? JSON.parse(tenants) : [];
    const last: unknown = Array.isArray(list) ? list[list.length - 1] : undefined;
    return typeof last === "string" ? last : "";
  } catch {
    return "";
  } finally {
    await legacy.close();
  }
}

let inspecting: Promise<void> | null = null;

/** مرة لكل متصفح: جهاز مجهَّز قبل هذا الإصلاح تبقى قاعدته القديمة لمنشأته. */
function inspectLegacy(store: KeyValueStore): Promise<void> {
  inspecting ??= (async () => {
    if (!legacyInspected(store)) recordLegacyOwner(store, await readLegacyOwner());
  })();
  return inspecting;
}

/**
 * يجعل قاعدة هذه المنشأة هي النشطة — يُنادى حين تُعرف منشأة الجلسة (دخول، اختيار منشأة، إنشاء
 * منشأة) **قبل** وضعها في السياق، فلا تُركَّب شاشة على قاعدة منشأة أخرى.
 */
export async function openTenantStorage(tenantId: string): Promise<void> {
  const store = keys();
  if (!store) return;
  await inspectLegacy(store);
  const name = activateTenantDatabase(store, tenantId);
  if (name !== currentName) {
    instance = null;
    currentName = name;
  }
}

/** المنشآت التي لها قاعدة على هذا الجهاز (ACC-03 دون اتصال: «ما هُيّئ هنا وحده قابل للفتح»). */
export function tenantsWithStorage(): readonly string[] {
  return tenantsWithDatabase(keys());
}

/** قراءة من قاعدة منشأة بعينها دون جعلها النشطة — `null` إن لم تكن لها قاعدة هنا. */
export async function readTenantMeta(tenantId: string, key: string): Promise<string | null> {
  const name = databaseOf(keys(), tenantId);
  if (!name) return null;
  if (name === currentName) return getStorage().read((tx) => tx.getMeta(key));
  const other = new DexieStorage({ databaseName: name });
  try {
    return await other.read((tx) => tx.getMeta(key));
  } finally {
    await other.close();
  }
}

/**
 * يمحو قاعدة المنشأة النشطة من الجهاز: المحو عن بُعد (SYS-07)، وتبديل الحساب حين لا معلّق فيها
 * (28-D21 ACC-03؛ معيار §١٨ ACC-138: «قوائم الأسعار والسلال والكتالوج المخزَّن كلها تُمحى من الجهاز
 * قبل تحميل الحساب الجديد»). اسمها يعود حرّاً لمن يُجهَّز بعدها.
 */
export async function wipeLocalStorage(): Promise<void> {
  const s = getStorage();
  const name = currentName;
  await (s as DexieStorage).deleteDatabase();
  instance = null;
  const store = keys();
  if (store && name) releaseDatabase(store, name);
}

import {
  activateTenantDatabase,
  activeDatabase,
  type KeyValueStore,
  LEGACY_DATABASE,
  legacyInspected,
  recordLegacyOwner,
} from "@sting/app-core";
import type { StoragePort } from "@sting/platform";
import { type SqliteDriver, SqliteStorage } from "@sting/platform/sqlite";
import { BOOTSTRAP_KEY, DEVICE_SETUP_TENANTS_KEY } from "@sting/sync-core";
import * as SQLite from "expo-sqlite";

import { secrets } from "@/lib/secrets";

/**
 * التخزين المحلي على الهاتف (0005 §١٧٣): محوّل SQLite من `@sting/platform` فوق expo-sqlite — يمرّ
 * بعقد التخزين نفسه الذي يمرّ به Dexie على الويب. اتصال مخصَّص للمحوّل (يدير BEGIN/COMMIT بنفسه).
 *
 * **ملف لكل منشأة** (مراجعة 2026-11-10 ع-٤؛ منطق التسمية في `@sting/app-core` `tenant-storage`): كان
 * ملفاً واحداً لكل ما يُفتح على الهاتف، والتجهيز لمنشأة ثانية يكتب فوقه بلا تفريغ — فيختلط دفتر
 * الأولى ومعلّقها بالثانية. أول منشأة تبقى على الملف القديم، وكل منشأة بعدها ملفها. فهرس المنشآت
 * (غير سرّي) في مخزن النظام لأنه المخزن الوحيد المتاح قبل فتح أي قاعدة.
 *
 * الاختبار يحقن تخزيناً ذاكرياً بـ`setStorageForTests`.
 */
const LEGACY_FILE = "vezano-plus.db";
const INDEX_KEY = "storage.tenant-index";

const fileFor = (database: string): string =>
  database === LEGACY_DATABASE ? LEGACY_FILE : `vezano-plus-${database.slice("sting-".length)}.db`;

interface Index extends KeyValueStore {
  persist(): Promise<void>;
}

let indexLoading: Promise<Index> | null = null;

function index(): Promise<Index> {
  indexLoading ??= (async () => {
    let entries: [string, string][] = [];
    try {
      const raw = await secrets().get(INDEX_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === "object")
        entries = Object.entries(parsed).filter(
          (e): e is [string, string] => typeof e[1] === "string",
        );
    } catch {
      /* فهرس غير مقروء: يُعاد بناؤه — المنشأة الأولى على الملف القديم */
    }
    const map = new Map(entries);
    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
      keys: () => [...map.keys()],
      persist: () => secrets().set(INDEX_KEY, JSON.stringify(Object.fromEntries(map))),
    };
  })();
  return indexLoading;
}

async function openFile(file: string): Promise<StoragePort> {
  const db = await SQLite.openDatabaseAsync(file, { useNewConnection: true });
  const driver: SqliteDriver = {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params) => {
      await db.runAsync(sql, [...params]);
    },
    all: (sql, params) => db.getAllAsync(sql, [...params]),
    get: (sql, params) => db.getFirstAsync(sql, [...params]),
  };
  return SqliteStorage.open(driver);
}

let opening: Promise<StoragePort> | null = null;
let injected: StoragePort | null = null;

export function getStorage(): Promise<StoragePort> {
  if (injected) return Promise.resolve(injected);
  opening ??= (async () => openFile(fileFor(activeDatabase(await index()))))();
  return opening;
}

/** صاحب الملف القديم من بياناته: آخر منشأة جُهّز لها الهاتف. */
async function readLegacyOwner(storage: StoragePort): Promise<string> {
  try {
    const { progress, tenants } = await storage.read(async (tx) => ({
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
  }
}

/**
 * يجعل ملف هذه المنشأة هو النشط — يُنادى حين تُعرف منشأة الجلسة (دخول، اختيار منشأة، إنشاء منشأة)
 * قبل وضعها في حالة الجلسة. `getStorage()` بعده يفتح ملفها.
 */
export async function openTenantStorage(tenantId: string): Promise<void> {
  if (injected) return;
  const store = await index();
  if (!legacyInspected(store)) {
    // قبل أول تفعيل: الملف النشط هو القديم نفسه
    recordLegacyOwner(store, await readLegacyOwner(await getStorage()));
  }
  const before = activeDatabase(store);
  const name = activateTenantDatabase(store, tenantId);
  await store.persist();
  if (name !== before) opening = null;
}

export function setStorageForTests(storage: StoragePort | null): void {
  injected = storage;
  opening = null;
  indexLoading = null;
}

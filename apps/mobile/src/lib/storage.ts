import type { StoragePort } from "@sting/platform";
import { type SqliteDriver, SqliteStorage } from "@sting/platform/sqlite";
import * as SQLite from "expo-sqlite";

/**
 * التخزين المحلي على الهاتف (0005 §١٧٣): محوّل SQLite من `@sting/platform` فوق expo-sqlite — يمرّ
 * بعقد التخزين نفسه الذي يمرّ به Dexie على الويب. اتصال مخصَّص للمحوّل (يدير BEGIN/COMMIT بنفسه).
 * الاختبار يحقن تخزيناً ذاكرياً بـ`setStorageForTests`.
 */
let opening: Promise<StoragePort> | null = null;

export function getStorage(): Promise<StoragePort> {
  opening ??= (async () => {
    const db = await SQLite.openDatabaseAsync("vezano-plus.db", { useNewConnection: true });
    const driver: SqliteDriver = {
      exec: (sql) => db.execAsync(sql),
      run: async (sql, params) => {
        await db.runAsync(sql, [...params]);
      },
      all: (sql, params) => db.getAllAsync(sql, [...params]),
      get: (sql, params) => db.getFirstAsync(sql, [...params]),
    };
    return SqliteStorage.open(driver);
  })();
  return opening;
}

export function setStorageForTests(storage: StoragePort | null): void {
  opening = storage ? Promise.resolve(storage) : null;
}

import type { SecretsPort, StoragePort } from "@sting/platform";
import { MemoryStorage } from "@sting/platform/memory";
import { SqliteStorage } from "@sting/platform/sqlite";
import { BOOTSTRAP_KEY, DEVICE_SETUP_KEY } from "@sting/sync-core";
import * as SQLite from "expo-sqlite";

import { setSecretsForTests } from "@/lib/secrets";
import { getStorage, openTenantStorage, setStorageForTests } from "@/lib/storage";

/**
 * مراجعة 2026-11-10 (ع-٤) على الهاتف: ملف SQLite لكل منشأة. كان ملفاً واحداً، والتجهيز لمنشأة
 * ثانية يكتب فوقه بلا تفريغ فيختلط دفتر الأولى ومعلّقها بالثانية.
 */
const A = "01990000-0000-7000-8000-00000000000a";
const B = "01990000-0000-7000-8000-00000000000b";

function memorySecrets(): SecretsPort {
  const m = new Map<string, string>();
  return {
    get: (k) => Promise.resolve(m.get(k) ?? null),
    set: (k, v) => {
      m.set(k, v);
      return Promise.resolve();
    },
    delete: (k) => {
      m.delete(k);
      return Promise.resolve();
    },
  };
}

/** كل ملف قاعدة = تخزين ذاكري مستقل يبقى بين الفتحات، كما يبقى الملف على الهاتف. */
function fakeFiles() {
  const files = new Map<string, StoragePort>();
  const opened: string[] = [];
  jest.mocked(SQLite.openDatabaseAsync).mockImplementation((name: string) => {
    opened.push(name);
    return Promise.resolve({ name } as unknown as SQLite.SQLiteDatabase);
  });
  jest.spyOn(SqliteStorage, "open").mockImplementation(() => {
    const name = opened[opened.length - 1];
    if (!files.has(name)) files.set(name, new MemoryStorage());
    return Promise.resolve(files.get(name) as unknown as SqliteStorage);
  });
  return { files, opened };
}

const putMeta = async (key: string, value: string) =>
  (await getStorage()).transaction((tx) => tx.putMeta(key, value));
const getMeta = async (key: string) => (await getStorage()).read((tx) => tx.getMeta(key));

/** إعادة تشغيل التطبيق: الذاكرة تُفرَّغ، والملفات ومخزن النظام يبقيان. */
const restart = () => setStorageForTests(null);

beforeEach(() => {
  setStorageForTests(null);
  setSecretsForTests(memorySecrets());
});
afterAll(() => {
  setSecretsForTests(null);
  jest.restoreAllMocks();
});

it("هاتف جديد: المنشأة الأولى على الملف القديم، والثانية ملفها، والعودة تفتح ملف الأولى بما فيه", async () => {
  const { opened } = fakeFiles();
  await openTenantStorage(A);
  await putMeta(DEVICE_SETUP_KEY, "done");
  await putMeta("ledger", "دفتر أ");

  await openTenantStorage(B);
  expect(await getMeta(DEVICE_SETUP_KEY)).toBeNull(); // الثانية غير مجهَّزة على هذا الهاتف
  expect(await getMeta("ledger")).toBeNull();
  await putMeta("ledger", "دفتر ب");

  await openTenantStorage(A);
  expect(await getMeta("ledger")).toBe("دفتر أ");
  expect(await getMeta(DEVICE_SETUP_KEY)).toBe("done");
  expect([...new Set(opened)]).toEqual(["vezano-plus.db", `vezano-plus-${B}.db`]);
});

it("هاتف مجهَّز قبل الإصلاح: الملف القديم لمنشأته، ومنشأة أخرى لا تفتحه", async () => {
  fakeFiles();
  // قبل الإصلاح: ملف واحد جُهّز لمنشأة أ وفيه دفترها
  await putMeta(BOOTSTRAP_KEY, JSON.stringify({ tenantId: A }));
  await putMeta("ledger", "دفتر أ");
  restart();

  await openTenantStorage(B);
  expect(await getMeta("ledger")).toBeNull();
  restart();
  // إعادة التشغيل تفتح ملف آخر منشأة فُتحت
  expect(await getMeta("ledger")).toBeNull();
  await openTenantStorage(A);
  expect(await getMeta("ledger")).toBe("دفتر أ");
});

it("المنشأة نفسها من جديد لا تبدّل الملف ولا تفتحه ثانية", async () => {
  const { opened } = fakeFiles();
  await openTenantStorage(A);
  const first = await getStorage();
  await openTenantStorage(A);
  expect(await getStorage()).toBe(first);
  expect(opened).toEqual(["vezano-plus.db"]);
});

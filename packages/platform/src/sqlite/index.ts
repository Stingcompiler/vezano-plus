/**
 * محوّل SQLite لعقد التخزين (§٤.٦ بند ٤، §٨.١٣) — تنفيذ الهاتف (expo-sqlite) وسطح المكتب لاحقاً.
 *
 * - لا تبعية على expo هنا: المحوّل يتكلم مع «مشغّل» صغير غير متزامن (`SqliteDriver`) يحقنه التطبيق،
 *   وكل SQL يعيش في هذا الملف وحده.
 * - الذرّية: المحوّل نفسه يصدر `BEGIN IMMEDIATE` ثم `COMMIT`، و`ROLLBACK` عند أي استثناء —
 *   المشغّل لا يدير المعاملات ولا يحتاج واجهة لها.
 * - كاتب واحد (§٨.٢): كل وصول (كتابة وقراءة) يمر بطابور وعود داخلي واحد، لأن الاتصال واحد
 *   والقراءة المتداخلة مع معاملة مفتوحة على نفس الاتصال سترى كتابات غير ملتزمة.
 *   `read()` تُنفَّذ داخل `BEGIN` مؤجَّلة تنتهي دائماً بـ `ROLLBACK`: ترى الحالة الملتزمة فقط
 *   بلقطة متسقة، وأي كتابة عرضية فيها تُهمَل (كما ينسخ المحوّل الذاكري الحالة للقراءة).
 * - الحمولات تُخزَّن JSON حرفياً؛ الأرقام الكبيرة سلاسل قانونية أصلاً في العقد ولا تمر عبر Number
 *   (§٦.١، ACC-97). مقارنة المؤشرات بـ BigInt في JS لا في SQL (SQLite لا يقارن سلاسل رقمية كأعداد).
 * - الهجرات المحلية إضافية فقط (§١٣.٢): `CREATE ... IF NOT EXISTS` آمنة للتكرار عند كل فتح.
 *
 * ربط expo-sqlite في تطبيق الهاتف (لا يعيش هنا كي لا تعتمد الحزمة على expo):
 *
 * ```ts
 * import * as SQLite from "expo-sqlite";
 * import { SqliteStorage, type SqliteDriver } from "@sting/platform/sqlite";
 *
 * // اتصال مخصَّص للمحوّل — لا يشاركه كود آخر، لأن المحوّل يدير BEGIN/COMMIT عليه بنفسه.
 * const db = await SQLite.openDatabaseAsync(`sting-${installationId}.db`, { useNewConnection: true });
 * const driver: SqliteDriver = {
 *   exec: (sql) => db.execAsync(sql),
 *   run: async (sql, params) => { await db.runAsync(sql, [...params]); },
 *   all: (sql, params) => db.getAllAsync(sql, [...params]),
 *   get: (sql, params) => db.getFirstAsync(sql, [...params]),
 * };
 * const storage = await SqliteStorage.open(driver);
 * ```
 *
 * لا حاجة إلى `withExclusiveTransactionAsync`: الطابور الداخلي يضمن أن معاملة واحدة فقط مفتوحة على
 * الاتصال في أي لحظة. إن اضطر التطبيق إلى مشاركة الاتصال فليفتح اتصالاً مستقلاً للمحوّل كما أعلاه.
 */

import type {
  CursorRow,
  LocalOpState,
  ProjectionRow,
  SnapshotRow,
  StoragePort,
  StorageTransaction,
  StoredOperation,
} from "../storage";

/** القيم التي تعبر حدود المشغّل — لا bigint ولا blob (الأرقام الكبيرة سلاسل قانونية). */
export type SqlValue = string | number | null;

/**
 * المشغّل الأدنى الذي يحقنه التطبيق (expo-sqlite على الهاتف، node:sqlite في الاختبارات).
 * اتصال واحد يملكه المحوّل وحده؛ المعاملات يصدرها المحوّل عبر `exec`.
 */
export interface SqliteDriver {
  /** ينفّذ SQL بلا معاملات وسيطة (قد يحوي عدة جمل). */
  exec(sql: string): Promise<void>;
  /** جملة كتابة واحدة بمعاملات موضعية `?`. */
  run(sql: string, params: readonly SqlValue[]): Promise<void>;
  /** كل الصفوف كأجسام بأسماء الأعمدة. */
  all<T>(sql: string, params: readonly SqlValue[]): Promise<T[]>;
  /** أول صف أو null. */
  get<T>(sql: string, params: readonly SqlValue[]): Promise<T | null>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS operations (
  operation_id TEXT PRIMARY KEY NOT NULL,
  state TEXT NOT NULL,
  created_local_seq INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS operations_state_seq ON operations (state, created_local_seq);
CREATE TABLE IF NOT EXISTS cursors (
  key TEXT PRIMARY KEY NOT NULL,
  server_seq TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id TEXT PRIMARY KEY NOT NULL,
  state TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projections (
  key TEXT PRIMARY KEY NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY NOT NULL,
  value INTEGER NOT NULL
);
INSERT OR IGNORE INTO counters (name, value) VALUES ('local_seq', 0);
`;

const cursorKey = (scope: string, scopeId: string, group: string) => `${scope}|${scopeId}|${group}`;

/**
 * أصغر سلسلة أكبر من كل سلسلة تبدأ بالبادئة، بترتيب نقاط الترميز (= ترتيب بايتات UTF-8 الذي
 * يستعمله BINARY في SQLite). null إن لم يوجد حد أعلى (بادئة فارغة أو كلها U+10FFFF).
 */
const prefixUpperBound = (prefix: string): string | null => {
  const points = [...prefix];
  while (points.length > 0) {
    const last = points.pop()!.codePointAt(0)!;
    if (last < 0x10ffff) {
      const next = last + 1 === 0xd800 ? 0xe000 : last + 1; // تخطّي نطاق البدائل
      return points.join("") + String.fromCodePoint(next);
    }
  }
  return null;
};

interface JsonRow {
  readonly json: string;
}

class SqliteTx implements StorageTransaction {
  constructor(private readonly db: SqliteDriver) {}

  async getOperation(operationId: string): Promise<StoredOperation | null> {
    const row = await this.db.get<JsonRow>("SELECT json FROM operations WHERE operation_id = ?", [
      operationId,
    ]);
    return row ? (JSON.parse(row.json) as StoredOperation) : null;
  }

  async putOperation(op: StoredOperation): Promise<void> {
    await this.db.run(
      `INSERT INTO operations (operation_id, state, created_local_seq, json) VALUES (?, ?, ?, ?)
       ON CONFLICT (operation_id) DO UPDATE SET
         state = excluded.state, created_local_seq = excluded.created_local_seq, json = excluded.json`,
      [op.operationId, op.state, op.createdLocalSeq, JSON.stringify(op)],
    );
  }

  async listOperationsByState(state: LocalOpState): Promise<StoredOperation[]> {
    const rows = await this.db.all<JsonRow>(
      "SELECT json FROM operations WHERE state = ? ORDER BY created_local_seq, rowid",
      [state],
    );
    return rows.map((r) => JSON.parse(r.json) as StoredOperation);
  }

  async nextLocalSeq(): Promise<number> {
    await this.db.run("UPDATE counters SET value = value + 1 WHERE name = 'local_seq'", []);
    return this.currentLocalSeq();
  }

  async currentLocalSeq(): Promise<number> {
    const row = await this.db.get<{ readonly value: number }>(
      "SELECT value FROM counters WHERE name = 'local_seq'",
      [],
    );
    return row ? Number(row.value) : 0;
  }

  async getCursor(scope: string, scopeId: string, entityGroup: string): Promise<CursorRow | null> {
    const row = await this.db.get<JsonRow>("SELECT json FROM cursors WHERE key = ?", [
      cursorKey(scope, scopeId, entityGroup),
    ]);
    return row ? (JSON.parse(row.json) as CursorRow) : null;
  }

  async advanceCursor(row: CursorRow): Promise<void> {
    const key = cursorKey(row.scope, row.scopeId, row.entityGroup);
    const current = await this.db.get<{ readonly server_seq: string }>(
      "SELECT server_seq FROM cursors WHERE key = ?",
      [key],
    );
    // لا تراجع داخل الجيل (§٨.٧) — المقارنة بـ BigInt على السلاسل القانونية
    if (current !== null && BigInt(row.serverSeq) <= BigInt(current.server_seq)) return;
    const stored: CursorRow = {
      scope: row.scope,
      scopeId: row.scopeId,
      entityGroup: row.entityGroup,
      serverSeq: row.serverSeq,
    };
    await this.db.run(
      `INSERT INTO cursors (key, server_seq, json) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET server_seq = excluded.server_seq, json = excluded.json`,
      [key, row.serverSeq, JSON.stringify(stored)],
    );
  }

  async getSnapshot(snapshotId: string): Promise<SnapshotRow | null> {
    const row = await this.db.get<JsonRow>("SELECT json FROM snapshots WHERE snapshot_id = ?", [
      snapshotId,
    ]);
    return row ? (JSON.parse(row.json) as SnapshotRow) : null;
  }

  async putSnapshot(row: SnapshotRow): Promise<void> {
    // upsert يحفظ rowid فتبقى القائمة بترتيب أول إدراج كالمحوّل الذاكري
    await this.db.run(
      `INSERT INTO snapshots (snapshot_id, state, json) VALUES (?, ?, ?)
       ON CONFLICT (snapshot_id) DO UPDATE SET state = excluded.state, json = excluded.json`,
      [row.snapshotId, row.state, JSON.stringify(row)],
    );
  }

  async listSnapshots(): Promise<SnapshotRow[]> {
    const rows = await this.db.all<JsonRow>("SELECT json FROM snapshots ORDER BY rowid", []);
    return rows.map((r) => JSON.parse(r.json) as SnapshotRow);
  }

  async getProjection(key: string): Promise<ProjectionRow | null> {
    const row = await this.db.get<JsonRow>("SELECT json FROM projections WHERE key = ?", [key]);
    return row ? { key, value: JSON.parse(row.json) as Record<string, unknown> } : null;
  }

  async putProjection(row: ProjectionRow): Promise<void> {
    await this.db.run(
      `INSERT INTO projections (key, json) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET json = excluded.json`,
      [row.key, JSON.stringify(row.value)],
    );
  }

  async listProjections(prefix: string): Promise<ProjectionRow[]> {
    // نطاق على المفتاح الأساسي (يستعمل الفهرس) بدل LIKE الذي يحتاج تهريب % و _
    const upper = prefixUpperBound(prefix);
    const rows =
      upper === null
        ? await this.db.all<{ readonly key: string; readonly json: string }>(
            "SELECT key, json FROM projections WHERE key >= ? ORDER BY key",
            [prefix],
          )
        : await this.db.all<{ readonly key: string; readonly json: string }>(
            "SELECT key, json FROM projections WHERE key >= ? AND key < ? ORDER BY key",
            [prefix, upper],
          );
    return rows
      .filter((r) => r.key.startsWith(prefix))
      .map((r) => ({ key: r.key, value: JSON.parse(r.json) as Record<string, unknown> }));
  }

  async getMeta(key: string): Promise<string | null> {
    const row = await this.db.get<{ readonly value: string }>(
      "SELECT value FROM meta WHERE key = ?",
      [key],
    );
    return row ? row.value : null;
  }

  async putMeta(key: string, value: string): Promise<void> {
    await this.db.run(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }
}

export class SqliteStorage implements StoragePort {
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(private readonly db: SqliteDriver) {}

  /** يفتح المحوّل وينشئ المخطط إن لم يوجد (آمن للتكرار على نفس القاعدة). */
  static async open(driver: SqliteDriver): Promise<SqliteStorage> {
    await driver.exec(SCHEMA);
    return new SqliteStorage(driver);
  }

  transaction<T>(work: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      await this.db.exec("BEGIN IMMEDIATE");
      let result: T;
      try {
        result = await work(new SqliteTx(this.db));
      } catch (error) {
        await this.rollbackQuietly();
        throw error;
      }
      try {
        await this.db.exec("COMMIT"); // الالتزام عند النجاح فقط
      } catch (error) {
        await this.rollbackQuietly();
        throw error;
      }
      return result;
    });
  }

  read<T>(work: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      await this.db.exec("BEGIN");
      try {
        return await work(new SqliteTx(this.db));
      } finally {
        await this.rollbackQuietly(); // القراءة لا تلتزم شيئاً أبداً
      }
    });
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** تراجع لا يحجب الخطأ الأصلي (قد تكون SQLite تراجعت تلقائياً بعد خطأ جسيم). */
  private async rollbackQuietly(): Promise<void> {
    try {
      await this.db.exec("ROLLBACK");
    } catch {
      // لا معاملة مفتوحة — لا شيء للتراجع عنه
    }
  }
}

export type { StoragePort, StorageTransaction, StoredOperation } from "../storage";

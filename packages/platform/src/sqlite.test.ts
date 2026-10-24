/**
 * اختبارات عقد التخزين على محوّل SQLite فوق `node:sqlite` المدمج في Node (قاعدة ذاكرية لكل اختبار).
 * الطبقة الثانية — expo-sqlite على جهاز/محاكٍ حقيقي — تُضاف مع تطبيق الهاتف (§٤.٦ بند ٦).
 */

import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { runStorageContractTests } from "./contract-tests/index";
import { SqliteStorage, type SqliteDriver, type SqlValue } from "./sqlite/index";

/** مشغّل غير متزامن فوق واجهة node:sqlite المتزامنة — نظير ربط expo-sqlite في التطبيق. */
const nodeDriver = (db: DatabaseSync): SqliteDriver => ({
  exec: (sql) => {
    db.exec(sql);
    return Promise.resolve();
  },
  run: (sql, params: readonly SqlValue[]) => {
    db.prepare(sql).run(...params);
    return Promise.resolve();
  },
  all: <T>(sql: string, params: readonly SqlValue[]) =>
    Promise.resolve(db.prepare(sql).all(...params) as T[]),
  get: <T>(sql: string, params: readonly SqlValue[]) =>
    Promise.resolve((db.prepare(sql).get(...params) as T | undefined) ?? null),
});

const fresh = () => SqliteStorage.open(nodeDriver(new DatabaseSync(":memory:")));

runStorageContractTests("sqlite (node:sqlite)", fresh);

const count = (db: DatabaseSync, table: string): number =>
  Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);

describe("خصائص SQLite الإضافية", () => {
  it("فتح ثانٍ على نفس القاعدة لا يعيد إنشاء المخطط ولا يفقد البيانات", async () => {
    const db = new DatabaseSync(":memory:");
    const first = await SqliteStorage.open(nodeDriver(db));
    await first.transaction(async (tx) => {
      await tx.nextLocalSeq();
      await tx.nextLocalSeq();
      await tx.putMeta("k", "v");
      await tx.putProjection({ key: "shift:current", value: { expected_cash: "7000" } });
      await tx.advanceCursor({
        scope: "enterprise",
        scopeId: "",
        entityGroup: "probe",
        serverSeq: "42",
      });
    });
    const second = await SqliteStorage.open(nodeDriver(db));
    await second.read(async (tx) => {
      expect(await tx.getMeta("k")).toBe("v");
      expect(await tx.currentLocalSeq()).toBe(2);
      expect((await tx.getCursor("enterprise", "", "probe"))!.serverSeq).toBe("42");
      expect((await tx.getProjection("shift:current"))!.value.expected_cash).toBe("7000");
    });
    expect(await second.transaction((tx) => tx.nextLocalSeq())).toBe(3);
  });

  it("استثناء في منتصف المعاملة لا يترك صفوفاً جزئية في أي جدول", async () => {
    const db = new DatabaseSync(":memory:");
    const storage = await SqliteStorage.open(nodeDriver(db));
    await expect(
      storage.transaction(async (tx) => {
        const seq = await tx.nextLocalSeq();
        await tx.putOperation({
          operationId: "op-x",
          kind: "probe",
          opVersion: 1,
          dependencies: [],
          members: [],
          state: "local",
          createdLocalSeq: seq,
          snapshotRelation: "none",
        });
        await tx.putProjection({ key: "p:1", value: {} });
        await tx.putMeta("m", "1");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(count(db, "operations")).toBe(0);
    expect(count(db, "projections")).toBe(0);
    expect(count(db, "meta")).toBe(0);
    expect(await storage.read((tx) => tx.currentLocalSeq())).toBe(0);
    // الاتصال صالح بعد التراجع: لا معاملة عالقة
    await storage.transaction((tx) => tx.putMeta("m", "2"));
    expect(await storage.read((tx) => tx.getMeta("m"))).toBe("2");
  });

  it("بحث البادئة حرفي: % و _ لا تعمل كأحرف بدل، والترتيب بالمفتاح", async () => {
    const storage = await fresh();
    await storage.transaction(async (tx) => {
      for (const key of ["a_b:2", "a_b:1", "axb:1", "a%:1", "ab:1", "a_c:1"]) {
        await tx.putProjection({ key, value: { key } });
      }
    });
    await storage.read(async (tx) => {
      expect((await tx.listProjections("a_b:")).map((r) => r.key)).toEqual(["a_b:1", "a_b:2"]);
      expect((await tx.listProjections("a%")).map((r) => r.key)).toEqual(["a%:1"]);
      expect(await tx.listProjections("")).toHaveLength(6);
    });
  });

  it("القراءة لا تلتزم كتابات عرضية", async () => {
    const storage = await fresh();
    await storage.read((tx) => tx.putMeta("leak", "x"));
    expect(await storage.read((tx) => tx.getMeta("leak"))).toBeNull();
  });
});

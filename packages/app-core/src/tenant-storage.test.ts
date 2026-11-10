import { describe, expect, it } from "vitest";

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
} from "./tenant-storage";

function memoryStore(seed: Record<string, string> = {}): KeyValueStore & { dump(): object } {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    keys: () => [...m.keys()],
    dump: () => Object.fromEntries(m),
  };
}

const A = "01990000-0000-7000-8000-00000000000a";
const B = "01990000-0000-7000-8000-00000000000b";

describe("قاعدة محلية لكل منشأة (مراجعة 2026-11-10 ع-٤)", () => {
  it("جهاز جديد: أول منشأة تأخذ الاسم القديم، والثانية قاعدتها الخاصة، والعودة تفتح قاعدة الأولى", () => {
    const store = memoryStore();
    expect(activeDatabase(store)).toBe(LEGACY_DATABASE);
    recordLegacyOwner(store, ""); // فُحصت القاعدة القديمة: لا صاحب
    expect(activateTenantDatabase(store, A)).toBe(LEGACY_DATABASE);
    expect(activateTenantDatabase(store, B)).toBe(`sting-${B}`);
    expect(activeDatabase(store)).toBe(`sting-${B}`);
    expect(activateTenantDatabase(store, A)).toBe(LEGACY_DATABASE);
    expect(activeDatabase(store)).toBe(LEGACY_DATABASE);
    expect([...tenantsWithDatabase(store)].sort()).toEqual([A, B]);
  });

  it("جهاز مجهَّز قبل الإصلاح: القاعدة القديمة لمنشأتها، ومنشأة أخرى لا تفتحها", () => {
    const store = memoryStore();
    expect(legacyInspected(store)).toBe(false);
    recordLegacyOwner(store, A);
    expect(legacyInspected(store)).toBe(true);
    // الخروج ثم دخول منشأة ب: قاعدة فارغة لها، لا قاعدة أ
    expect(activateTenantDatabase(store, B)).toBe(`sting-${B}`);
    expect(databaseOf(store, A)).toBe(LEGACY_DATABASE);
    expect(activateTenantDatabase(store, A)).toBe(LEGACY_DATABASE);
  });

  it("الفحص مرة واحدة: نتيجة لاحقة لا تنقل ملكية القاعدة القديمة", () => {
    const store = memoryStore();
    recordLegacyOwner(store, A);
    recordLegacyOwner(store, B);
    expect(databaseOf(store, A)).toBe(LEGACY_DATABASE);
    expect(databaseOf(store, B)).toBeNull();
  });

  it("مفاتيح المنشأة خارج القاعدة تُفرَّغ عند تبديل المنشأة وحده", () => {
    const store = memoryStore({
      "market.cart": "[…]",
      "market.checkout.op.x": "op-1",
      "pur.orders_count": "4",
      "not.inbox_count": "2",
      "vz-theme": "dark",
      "pub.status": "{}",
    });
    recordLegacyOwner(store, "");
    activateTenantDatabase(store, A);
    // أول منشأة ونفس المنشأة من جديد: لا تفريغ
    activateTenantDatabase(store, A);
    expect(store.getItem("market.cart")).toBe("[…]");
    activateTenantDatabase(store, B);
    expect(store.getItem("market.cart")).toBeNull();
    expect(store.getItem("market.checkout.op.x")).toBeNull();
    expect(store.getItem("pur.orders_count")).toBeNull();
    expect(store.getItem("not.inbox_count")).toBeNull();
    // ما ليس تابعاً لمنشأة يبقى
    expect(store.getItem("vz-theme")).toBe("dark");
    expect(store.getItem("pub.status")).toBe("{}");
  });

  it("محو القاعدة القديمة يحرّر اسمها: المنشأة التالية تأخذه", () => {
    const store = memoryStore();
    recordLegacyOwner(store, A);
    activateTenantDatabase(store, A);
    releaseDatabase(store, LEGACY_DATABASE);
    expect(databaseOf(store, A)).toBeNull();
    expect(activateTenantDatabase(store, B)).toBe(LEGACY_DATABASE);
    // وأ إن عادت بعد المحو: قاعدة جديدة لها، لا قاعدة ب
    expect(activateTenantDatabase(store, A)).toBe(`sting-${A}`);
  });

  it("محو قاعدة منشأة ثانية لا يمسّ القاعدة القديمة ولا صاحبها", () => {
    const store = memoryStore();
    recordLegacyOwner(store, A);
    activateTenantDatabase(store, B);
    releaseDatabase(store, `sting-${B}`);
    expect(databaseOf(store, B)).toBeNull();
    expect(databaseOf(store, A)).toBe(LEGACY_DATABASE);
    expect(activateTenantDatabase(store, B)).toBe(`sting-${B}`);
  });

  it("بلا مخزن مفاتيح (تصفّح خاص): القاعدة القديمة كما كان", () => {
    expect(activeDatabase(null)).toBe(LEGACY_DATABASE);
    expect(tenantsWithDatabase(null)).toEqual([]);
    expect(databaseOf(null, A)).toBeNull();
  });
});

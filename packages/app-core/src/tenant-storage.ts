/**
 * قاعدة محلية لكل منشأة على الجهاز (مراجعة 2026-11-10 ع-٤) — منطق التسمية وحده، بلا متصفح ولا Dexie.
 *
 * كانت قاعدة واحدة ثابتة الاسم لكل ما يُفتح على الجهاز، والخروج لا يمحوها ولا الدخول يفحص لمن هي:
 * مستخدم منشأة ثانية كان يرى كتالوج الأولى وعملاءها وورديتها، ويُعدّ معلّقها معلّقاً له.
 *
 * - أول منشأة على الجهاز تأخذ الاسم القديم (فلا يتغيّر شيء لجهاز بمنشأة واحدة ولا للأجهزة المجهَّزة
 *   قبل الإصلاح)، وكل منشأة بعدها اسماً من معرّفها.
 * - المنشأة النشطة واسم قاعدتها في مخزن مفاتيح غير سرّي (التخزين المحلي للمتصفح): عند فتح التطبيق
 *   بلا جلسة يُقرأ القفل وسياق الجلسة من قاعدة آخر منشأة فُتحت.
 * - لا يُمحى معلّق أحد: قاعدة المنشأة السابقة تبقى بما فيها حتى يعود أصحابها ويرفعوه.
 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): readonly string[];
}

/** الاسم الأول والوحيد قبل 2026-11-10 — يبقى لأول منشأة على الجهاز. */
export const LEGACY_DATABASE = "sting-bootstrap";
export const ACTIVE_DATABASE_KEY = "sting.db.active";
const ACTIVE_TENANT_KEY = "sting.db.active-tenant";
/** صاحب القاعدة القديمة: معرّف منشأة، أو فارغ = فُحصت ولا صاحب لها بعد؛ غائب = لم تُفحص. */
const LEGACY_OWNER_KEY = "sting.db.legacy-owner";
const TENANT_PREFIX = "sting.db.t.";
/** مفاتيح تابعة للمنشأة خارج القاعدة (سلة السوق ولقطاته، عدّادات هيكلية) — تُفرَّغ عند تبديلها. */
export const TENANT_LOCAL_PREFIXES: readonly string[] = ["market.", "pur.", "not."];

export function activeDatabase(store: KeyValueStore | null): string {
  return store?.getItem(ACTIVE_DATABASE_KEY) || LEGACY_DATABASE;
}

export function legacyInspected(store: KeyValueStore): boolean {
  return store.getItem(LEGACY_OWNER_KEY) !== null;
}

/** نتيجة فحص القاعدة القديمة مرة واحدة: `owner` آخر منشأة جُهّز لها الجهاز، أو فارغ إن لا أحد. */
export function recordLegacyOwner(store: KeyValueStore, owner: string): void {
  if (legacyInspected(store)) return;
  store.setItem(LEGACY_OWNER_KEY, owner);
  if (owner) store.setItem(TENANT_PREFIX + owner, LEGACY_DATABASE);
}

export function databaseOf(store: KeyValueStore | null, tenantId: string): string | null {
  return store?.getItem(TENANT_PREFIX + tenantId) ?? null;
}

export function tenantsWithDatabase(store: KeyValueStore | null): readonly string[] {
  return (store?.keys() ?? [])
    .filter((k) => k.startsWith(TENANT_PREFIX))
    .map((k) => k.slice(TENANT_PREFIX.length));
}

function clearTenantLocalKeys(store: KeyValueStore): void {
  for (const key of store.keys())
    if (TENANT_LOCAL_PREFIXES.some((p) => key.startsWith(p))) store.removeItem(key);
}

/**
 * يجعل قاعدة هذه المنشأة هي النشطة ويعيد اسمها. يُنادى بعد `recordLegacyOwner` حين تُعرف منشأة
 * الجلسة (دخول، اختيار منشأة، إنشاء منشأة) وقبل وضعها في السياق.
 */
export function activateTenantDatabase(store: KeyValueStore, tenantId: string): string {
  let name = store.getItem(TENANT_PREFIX + tenantId);
  if (!name) {
    if (store.getItem(LEGACY_OWNER_KEY)) {
      name = `sting-${tenantId}`;
    } else {
      name = LEGACY_DATABASE;
      store.setItem(LEGACY_OWNER_KEY, tenantId);
    }
    store.setItem(TENANT_PREFIX + tenantId, name);
  }
  const previous = store.getItem(ACTIVE_TENANT_KEY);
  if (previous && previous !== tenantId) clearTenantLocalKeys(store);
  store.setItem(ACTIVE_TENANT_KEY, tenantId);
  store.setItem(ACTIVE_DATABASE_KEY, name);
  return name;
}

/** بعد محو قاعدة من الجهاز: اسمها يعود حرّاً لمن يُجهَّز بعدها، ومفاتيح منشأتها تُفرَّغ. */
export function releaseDatabase(store: KeyValueStore, name: string): void {
  for (const tenantId of tenantsWithDatabase(store))
    if (store.getItem(TENANT_PREFIX + tenantId) === name)
      store.removeItem(TENANT_PREFIX + tenantId);
  if (name === LEGACY_DATABASE) store.setItem(LEGACY_OWNER_KEY, "");
  clearTenantLocalKeys(store);
}

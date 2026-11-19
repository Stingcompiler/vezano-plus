/**
 * الكتالوج المحلي (CAT-01 «المحلي أولاً»): يُقرأ من إسقاطات الجهاز التي كتبتها النسخة المادية وPULL
 * (`entity:catalog.Item:*`، `entity:catalog.ItemGroup:*`)؛ البحث بالبادئة بعد التطبيع (§٧.٥) على الاسم
 * والأسماء البديلة والباركود. المعطَّل يبقى محفوظاً بشاهده ولا يظهر افتراضياً (ACC-45).
 */
import { matchesPrefix, normalizeSearch } from "@sting/domain";
import type { StoragePort } from "@sting/platform";

export interface LocalItemUnit {
  /** معرّف وحدة الصنف (CAT-03) — غائب في إسقاطات قبل T1.9. */
  readonly id?: string | undefined;
  readonly unit_id: string;
  readonly code: string;
  readonly name: string;
  readonly decimal_places?: 0 | 1 | 2 | 3 | undefined;
  readonly factor_milli: string;
  /** باركود لكل وحدة (CAT-03). */
  readonly barcode?: string | undefined;
}
export interface LocalItem {
  readonly id: string;
  readonly name: string;
  readonly name_normalized: string;
  readonly group_id: string;
  readonly group_name: string;
  readonly base_unit_id: string;
  readonly base_unit_code: string;
  readonly base_unit_name: string;
  readonly base_unit_decimal_places?: 0 | 1 | 2 | 3 | undefined;
  readonly units: readonly LocalItemUnit[];
  readonly barcode: string;
  readonly sale_price_minor: string;
  readonly price_updated_at: string;
  /** حد التنبيه بالوحدة الأساسية (INV-01) — بلا حد لا تنبيه. */
  readonly alert_threshold_milli?: string | undefined;
  /** الصورة لا تصل الأجهزة في PULL — حضورها فقط (0005 §١٢). */
  readonly image_present?: boolean | undefined;
  readonly image_updated_at?: string | undefined;
  readonly aliases: readonly string[];
  readonly is_active: boolean;
  readonly deactivated_at: string;
  readonly updated_at: string;
}
export interface LocalGroup {
  readonly id: string;
  readonly name: string;
  readonly parent_id: string;
  readonly parent_name: string;
  readonly sort_order: number;
  readonly note: string;
}

export const ITEM_PREFIX = "entity:catalog.Item:";
export const GROUP_PREFIX = "entity:catalog.ItemGroup:";

export async function readLocalItems(storage: StoragePort): Promise<LocalItem[]> {
  const rows = await storage.read((tx) => tx.listProjections(ITEM_PREFIX));
  return rows.map((r) => ({
    ...(r.value as unknown as Omit<LocalItem, "id">),
    id: r.key.slice(ITEM_PREFIX.length),
  }));
}

export async function readLocalGroups(storage: StoragePort): Promise<LocalGroup[]> {
  const rows = await storage.read((tx) => tx.listProjections(GROUP_PREFIX));
  return rows
    .map((r) => ({
      ...(r.value as unknown as Omit<LocalGroup, "id">),
      id: r.key.slice(GROUP_PREFIX.length),
    }))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ar"));
}

export interface LocalItemQuery {
  readonly q?: string;
  readonly groupId?: string;
  readonly includeInactive?: boolean;
}

/** يطابق صنفاً واحداً: بادئة الاسم أو أي كلمة فيه، أو بادئة اسم بديل، أو بادئة الباركود. */
export function itemMatches(item: LocalItem, q: string): boolean {
  const query = q.trim();
  if (!query) return true;
  if (matchesPrefix(item.name, query)) return true;
  if (item.aliases.some((a) => matchesPrefix(a, query))) return true;
  return item.barcode.startsWith(normalizeSearch(query));
}

export function filterLocalItems(items: readonly LocalItem[], query: LocalItemQuery): LocalItem[] {
  return items
    .filter((i) => (query.includeInactive ? true : i.is_active))
    .filter((i) => (query.groupId ? i.group_id === query.groupId : true))
    .filter((i) => itemMatches(i, query.q ?? ""))
    .sort((a, b) => a.name_normalized.localeCompare(b.name_normalized, "ar"));
}

/** صفحة من `GET /api/catalog/items` كما يعيدها الخادم: حمولة الصنف نفسها التي تكتبها النسخة. */
export interface ServerItemsPage {
  readonly items: readonly ({ readonly id: string } & Record<string, unknown>)[];
  readonly total: number;
}

export const CATALOG_REFRESHED_META = "catalog.refreshed_at";
/** تحديث الكتالوج من الخادم مرة كل عشر دقائق على الأكثر حين لا يُطلب صراحة. */
export const CATALOG_REFRESH_EVERY_MS = 10 * 60 * 1000;

/**
 * مراجعة 2026-11-18 (0005 §٢٨٠): نسخة الكتالوج على الجهاز تُكتب عند التهيئة وحدها لأن PULL غير موصول،
 * فالباركود الذي يولّده الخادم (أو صنف عُدّل أونلاين) لا يصل الملصقات ولا نقطة البيع. هنا تحديث
 * الأصناف وحدها من قائمة الخادم صفحةً صفحة — إنشاء الصنف وتعديله أونلاين فقط، فالخادم هو الأصل،
 * ولا يمسّ هذا مفاتيح المبيعات ولا مؤشر PULL. يعيد عدد الأصناف المكتوبة، أو `null` إن تعذّر الجلب
 * (بلا شبكة أو رفض) فتبقى النسخة كما هي.
 */
export async function refreshLocalItems(
  storage: StoragePort,
  fetchPage: (offset: number) => Promise<ServerItemsPage | null>,
  opts: { readonly force?: boolean; readonly now?: () => Date } = {},
): Promise<number | null> {
  const now = opts.now ?? (() => new Date());
  if (!opts.force) {
    const last = await storage.read((tx) => tx.getMeta(CATALOG_REFRESHED_META));
    if (last && now().getTime() - Date.parse(last) < CATALOG_REFRESH_EVERY_MS) return 0;
  }
  const rows: ServerItemsPage["items"][number][] = [];
  let total = 0;
  for (let offset = 0; ;) {
    const page = await fetchPage(offset);
    if (!page) return null;
    rows.push(...page.items);
    total = page.total;
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) break;
  }
  // مراجعة 2026-11-19: الصفحات بالإزاحة — صنف أُعيدت تسميته أثناء الجلب قد ينتقل إلى صفحة مضت فيُتخطّى.
  // يُكتب ما وصل، لكن بلا ختم الوقت حين يقلّ عدد الأصناف المختلفة عن آخر مجموع، فيُعاد الجلب في المرة
  // التالية بدل أن يغيب الصنف عشر دقائق.
  const complete = new Set(rows.map((r) => r.id)).size >= total;
  await storage.transaction(async (tx) => {
    for (const { id, ...payload } of rows) {
      await tx.putProjection({ key: ITEM_PREFIX + id, value: payload });
    }
    if (complete) await tx.putMeta(CATALOG_REFRESHED_META, now().toISOString());
  });
  return rows.length;
}

/** حقول إسقاط الصنف كما يكتبها `item_payload` على الخادم — بطاقة الصنف تزيد عليها ما لا يُحفظ. */
const ITEM_KEYS = [
  "name",
  "name_normalized",
  "group_id",
  "group_name",
  "base_unit_id",
  "base_unit_code",
  "base_unit_name",
  "base_unit_decimal_places",
  "units",
  "barcode",
  "sale_price_minor",
  "alert_threshold_milli",
  "price_updated_at",
  "image_present",
  "image_updated_at",
  "aliases",
  "is_active",
  "deactivated_at",
  "updated_at",
] as const;
const UNIT_KEYS = [
  "id",
  "unit_id",
  "code",
  "name",
  "decimal_places",
  "factor_milli",
  "barcode",
  "created_at",
] as const;

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in source) out[k] = source[k];
  return out;
}

/**
 * مراجعة 2026-11-19: الصنف الذي حُفظ للتو (إنشاء، تعديل، وحدة) يُكتب إلى نسخة الجهاز من ردّ الحفظ نفسه —
 * لا جلب للكتالوج كله بعد كل حفظ. يقبل حمولة القائمة أو بطاقة الصنف (يُسقط منها السجلّ والصورة).
 */
export async function putLocalItem(
  storage: StoragePort,
  item: { readonly id: string } & Record<string, unknown>,
): Promise<void> {
  const value = pick(item, ITEM_KEYS);
  if (Array.isArray(value.units)) {
    value.units = (value.units as Record<string, unknown>[]).map((u) => pick(u, UNIT_KEYS));
  }
  await storage.transaction(async (tx) => {
    await tx.putProjection({ key: ITEM_PREFIX + item.id, value });
  });
}

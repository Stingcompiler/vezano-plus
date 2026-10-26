import { dayMonth } from "@sting/app-core";
import type { StoragePort } from "@sting/platform";

/** بطاقة المورد في السوق (ردّ `GET /api/public/market`). */
export interface SupplierCard {
  tenant_id: string;
  public_name: string;
  category_line: string;
  categories: string[];
  service_areas: string[];
  fulfilment: string[];
  offers_count: number;
  badge: "verified" | "expired" | "suspended" | "none";
  badge_label: string;
}

export interface OfferCard {
  id: string;
  seller_tenant_id: string;
  seller_name: string;
  public_name: string;
  unit_name: string;
  pack_label: string;
  price_minor: string;
  price_line: string;
  availability: string;
  confirmed_until: string;
  min_order_qty: number | null;
}

/** معاينة الرابط/البلاغ (`GET /api/market/share/preview`). */
export interface Preview {
  kind: "offer" | "supplier";
  title: string;
  subtitle: string;
  price_minor: string;
  price_line: string;
  path: string;
}

/** سطر السلة المحلية — يقرؤه ORD-01 من المفتاح نفسه (`market.cart`) بشكل الويب `{ at, data }`. */
export interface CartLine {
  offer_id: string;
  seller_tenant_id: string;
  seller_name: string;
  public_name: string;
  pack_label: string;
  unit_name: string;
  price_minor: string;
  currency: string;
  confirmed_at: string;
  valid_until: string;
  qty: number;
  min_order_qty?: number | null;
  fees_label?: string;
}

export const CART_KEY = "market.cart";
export const AREA_KEY = "market.area";

export interface Snap<T> {
  at: string;
  data: T;
}

/** لقطة السوق الأخيرة (`market-store.ts` في الويب): للحالة `stale` فقط، وليست سعراً مؤكَّداً. */
export async function readSnap<T>(storage: StoragePort, key: string): Promise<Snap<T> | null> {
  try {
    const raw = await storage.read((tr) => tr.getMeta(key));
    return raw ? (JSON.parse(raw) as Snap<T>) : null;
  } catch {
    return null;
  }
}

export async function writeSnap<T>(storage: StoragePort, key: string, data: T): Promise<Snap<T>> {
  const snap: Snap<T> = { at: new Date().toISOString(), data };
  await storage.transaction((tr) => tr.putMeta(key, JSON.stringify(snap))).catch(() => undefined);
  return snap;
}

export async function readArea(storage: StoragePort): Promise<string> {
  try {
    return (await storage.read((tr) => tr.getMeta(AREA_KEY))) ?? "";
  } catch {
    return "";
  }
}

export async function writeArea(storage: StoragePort, area: string): Promise<void> {
  await storage.transaction((tr) => tr.putMeta(AREA_KEY, area)).catch(() => undefined);
}

/** «6 حزم» — الصيغة العربية: واحد/اثنان نصّاً، 3–10 جمع، 11+ مفرد. */
export function pluralForm(n: number): "one" | "two" | "few" | "many" {
  return n === 1 ? "one" : n === 2 ? "two" : n >= 3 && n <= 10 ? "few" : "many";
}

/** «09 سبتمبر» من تاريخ يوم `YYYY-MM-DD` كما يفعل الويب (`untilWord`). */
export function untilParts(dateIso: string): { day: string; month: string } {
  return dayMonth(`${dateIso}T12:00:00`);
}

/** نتيجة جلب خادمي: نجاح، أو انقطاع شبكة (offline)، أو فشل خادمي (failed)، أو 404/غيره. */
export type Fetched<T> =
  { kind: "ok"; body: T } | { kind: "offline" } | { kind: "failed"; status: number };

export async function safeGet<T>(
  call: () => Promise<{ data?: unknown; response: Response }>,
  pick: (data: unknown) => T | undefined,
): Promise<Fetched<T>> {
  try {
    const { data, response } = await call();
    const body = response.ok ? pick(data) : undefined;
    if (response.ok && body !== undefined) return { kind: "ok", body };
    return { kind: "failed", status: response.status };
  } catch {
    return { kind: "offline" };
  }
}

/** نص عدد بصيغته للأزرار (التسمية نص واحد): «عرضان» أو «6 عروض». */
export function countText(
  n: number,
  forms: { one: string; two: string; few: string; many: string },
): string {
  const f = pluralForm(n);
  return f === "one" || f === "two" ? forms[f] : `${n} ${forms[f]}`;
}

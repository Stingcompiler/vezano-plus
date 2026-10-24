import type { StoragePort } from "@sting/platform";

import { newId } from "@/lib/crypto";
import { getStorage } from "@/lib/storage";

/**
 * سوق الطلبات (ORD-01…15): مخزن السلة والمسودة والمحاولة الأخيرة. الويب يحفظها في `localStorage`
 * (`cart-store.ts`/`market-store.ts`)؛ الجوال يحفظها في ميتا المخزن المحلي بالأسماء والشكل نفسهما:
 * `{ at, data }` للّقطات، فتقرؤها شاشات الاكتشاف (MP-05) والسلة بالمفتاح نفسه `market.cart`.
 */
export const CART_KEY = "market.cart";

/** سطر السلة المحلية (يكتبه MP-05 ويقرؤه ORD-01) — المسودة لا تُثبّت سعراً (ACC-123). */
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

export interface Snap<T> {
  at: string;
  data: T;
}

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

export async function readCart(): Promise<{ at: string; lines: CartLine[] }> {
  const snap = await readSnap<CartLine[]>(await getStorage(), CART_KEY);
  return { at: snap?.at ?? "", lines: snap?.data ?? [] };
}

export async function writeCart(lines: CartLine[]): Promise<string> {
  return (await writeSnap(await getStorage(), CART_KEY, lines)).at;
}

/** معرّف عملية واحد للمسودة حتى تُرسل — إعادة المحاولة تُرسل الطلب نفسه (ACC-124). */
export async function opIdFor(supplierTenantId: string): Promise<string> {
  const key = `market.checkout.op.${supplierTenantId}`;
  const storage = await getStorage();
  try {
    const cur = await storage.read((tr) => tr.getMeta(key));
    if (cur) return cur;
  } catch {
    /* لا تخزين: معرّف جديد */
  }
  const fresh = newId();
  await storage.transaction((tr) => tr.putMeta(key, fresh)).catch(() => undefined);
  return fresh;
}

export async function clearOpId(supplierTenantId: string): Promise<void> {
  const storage = await getStorage();
  await storage
    .transaction((tr) => tr.putMeta(`market.checkout.op.${supplierTenantId}`, ""))
    .catch(() => undefined);
}

/** ORD-14: آخر محاولة إرسال بمعرّفها — للاستعلام بعد ردّ مفقود (ACC-124). */
export interface SubmitAttempt {
  op_id: string;
  supplier_tenant_id: string;
  kind: "order" | "quote";
  delivery_to: string;
  note: string;
  lines: { offer_id: string; qty: number; price_minor: string }[];
  at: string;
}

export async function saveAttempt(a: SubmitAttempt): Promise<void> {
  const storage = await getStorage();
  await storage
    .transaction((tr) => tr.putMeta(`market.checkout.attempt.${a.op_id}`, JSON.stringify(a)))
    .catch(() => undefined);
}

export async function readAttempt(opId: string): Promise<SubmitAttempt | null> {
  if (!opId) return null;
  try {
    const raw = await (
      await getStorage()
    ).read((tr) => tr.getMeta(`market.checkout.attempt.${opId}`));
    return raw ? (JSON.parse(raw) as SubmitAttempt) : null;
  } catch {
    return null;
  }
}

/** نتيجة جلب خادمي: نجاح، أو انقطاع شبكة (offline)، أو فشل خادمي (failed) بحالته. */
export type Fetched<T> =
  { kind: "ok"; body: T } | { kind: "offline" } | { kind: "failed"; status: number };

export async function safeGet<T>(
  call: () => Promise<{ data?: unknown; response: Response }>,
): Promise<Fetched<T>> {
  try {
    const { data, response } = await call();
    if (response.ok && data !== undefined) return { kind: "ok", body: data as T };
    return { kind: "failed", status: response.status };
  } catch {
    return { kind: "offline" };
  }
}

/** نتيجة إرسال (POST): الجسم سواء أنجح أم رُفض (الأخطاء المسمّاة تأتي في `detail`/`extra`). */
export type Posted<T> =
  { kind: "done"; ok: boolean; status: number; body: T | undefined } | { kind: "offline" };

export async function safePost<T>(
  call: () => Promise<{ data?: unknown; error?: unknown; response: Response }>,
): Promise<Posted<T>> {
  try {
    const r = await call();
    return {
      kind: "done",
      ok: r.response.ok,
      status: r.response.status,
      body: (r.data ?? r.error) as T | undefined,
    };
  } catch {
    return { kind: "offline" };
  }
}

/** بنية رفض الخادم المسمّى. */
export interface Rejection {
  detail?: string;
  extra?: Record<string, unknown>;
}

/** «ددد/شش» من تاريخ ISO. */
export const dm = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** «hh:mm:ss» من ثوانٍ. */
export const hms = (s: number): string => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
};

export const num = (v: string | undefined): number => Number(v || 0);

import { formatMinor, formatQty } from "@sting/app-core";
import type { StoragePort } from "@sting/platform";
import { useCallback, useEffect, useRef, useState } from "react";

import { getStorage } from "@/lib/storage";

/** كميات الشراء غالباً صحيحة (كراتين)؛ الكسور تُعرض بثلاث منازل حين تقع (نظير `qty` في الويب). */
export const qty = (milli: string): string =>
  formatQty(milli, BigInt(milli || "0") % 1000n === 0n ? 0 : 3);

/** «حدّك 3,000 وهذا 4,415» — الكسور تُعرض حين تقع، بلا تقريب. */
export const wholeMinor = (minor: string): string =>
  BigInt(minor || "0") % 100n === 0n ? formatMinor(minor).replace(/\.00$/, "") : formatMinor(minor);

/** «14%» حين يكون صحيحاً، وإلا بمنزلتين — بلا تقريب مخفٍ. */
export const pct = (bp: number): string =>
  bp % 100 === 0 ? `${bp / 100}%` : `${(bp / 100).toFixed(2)}%`;

/** نص يدخله المستخدم بأرقام عربية أو لاتينية ← رقم؛ فارغ/غير صالح = 0. */
export function toNumber(text: string): number {
  const latin = text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, ".")
    .trim();
  const n = Number(latin || "0");
  return Number.isFinite(n) ? n : 0;
}
export const toMilli = (text: string): number => Math.round(toNumber(text) * 1000);
export const toMinor = (text: string): number => Math.round(toNumber(text) * 100);

const PREFIX = "cache.purchasing.";

export async function cacheGet<T>(key: string, storage?: StoragePort): Promise<T | null> {
  try {
    const s = storage ?? (await getStorage());
    const raw = await s.read((t) => t.getMeta(PREFIX + key));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cachePut(key: string, body: unknown): Promise<void> {
  try {
    const s = await getStorage();
    await s.transaction((t) => t.putMeta(PREFIX + key, JSON.stringify(body)));
  } catch {
    /* بلا تخزين: لا تخزين مؤقت */
  }
}

interface Res {
  data?: unknown;
  error?: unknown;
  response: { ok: boolean; status: number };
}

export type ViewSource = "loading" | "live" | "cache" | "none";

/** اسم الدور من جسم 403 (الويب يقرؤه من `role_name` أو `extra.role_name`). */
export function roleNameOf(body: unknown): string {
  const b = body as { role_name?: string; extra?: { role_name?: string } } | undefined | null;
  return b?.role_name ?? b?.extra?.role_name ?? "";
}

/**
 * جلب شاشة خادمية: الأحدث حياً؛ إذا تعثّرت الشبكة تُعرض آخر نسخة محفوظة (stale) وإلا offline.
 * 403 = ممنوع باسم الدور. `key` يتغيّر ← إعادة جلب (فلاتر القائمة).
 */
export function useServerView<T>(key: string | null, call: () => Promise<Res>) {
  const [data, setData] = useState<T | null>(null);
  const [source, setSource] = useState<ViewSource>("loading");
  const [denied, setDenied] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const callRef = useRef(call);
  callRef.current = call;

  const reload = useCallback(async () => {
    if (key === null) return;
    const timer = setTimeout(() => setSlow(true), 3000);
    try {
      const res = await callRef.current();
      if (res.response.status === 403) {
        setDenied(roleNameOf(res.error ?? res.data));
        return;
      }
      const body = res.data as T | undefined;
      if (res.response.ok && body) {
        setDenied(null);
        setData(body);
        setSource("live");
        await cachePut(key, body);
        return;
      }
      throw new Error("bad response");
    } catch {
      const cached = await cacheGet<T>(key);
      if (cached) {
        setData(cached);
        setSource("cache");
      } else {
        setData(null);
        setSource("none");
      }
    } finally {
      clearTimeout(timer);
      setSlow(false);
    }
  }, [key]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, setData, source, denied, slow, reload };
}

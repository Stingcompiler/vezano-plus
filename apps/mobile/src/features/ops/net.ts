import { useCallback, useEffect, useRef, useState } from "react";

import { getStorage } from "@/lib/storage";

export interface Res<T> {
  readonly status: number;
  readonly ok: boolean;
  readonly data: T | undefined;
  readonly error: unknown;
  /** تعذّر الوصول إلى الخادم أصلاً (لا ردّ) */
  readonly offline: boolean;
}

/** ردّ openapi-fetch → شكل موحَّد؛ فشل الشبكة لا يرمي بل يعيد offline. */
export async function call<T>(
  fn: () => Promise<{ data?: unknown; error?: unknown; response: Response }>,
): Promise<Res<T>> {
  try {
    const r = await fn();
    return {
      status: r.response.status,
      ok: r.response.ok,
      data: r.data as T | undefined,
      error: r.error,
      offline: false,
    };
  } catch {
    return { status: 0, ok: false, data: undefined, error: undefined, offline: true };
  }
}

export const detailOf = (e: unknown): string =>
  (e as { detail?: string } | undefined)?.detail ?? "";
export const roleOf = (e: unknown): string =>
  (e as { role_name?: string } | undefined)?.role_name ?? "";

/**
 * قراءة من الخادم مع آخر ردّ ناجح في `meta` (القاعدة 7): فشل الشبكة يُبقي المحفوظ ويرفع `failed`؛
 * 403 = `denied`؛ الردّ الأقدم لا يطغى على الأحدث.
 */
export function useCachedGet<P>(opts: { cacheKey?: string; load: () => Promise<Res<P>> }) {
  const { cacheKey, load } = opts;
  const [data, setData] = useState<P | null>(null);
  const [cached, setCached] = useState<P | null>(null);
  const [failed, setFailed] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [denied, setDenied] = useState<{ role: string } | null>(null);
  const [statusCode, setStatusCode] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (!cacheKey) return;
    void getStorage()
      .then((s) => s.read((t) => t.getMeta(cacheKey)))
      .then((raw) => {
        if (raw) setCached(JSON.parse(raw) as P);
      })
      .catch(() => undefined);
  }, [cacheKey]);

  const run = useCallback(async () => {
    const mine = ++seq.current;
    setFetching(true);
    setFailed(false);
    const r = await load();
    if (mine !== seq.current) return;
    setStatusCode(r.status);
    if (r.status === 403) {
      setDenied({ role: roleOf(r.error) });
      setFetching(false);
      return;
    }
    if (!r.ok || !r.data) {
      setFailed(true);
      setFetching(false);
      return;
    }
    setDenied(null);
    setData(r.data);
    setFetching(false);
    if (cacheKey) {
      const body = JSON.stringify(r.data);
      await getStorage()
        .then((s) => s.transaction((t) => t.putMeta(cacheKey, body)))
        .catch(() => undefined);
    }
  }, [load, cacheKey]);

  useEffect(() => {
    void run();
  }, [run]);

  const p = data ?? cached;
  return { p, data, failed, fetching, denied, statusCode, reload: run, setData };
}

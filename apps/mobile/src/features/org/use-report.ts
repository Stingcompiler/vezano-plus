import { useCallback, useEffect, useRef, useState } from "react";

import { getStorage } from "@/lib/storage";

export interface Fetched<P> {
  readonly status: number;
  readonly ok: boolean;
  readonly data: P | undefined;
  readonly error: unknown;
}

/** نسخة org من `reports/use-report.ts` (قاعدة المجلدات: لا استيراد من منطقة غيري). */
/** رمز اسم الدور من جسم 403 (`role_name`) كما يقرؤه الويب. */
export function roleOf(error: unknown): string {
  return (error as { role_name?: string } | undefined)?.role_name ?? "";
}

/** ردّ openapi-fetch إلى الشكل الذي يفهمه `useReport`. */
export function fetched<P>(r: { data?: unknown; error?: unknown; response: Response }): Fetched<P> {
  return {
    status: r.response.status,
    ok: r.response.ok,
    data: r.data as P | undefined,
    error: r.error,
  };
}

/**
 * قراءة تقرير من الخادم مع آخر ردّ ناجح محفوظ في `meta` (القاعدة 7): نفس منطق أصل الويب —
 * `failed` عند انقطاع الشبكة أو خطأ الخادم فيُعرض المحفوظ بحالة stale؛ 403 = `denied` (أو `onForbidden`
 * حين لا حالة مرسومة). الردّ الأقدم لا يطغى على الأحدث.
 */
export function useReport<P>(opts: {
  /** مفتاح التخزين؛ بلا مفتاح لا يُحفظ ردّ (REP-05 كالويب) */
  cacheKey?: string;
  load: () => Promise<Fetched<P>>;
  onForbidden?: () => void;
  /** يقبل المحفوظ؟ (REP-02: الجهة نفسها) */
  accept?: (cached: P) => boolean;
  /** يمسح الردّ السابق عند تغيّر الطلب (REP-02) */
  resetOnChange?: boolean;
}) {
  const { cacheKey, load, onForbidden, accept, resetOnChange } = opts;
  const [data, setData] = useState<P | null>(null);
  const [cached, setCached] = useState<P | null>(null);
  const [failed, setFailed] = useState(false);
  /** استثناء شبكة (لا ردّ أصلاً) — يميّز «بلا اتصال» عن خطأ الخادم */
  const [down, setDown] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [denied, setDenied] = useState<{ role: string } | null>(null);
  const seq = useRef(0);
  const forbidden = useRef(onForbidden);
  forbidden.current = onForbidden;

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
    setDown(false);
    try {
      const r = await load();
      if (mine !== seq.current) return;
      if (r.status === 403) {
        setDenied({ role: roleOf(r.error) });
        forbidden.current?.();
        return;
      }
      if (!r.ok || !r.data) {
        setFailed(true);
        return;
      }
      setDenied(null);
      setData(r.data);
      if (cacheKey) {
        const body = JSON.stringify(r.data);
        await getStorage()
          .then((s) => s.transaction((t) => t.putMeta(cacheKey, body)))
          .catch(() => undefined);
      }
    } catch {
      if (mine === seq.current) {
        setFailed(true);
        setDown(true);
      }
    } finally {
      if (mine === seq.current) setFetching(false);
    }
  }, [load, cacheKey]);

  useEffect(() => {
    if (resetOnChange) setData(null);
    void run();
  }, [run, resetOnChange]);

  const p = data ?? (cached && (!accept || accept(cached)) ? cached : null);
  return { p, data, cached, failed, down, fetching, denied, setDenied, reload: run };
}

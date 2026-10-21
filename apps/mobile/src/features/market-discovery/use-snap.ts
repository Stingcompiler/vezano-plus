import { useCallback, useEffect, useRef, useState } from "react";

import { type Fetched, readSnap, type Snap, writeSnap } from "@/features/market-discovery/lib";
import { getStorage } from "@/lib/storage";

export type Net = "loading" | "ok" | "offline" | "failed";

/**
 * جلب خادمي مع لقطة محفوظة (القاعدة 7): النجاح يحدّث اللقطة؛ الانقطاع أو الفشل يعرض آخر لقطة بحالة
 * `stale`/`offline` — كما يفعل الويب بـ`readSnapshot`/`writeSnapshot`. `delayMs` لتأخير البحث بالكتابة.
 */
export function useSnapGet<T>(
  key: string,
  load: () => Promise<Fetched<T>>,
  deps: readonly unknown[],
  delayMs = 0,
  enabled = true,
) {
  const [data, setData] = useState<T | null>(null);
  const [snap, setSnap] = useState<Snap<T> | null>(null);
  const [net, setNet] = useState<Net>("loading");
  const [ready, setReady] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  const tick = useRef(0);

  useEffect(() => {
    let alive = true;
    void getStorage()
      .then((s) => readSnap<T>(s, key))
      .then((s) => {
        if (alive) {
          setSnap(s);
          setReady(true);
        }
      })
      .catch(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [key]);

  const run = useCallback(async () => {
    const me = ++tick.current;
    setNet("loading");
    const r = await loadRef.current();
    if (me !== tick.current) return;
    if (r.kind === "ok") {
      setData(r.body);
      setNet("ok");
      const s = await getStorage()
        .then((st) => writeSnap(st, key, r.body))
        .catch(() => null);
      if (me === tick.current && s) setSnap(s);
    } else setNet(r.kind);
  }, [key]);

  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => void run(), delayMs);
    return () => clearTimeout(t);
  }, [run, delayMs, enabled, ...deps]);

  const fell = net === "offline" || net === "failed";
  const shown = data ?? (fell ? (snap?.data ?? null) : null);
  return { shown, snap, net: ready ? net : ("loading" as Net), reload: run, data };
}

import { useCallback, useEffect, useRef, useState } from "react";

import { type Fetched, readSnap, type Snap, writeSnap } from "@/features/market-orders/lib";
import { getStorage } from "@/lib/storage";

export type Net = "loading" | "ok" | "offline" | "failed";

/**
 * جلب خادمي لوثيقة طلب مع آخر لقطة محفوظة (القاعدة 7): النجاح يحدّث اللقطة؛ الانقطاع أو الفشل يعرض
 * آخر لقطة (`fromCache`) فتُعلن الشاشة `stale` وتقفل التغيير بسبب ظاهر. 404 = `notFound` (الرابط لم يعد صالحاً).
 */
export function useDoc<T>(key: string, load: () => Promise<Fetched<T>>) {
  const [data, setData] = useState<T | null>(null);
  const [snap, setSnap] = useState<Snap<T> | null>(null);
  const [net, setNet] = useState<Net>("loading");
  const [status, setStatus] = useState(0);
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

  const persist = useCallback(
    async (body: T, me: number) => {
      const s = await getStorage()
        .then((st) => writeSnap(st, key, body))
        .catch(() => null);
      if (me === tick.current && s) setSnap(s);
    },
    [key],
  );

  const reload = useCallback(async () => {
    const me = ++tick.current;
    setNet("loading");
    const r = await loadRef.current();
    if (me !== tick.current) return;
    if (r.kind === "ok") {
      setData(r.body);
      setNet("ok");
      setStatus(200);
      await persist(r.body, me);
    } else {
      setStatus(r.kind === "failed" ? r.status : 0);
      setNet(r.kind);
    }
  }, [persist]);

  useEffect(() => {
    void reload();
  }, [reload, key]);

  /** ردّ إجراء ناجح يحمل الوثيقة الجديدة (كما يفعل الويب بـ`setD(body)`). */
  const replace = useCallback(
    (body: T) => {
      setData(body);
      setNet("ok");
      void persist(body, tick.current);
    },
    [persist],
  );

  const notFound = net === "failed" && status === 404;
  const fell = net === "offline" || (net === "failed" && !notFound);
  const shown = data ?? (fell ? (snap?.data ?? null) : null);
  const fromCache = data === null && shown !== null;
  return {
    shown,
    snap,
    net: ready ? net : ("loading" as Net),
    notFound,
    fromCache,
    reload,
    replace,
  };
}

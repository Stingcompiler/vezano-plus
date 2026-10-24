import type { StateCode } from "@sting/design";
import type { StoragePort } from "@sting/platform";
import { useCallback, useEffect, useRef, useState } from "react";

import { getStorage } from "@/lib/storage";

export interface Snap<T> {
  at: string;
  data: T;
}

/** لقطة الخادم الأخيرة (القاعدة 7): للعرض `stale`/`offline` فقط، وليست مصدر حقيقة. */
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

/** نتيجة جلب خادمي: نجاح، أو انقطاع شبكة، أو فشل خادمي برمزه. */
export type Fetched<T> =
  { kind: "ok"; body: T } | { kind: "offline" } | { kind: "failed"; status: number };

type Raw = { data?: unknown; error?: unknown; response: Response };

export async function safeGet<T>(
  call: () => Promise<Raw>,
  pick: (body: unknown) => T | undefined = (b) => b as T | undefined,
  acceptStatus: readonly number[] = [],
): Promise<Fetched<T>> {
  try {
    const { data, error, response } = await call();
    const body = pick(
      response.ok ? data : acceptStatus.includes(response.status) ? error : undefined,
    );
    if (body !== undefined) return { kind: "ok", body };
    return { kind: "failed", status: response.status };
  } catch {
    return { kind: "offline" };
  }
}

export type Net = "loading" | "ok" | "offline" | "failed";

/**
 * جلب خادمي مع لقطة محفوظة: النجاح يحدّث اللقطة؛ الانقطاع أو الفشل يعرض آخر لقطة. `data` = آخر ردّ
 * حيّ، `shown` = الحيّ وإلا اللقطة، و`fromCache` يُعلن أن المعروض قديم.
 */
export function useServerGet<T>(
  key: string,
  load: () => Promise<Fetched<T>>,
  deps: readonly unknown[] = [],
  enabled = true,
) {
  const [data, setData] = useState<T | null>(null);
  const [snap, setSnap] = useState<Snap<T> | null>(null);
  const [net, setNet] = useState<Net>("loading");
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState(0);
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

  const reload = useCallback(async () => {
    const me = ++tick.current;
    const r = await loadRef.current();
    if (me !== tick.current) return;
    if (r.kind === "ok") {
      setData(r.body);
      setNet("ok");
      const s = await getStorage()
        .then((st) => writeSnap(st, key, r.body))
        .catch(() => null);
      if (me === tick.current && s) setSnap(s);
    } else {
      setStatus(r.kind === "failed" ? r.status : 0);
      setNet(r.kind);
    }
  }, [key]);

  useEffect(() => {
    if (!enabled) return;
    void reload();
  }, [reload, enabled, ...deps]);

  const fell = net === "offline" || net === "failed";
  const shown = data ?? (fell ? (snap?.data ?? null) : null);
  return {
    data,
    shown,
    net: ready ? net : ("loading" as Net),
    status,
    fromCache: data === null && shown !== null,
    cachedAt: snap?.at ?? "",
    reload,
    setData,
  };
}

/** ردّ إجراء على الخادم: نجح، أو رُفض برمزه، أو انقطعت الشبكة (الإجراء لا يُسجَّل محلياً). */
export type Reply<T> =
  | { kind: "ok"; status: number; body: T }
  | { kind: "error"; status: number; body: T | undefined }
  | { kind: "offline" };

export async function send<T>(call: () => Promise<Raw>): Promise<Reply<T>> {
  try {
    const { data, error, response } = await call();
    if (response.ok) return { kind: "ok", status: response.status, body: (data ?? {}) as T };
    return { kind: "error", status: response.status, body: (error ?? data) as T | undefined };
  } catch {
    return { kind: "offline" };
  }
}

/** حالة الشاشة عند فشل الجلب: لقطة قديمة ← stale، انقطاع ← offline، 403 ← permission_denied، غيره ← server_error (القاعدة 7). */
export function netState(net: Net, fromCache: boolean, status = 0): StateCode | null {
  if (net === "loading" || net === "ok") return null;
  if (fromCache) return "stale";
  if (net === "offline") return "offline";
  return status === 403 ? "permission_denied" : "server_error";
}

/** «09/03» من تاريخ يوم ISO — اليوم/الشهر لاتينيان. */
export const dm = (iso: string): string => {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d ?? ""}/${m ?? ""}`;
};

/** نص عدد بصيغة المعدود العربية: واحد/اثنان نصّاً، 3–10 جمع، 11+ مفرد. */
export function pluralForm(n: number): "one" | "two" | "few" | "many" {
  return n === 1 ? "one" : n === 2 ? "two" : n >= 3 && n <= 10 ? "few" : "many";
}

/** كمية من ألف (milli) بلا أصفار زائدة: 12000 ← «12». */
export function qtyOfMilli(milli: number | string): string {
  const n = Number(milli) / 1000;
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "");
}

/** السعر المكتوب بالجنيه ← قروش كنص، أو "" إن فُرغ (كما يفعل الويب). */
export const priceToMinor = (price: string): string =>
  price ? String(Math.round(Number(price) * 100)) : "";

export const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

import type { HomeSummary, SearchResponse } from "@sting/app-core";
import type { StoragePort } from "@sting/platform";
import { tx } from "@sting/texts";

import { nativeRoute } from "@/lib/routes";
import { openOnWeb } from "@/lib/web";

/**
 * بيانات الرئيسية والبحث على الهاتف (0005 §١٧٥) — منطق الويب نفسه (`home-cache.ts` والبحث المحلي في
 * `search-client.tsx`) فوق تخزين الهاتف: آخر ملخّص معروف للأرقام «من آخر مطابقة» بلا اتصال، وبحث محلي
 * على إسقاطات الأصناف والأطراف والمستندات.
 */
export type { HomeSummary, SearchResponse };

const KEY = "home.cache";

export interface HomeCache {
  readonly savedAt: string;
  readonly summary: HomeSummary;
}

export async function readHomeCache(storage: StoragePort): Promise<HomeCache | null> {
  try {
    const raw = await storage.read((t) => t.getMeta(KEY));
    return raw ? (JSON.parse(raw) as HomeCache) : null;
  } catch {
    return null;
  }
}

export async function writeHomeCache(storage: StoragePort, summary: HomeSummary): Promise<void> {
  await storage
    .transaction((t) =>
      t.putMeta(KEY, JSON.stringify({ savedAt: new Date().toISOString(), summary })),
    )
    .catch(() => undefined);
}

const T3 = "HOME-03";
const KINDS = [
  { kind: "parties", label: tx(T3, "أطراف"), prefix: "entity:parties." },
  { kind: "documents", label: tx(T3, "مستندات"), prefix: "entity:documents." },
  { kind: "items", label: tx(T3, "أصناف"), prefix: "entity:catalog." },
] as const;
export const SEARCH_KIND_COUNT = KINDS.length;

/** بحث محلي بلا اتصال على ما خُزّن على الجهاز — كالويب. */
export async function searchLocal(storage: StoragePort, q: string): Promise<SearchResponse> {
  const needle = q.trim();
  const groups = await Promise.all(
    KINDS.map(async (k) => {
      const rows = needle ? await storage.read((t) => t.listProjections(k.prefix)) : [];
      const results = rows
        .filter((r) => JSON.stringify(r.value).includes(needle))
        .slice(0, 20)
        .map((r) => ({
          id: r.key,
          title:
            typeof r.value.name === "string"
              ? r.value.name
              : typeof r.value.title === "string"
                ? r.value.title
                : r.key,
          meta: "",
          tag: tx(T3, "محلي"),
          tag_kind: "muted" as const,
          href: "",
        }));
      return { kind: k.kind, label: k.label, results };
    }),
  );
  return {
    query: q,
    groups,
    restricted: [],
    suggestions: { nearest: [], other_branches: false, create: false },
    total: groups.reduce((n, g) => n + g.results.length, 0),
    kinds_with_results: groups.filter((g) => g.results.length).length,
    elapsed_ms: 0,
  };
}

export function openHref(href: string, push: (path: string) => void): void {
  if (!href) return;
  const native = nativeRoute(href);
  if (native) push(native);
  else void openOnWeb(href);
}

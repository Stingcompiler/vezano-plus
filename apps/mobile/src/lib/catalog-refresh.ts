import type { createApiClient } from "@sting/app-core";
import { refreshLocalItems, type ServerItemsPage } from "@sting/sync-core";

import { getStorage } from "@/lib/storage";

/**
 * نسخة الكتالوج على الهاتف من الخادم (0005 §٢٨٠) — نظير `apps/web/src/lib/catalog-refresh.ts`:
 * الملصقات ونقطة البيع تقرآن المحلي وحده وPULL غير موصول. بلا شبكة يعيد `null` ويبقى المحلي.
 */
export async function refreshCatalog(
  api: ReturnType<typeof createApiClient>,
  force = false,
): Promise<number | null> {
  return refreshLocalItems(
    await getStorage(),
    async (offset) => {
      try {
        const { data, response } = await api.GET("/api/catalog/items", {
          params: { query: { include_inactive: true, offset } },
        });
        if (!response.ok || !data) return null;
        const d = data as unknown as Partial<ServerItemsPage>;
        return { items: d.items ?? [], total: d.total ?? 0 };
      } catch {
        return null;
      }
    },
    { force },
  );
}

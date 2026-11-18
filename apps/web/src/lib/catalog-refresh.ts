import { refreshLocalItems, type ServerItemsPage } from "@sting/sync-core";

import { api } from "@/lib/api";
import { getStorage } from "@/lib/storage";

/**
 * نسخة الكتالوج على الجهاز من الخادم (0005 §٢٨٠): الملصقات ونقطة البيع تقرآن المحلي وحده، وPULL غير
 * موصول، فهذا يكتب الأصناف كما هي على الخادم (معها المعطَّلة). بلا شبكة أو مع رفض يعيد `null` ويبقى
 * المحلي. بلا `force` لا يجلب أكثر من مرة كل عشر دقائق.
 */
export function refreshCatalog(force = false): Promise<number | null> {
  return refreshLocalItems(
    getStorage(),
    async (offset) => {
      try {
        const { data, response } = await api().GET("/api/catalog/items", {
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

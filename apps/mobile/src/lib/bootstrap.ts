import type { StoragePort } from "@sting/platform";
import {
  activateBootstrap,
  applyBootstrapPage,
  beginBootstrap,
  type BootstrapEntity,
  type BootstrapImage,
  type BootstrapProgress,
  DOWNLOAD_ORDER,
  expireBootstrap,
  isExpired,
  readBootstrap,
} from "@sting/sync-core";

import type { useSession } from "@/lib/session";

/**
 * حلقة التنزيل الأول (ACC-05) على الهاتف — منطق `use-bootstrap` في الويب نفسه فوق دوال `sync-core`:
 * نسخة مادية ← صفحات النطاقات بترتيب `DOWNLOAD_ORDER` ← التفعيل. الاستئناف من النسخة نفسها؛ الانتهاء
 * (410) يبدأ نسخة جديدة ويقول ذلك؛ خطأ في منتصف نطاق: ثلاث محاولات متباعدة ثم وقوف — ما نزل يبقى.
 */
export type BootstrapStop = "error" | "expired" | "offline";
export type BootstrapResult =
  { readonly done: true } | { readonly done: false; readonly stop: BootstrapStop };

type Api = ReturnType<typeof useSession>["api"];

class ExpiredError extends Error {}
class OfflineError extends Error {}

export async function runBootstrap(opts: {
  readonly api: Api;
  readonly storage: StoragePort;
  readonly tenantId: string;
  readonly branchId: string;
  readonly onProgress: (p: BootstrapProgress, expiredNotice: boolean) => void;
  readonly isCancelled?: () => boolean;
  readonly retryDelaysMs?: readonly number[];
}): Promise<BootstrapResult> {
  const { api, storage, tenantId, branchId, onProgress } = opts;
  const delays = opts.retryDelaysMs ?? [1000, 3000, 7000];
  let expiredNotice = false;

  const withRetries = async <T>(fn: () => Promise<T>): Promise<T> => {
    let last: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      if (opts.isCancelled?.()) throw new Error("cancelled");
      try {
        return await fn();
      } catch (e) {
        if (e instanceof ExpiredError) throw e;
        // فشل الشبكة نفسه (لا ردّ) = بلا اتصال — لا إعادة محاولة تستنزف البطارية
        if (e instanceof TypeError) throw new OfflineError();
        last = e;
        const d = delays[attempt];
        if (d === undefined) break;
        await new Promise((r) => setTimeout(r, d));
      }
    }
    throw last instanceof Error ? last : new Error("failed");
  };

  try {
    let p = await readBootstrap(storage);
    if (p && isExpired(p)) {
      expiredNotice = true;
      p = null;
    }
    if (!p || p.tenantId !== tenantId) {
      const image = await withRetries(async () => {
        const { data, response } = await api.POST("/api/bootstrap/start");
        if (!response.ok || !data) throw new Error("start_failed");
        return data as unknown as BootstrapImage;
      });
      p = await beginBootstrap(storage, image, { tenantId, branchId });
    }
    onProgress(p, expiredNotice);
    if (!p.activatedAt) {
      const ordered = [...p.image.scopes].sort(
        (a, b) => DOWNLOAD_ORDER.indexOf(a.group) - DOWNLOAD_ORDER.indexOf(b.group),
      );
      for (const scope of ordered) {
        for (let n = (p.pagesDone[scope.group] ?? 0) + 1; n <= scope.pages; n++) {
          const imageId = p.image.image_id;
          const page = await withRetries(async () => {
            const { data, response } = await api.GET("/api/bootstrap/{image_id}/page", {
              params: { path: { image_id: imageId }, query: { group: scope.group, page: n } },
            });
            if (response.status === 410) throw new ExpiredError();
            if (!response.ok || !data) throw new Error("page_failed");
            return data as unknown as { entities: BootstrapEntity[] };
          });
          const applied = await applyBootstrapPage(storage, scope.group, n, page.entities);
          if (applied.progress) {
            p = applied.progress;
            onProgress(p, expiredNotice);
          }
        }
      }
      const outcome = await activateBootstrap(storage);
      if (outcome.progress) {
        p = outcome.progress;
        onProgress(p, expiredNotice);
      }
      await api
        .POST("/api/bootstrap/{image_id}/complete", {
          params: { path: { image_id: p.image.image_id } },
        })
        .catch(() => undefined);
    }
    return { done: true };
  } catch (e) {
    if (e instanceof ExpiredError) {
      await expireBootstrap(storage);
      return { done: false, stop: "expired" };
    }
    if (e instanceof OfflineError) return { done: false, stop: "offline" };
    return { done: false, stop: "error" };
  }
}

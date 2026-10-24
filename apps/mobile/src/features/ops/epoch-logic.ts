import { reconcileNow } from "@sting/app-core";
import type { ContractsClient } from "@sting/contracts";
import type { StoragePort } from "@sting/platform";
import { adoptEpoch, EPOCH_CHANGE_META, EPOCH_RECONCILED_META } from "@sting/sync-core";

import { newId } from "@/lib/crypto";

export interface EpochChange {
  readonly previous: string;
  readonly next: string;
  readonly detectedAt: string;
}
export interface ReconcileOutcome {
  readonly present: number;
  readonly toUpload: number;
  readonly held: number;
  readonly synced: number;
}

export async function readEpochChange(storage: StoragePort): Promise<EpochChange | null> {
  const raw = await storage.read((tx) => tx.getMeta(EPOCH_CHANGE_META));
  return raw ? (JSON.parse(raw) as EpochChange) : null;
}

/**
 * SYS-08 (§٨.١٢) — منفذ `reconcileEpoch` الويب نفسه: اعتماد الجيل الجديد (عزل الأرقام القديمة، المؤكد
 * يعود local بهويته)، ثم مقارنة الهويات بما عند الخادم — ما نجا يُترك مؤكداً، وما فُقد يُرفع من جديد،
 * وما اختلف يُحجز. يرمي `reconcile_failed` إن لم يردّ الخادم على المقارنة.
 */
export async function reconcileEpoch(
  api: ContractsClient,
  storage: StoragePort,
  change: EpochChange,
): Promise<ReconcileOutcome> {
  await adoptEpoch(storage, change.next);
  const local = await storage.read((tx) => tx.listOperationsByState("local"));
  const { data, response } = await api.POST("/api/sync/reconcile", {
    body: { operation_ids: local.map((o) => o.operationId) },
  });
  const body = data as unknown as { present: string[]; missing: string[] } | undefined;
  if (!response.ok || !body) throw new Error("reconcile_failed");
  const present = new Set(body.present);
  await storage.transaction(async (tx) => {
    for (const op of local) {
      if (!present.has(op.operationId)) continue;
      // نجت عند الخادم بهويتها — تُترك مؤكدة
      await tx.putOperation({ ...op, state: "synced" });
    }
  });
  const push = await reconcileNow({ api, storage, requestId: newId });
  const after = await storage.read(async (tx) => ({
    conflict: (await tx.listOperationsByState("conflict")).length,
    quarantined: (await tx.listOperationsByState("quarantined")).length,
  }));
  await storage.transaction((tx) => tx.putMeta(EPOCH_CHANGE_META, ""));
  await storage.transaction((tx) =>
    tx.putMeta(
      EPOCH_RECONCILED_META,
      JSON.stringify({
        previous: change.previous,
        next: change.next,
        at: new Date().toISOString(),
        present: body.present.length,
        uploaded: body.missing.length,
        held: after.conflict + after.quarantined,
      }),
    ),
  );
  return {
    present: body.present.length,
    toUpload: body.missing.length,
    held: after.conflict + after.quarantined,
    synced: push.synced,
  };
}

"use client";

/**
 * ناقل الرفع المشترك (§٨.٣ من جهة الجهاز): غلاف واحد عبر `/api/sync/push`، والعابر يعود بموعد
 * المحاولة التالية، والمصادقة/الجيل يوقفان الرفع. `pendingAfter` يبلّغ الخادم بالمعلّق المتبقي
 * (ACC-09 «المعلّق على الأجهزة»).
 */
import {
  checkReach as sharedCheckReach,
  countPending as sharedCountPending,
  createPushTransport as sharedCreatePushTransport,
  type LastPush,
  pushPending as sharedPushPending,
  type ReachStatus,
  readHalted as sharedReadHalted,
  readLastOk as sharedReadLastOk,
  readLastPush as sharedReadLastPush,
  reconcileNow as sharedReconcileNow,
} from "@sting/app-core";
import {
  attemptsKey,
  adoptEpoch,
  EPOCH_CHANGE_META,
  EPOCH_RECONCILED_META,
  REVOKED_META,
  type TransportFailure,
  type PushOnceOutcome,
  type PushTransport,
} from "@sting/sync-core";

import { api, apiBaseUrl, getDeviceRefresh } from "@/lib/api";
import { renewDeviceSession } from "@/lib/device-session";
import { getStorage, wipeLocalStorage } from "@/lib/storage";

// المحرّك نفسه انتقل إلى `@sting/app-core` (0005 §١٧٥) ليشاركه الجوال؛ هنا ربطه بمفردات الويب
export { LAST_PUSH_META, type LastPush, type ReachStatus } from "@sting/app-core";

const deps = () => ({
  api: api(),
  storage: getStorage(),
  requestId: () => crypto.randomUUID(),
  onHalt,
  // مراجعة 2026-10-19 B2 (0005 §١٧٨): جلسة مستخدم مكان جلسة الجهاز ← تجديد ثم إعادة مرة
  renewDevice: async () => (await renewDeviceSession()) !== null,
});

export function createPushTransport(
  pendingAfter?: (sent: number) => Promise<number>,
): PushTransport {
  return sharedCreatePushTransport(api(), pendingAfter);
}

export function countPending(): Promise<number> {
  return sharedCountPending(getStorage());
}

export function pushPending(
  maxRounds = 10,
  opts: { manual?: boolean } = {},
): Promise<PushOnceOutcome> {
  return sharedPushPending(deps(), maxRounds, opts);
}

export function readLastPush(): Promise<LastPush | null> {
  return sharedReadLastPush(getStorage());
}

export function checkReach(): Promise<ReachStatus | null> {
  return sharedCheckReach(api(), getStorage(), deps().renewDevice);
}

export function reconcileNow(): Promise<{
  push: PushOnceOutcome;
  synced: number;
  reach: ReachStatus | null;
}> {
  return sharedReconcileNow(deps());
}

export function readLastOk(): Promise<string | null> {
  return sharedReadLastOk(getStorage());
}

export function readHalted(): Promise<string | null> {
  return sharedReadHalted(getStorage());
}

/**
 * الوقوف بإشارة (§٨.٣/§٨.١٢/§٩.٣): تغيّر الجيل يُسجَّل للمصالحة (SYS-08) ولا يُعتمد تلقائياً؛
 * سحب الجهاز يسلّم المعلّق إلى الحجر باعتماد مقيّد (SYS-07)؛ المحو عن بُعد يُنفَّذ محلياً.
 */
async function onHalt(failure: Exclude<TransportFailure, { kind: "transient" }>, epoch: string) {
  const storage = getStorage();
  if (failure.kind === "epoch_mismatch") {
    if (!failure.currentEpoch || failure.currentEpoch === epoch) return;
    await storage.transaction((tx) =>
      tx.putMeta(
        EPOCH_CHANGE_META,
        JSON.stringify({
          previous: epoch,
          next: failure.currentEpoch,
          detectedAt: new Date().toISOString(),
        }),
      ),
    );
    return;
  }
  if (failure.kind === "auth") {
    if (failure.detail === "device_wiped") {
      // أُقرّ فقد المعلّق عند المالك — الجهاز يمسح محلّيه (SYS-07)
      await wipeLocalStorage();
      return;
    }
    if (failure.detail === "device_revoked" || failure.detail === "session_revoked") {
      await handOverToQuarantine();
    }
  }
}

export interface HandoverOutcome {
  readonly held: number;
  readonly duplicate: number;
  readonly failed: boolean;
}

/** SYS-07 (§٩.٣): الجهاز المسحوب يسلّم عمله غير المرفوع إلى الحجر برمز التجديد — لا هوية من الحمولة. */
export async function handOverToQuarantine(): Promise<HandoverOutcome> {
  const storage = getStorage();
  const refresh = getDeviceRefresh();
  const ops = await storage.read(async (tx) => [
    ...(await tx.listOperationsByState("local")),
    ...(await tx.listOperationsByState("pending")),
  ]);
  if (!refresh || ops.length === 0) return { held: 0, duplicate: 0, failed: !refresh };
  try {
    const r = await fetch(`${apiBaseUrl()}/api/sync/recovery/handover`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${refresh}` },
      body: JSON.stringify({
        operations: ops.map((op) => ({
          operation_id: op.operationId,
          kind: op.kind,
          op_version: op.opVersion,
          dependencies: op.dependencies,
          members: op.members.map((m) => ({
            entity: m.entity,
            id: m.id,
            schema_version: m.schemaVersion,
            payload: m.payload,
          })),
        })),
      }),
    });
    if (!r.ok) return { held: 0, duplicate: 0, failed: true };
    const body = (await r.json()) as {
      device_status: string;
      results: { operation_id: string; status: string }[];
    };
    let held = 0;
    let duplicate = 0;
    await storage.transaction(async (tx) => {
      for (const res of body.results) {
        if (res.status !== "held" && res.status !== "duplicate") continue;
        const op = await tx.getOperation(res.operation_id);
        if (!op) continue;
        await tx.putOperation({ ...op, state: "quarantined" });
        await tx.putMeta(
          `quarantine:${op.operationId}`,
          JSON.stringify({ code: "recovered", detail: body.device_status }),
        );
        const raw = await tx.getMeta(attemptsKey(op.operationId));
        const list = raw ? (JSON.parse(raw) as unknown[]) : [];
        list.push({ at: new Date().toISOString(), event: "handed_over", code: body.device_status });
        await tx.putMeta(attemptsKey(op.operationId), JSON.stringify(list.slice(-30)));
        if (res.status === "held") held += 1;
        else duplicate += 1;
      }
      await tx.putMeta(
        REVOKED_META,
        JSON.stringify({ status: body.device_status, at: new Date().toISOString(), held }),
      );
    });
    return { held, duplicate, failed: false };
  } catch {
    return { held: 0, duplicate: 0, failed: true };
  }
}

export interface EpochChange {
  readonly previous: string;
  readonly next: string;
  readonly detectedAt: string;
}

export async function readEpochChange(): Promise<EpochChange | null> {
  const raw = await getStorage().read((tx) => tx.getMeta(EPOCH_CHANGE_META));
  return raw ? (JSON.parse(raw) as EpochChange) : null;
}

export interface ReconcileOutcome {
  readonly present: number;
  readonly toUpload: number;
  readonly held: number;
  readonly synced: number;
}

/**
 * SYS-08 (§٨.١٢): اعتماد الجيل الجديد (عزل الأرقام القديمة، المؤكد يعود local بهويته)، ثم مقارنة
 * الهويات بما عند الخادم — ما نجا يُترك مؤكداً، وما فُقد يُرفع من جديد، وما اختلف يُحجز.
 */
export async function reconcileEpoch(change: EpochChange): Promise<ReconcileOutcome> {
  const storage = getStorage();
  await adoptEpoch(storage, change.next);
  const local = await storage.read((tx) => tx.listOperationsByState("local"));
  const { data, response } = await api().POST("/api/sync/reconcile", {
    body: { operation_ids: local.map((o) => o.operationId) },
  });
  const body = data as unknown as { present: string[]; missing: string[] } | undefined;
  if (!response.ok || !body) throw new Error("reconcile_failed");
  const present = new Set(body.present);
  await storage.transaction(async (tx) => {
    for (const op of local) {
      if (!present.has(op.operationId)) continue;
      // نجت عند الخادم بهويتها — تُترك مؤكدة (الأرقام تعود مع PULL؛ لا تُرفع من جديد)
      await tx.putOperation({ ...op, state: "synced" });
    }
  });
  const push = await pushPending(10, { manual: true });
  const after = await storage.read(async (tx) => ({
    conflict: (await tx.listOperationsByState("conflict")).length,
    quarantined: (await tx.listOperationsByState("quarantined")).length,
  }));
  const synced = push.kind === "applied" ? push.synced : 0;
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
    synced,
  };
}

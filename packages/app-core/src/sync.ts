/**
 * محرّك الرفع والوصول المشترك بين الويب والجوال (خطة الجوال M1؛ 0005 §١٧٤) — كان في `apps/web/src/lib/sync.ts`
 * مقيّداً بمفردات الويب. هنا يأخذ عميل الـAPI والتخزين صراحةً، فيستعمله الويب (بمفرداته) والجوال
 * (بـSQLite وعميله) بالمنطق نفسه: غلاف واحد عبر `/api/sync/push`، والعابر يعود بموعد المحاولة التالية،
 * والمصادقة/الجيل يوقفان الرفع؛ ثلاث محاولات متباعدة ثم وقوف معلَن والطابور محفوظ (SYS-01).
 */
import type { ContractsClient } from "@sting/contracts";
import type { StoragePort } from "@sting/platform";
import {
  HALTED_META,
  LAST_OK_META,
  MAX_AUTO_ATTEMPTS,
  type PushEnvelope,
  type PushOnceOutcome,
  pushOnce,
  type PushResponse,
  type PushTransport,
  type TransportFailure,
} from "@sting/sync-core";

export const LAST_PUSH_META = "sync.last_push";

export interface LastPush {
  readonly kind: PushOnceOutcome["kind"];
  readonly status?: number | undefined;
  readonly at: string;
}

export interface ReachStatus {
  readonly server_time: string;
  readonly sync_epoch: string;
  readonly server_seq_high: string;
  readonly quarantined: number;
  readonly conflicted: number;
  readonly last_accepted_at: string | null;
}

export function createPushTransport(
  api: ContractsClient,
  pendingAfter?: (sent: number) => Promise<number>,
): PushTransport {
  return {
    async push(envelope: PushEnvelope) {
      const left = pendingAfter ? await pendingAfter(envelope.operations.length) : undefined;
      const { data, error, response } = await api.POST("/api/sync/push", {
        body: {
          ...envelope,
          operations: envelope.operations.map((o) => ({ ...o })),
          ...(left === undefined ? {} : { pending_after: Math.max(0, left) }),
        } as never,
      });
      const err = error as unknown as { detail?: string; sync_epoch?: string } | undefined;
      if (response.ok && data) return { ok: true, response: data as unknown as PushResponse };
      if (response.status === 401 || response.status === 403)
        return { ok: false, kind: "auth", status: response.status, detail: err?.detail ?? "" };
      if (response.status === 409)
        return { ok: false, kind: "epoch_mismatch", currentEpoch: err?.sync_epoch ?? "" };
      return { ok: false, kind: "transient", reason: "server_error", status: response.status };
    },
  };
}

export async function countPending(storage: StoragePort): Promise<number> {
  return storage.read(
    async (tx) =>
      (await tx.listOperationsByState("local")).length +
      (await tx.listOperationsByState("pending")).length,
  );
}

export async function readLastPush(storage: StoragePort): Promise<LastPush | null> {
  const raw = await storage.read((tx) => tx.getMeta(LAST_PUSH_META));
  return raw ? (JSON.parse(raw) as LastPush) : null;
}

export async function readLastOk(storage: StoragePort): Promise<string | null> {
  return storage.read((tx) => tx.getMeta(LAST_OK_META));
}

export async function readHalted(storage: StoragePort): Promise<string | null> {
  const v = await storage.read((tx) => tx.getMeta(HALTED_META));
  return v || null;
}

export interface PushDeps {
  readonly api: ContractsClient;
  readonly storage: StoragePort;
  /** معرّف الطلب لكل جولة (UUID) — من المنصّة */
  readonly requestId: () => string;
  /** الوقوف بإشارة (تغيّر الجيل، سحب الجهاز، المحو) — سياسته على المنصّة */
  readonly onHalt?: (
    failure: Exclude<TransportFailure, { kind: "transient" }>,
    epoch: string,
  ) => Promise<void>;
}

/**
 * محاولة رفع واحدة لكل ما هو معلّق محلياً؛ تعيد نتيجة `pushOnce` الأخيرة. بعد `MAX_AUTO_ATTEMPTS`
 * أعطال متتالية يقف الرفع التلقائي (`sync.halted`) ولا يستأنفه إلا الرفع اليدوي (`manual`).
 */
export async function pushPending(
  deps: PushDeps,
  maxRounds = 10,
  opts: { manual?: boolean } = {},
): Promise<PushOnceOutcome> {
  const { storage } = deps;
  const epoch = (await storage.read((tx) => tx.getMeta("sync_epoch"))) ?? "";
  const halted = await storage.read((tx) => tx.getMeta(HALTED_META));
  if (halted && !opts.manual) {
    const last = await readLastPush(storage);
    return {
      kind: "retry",
      failure: { kind: "transient", reason: "server_error", status: last?.status ?? 0 },
      delayMs: 0,
    };
  }
  const transport = createPushTransport(
    deps.api,
    async (sent) => (await countPending(storage)) - sent,
  );
  let out: PushOnceOutcome = { kind: "idle" };
  for (let i = 0; i < maxRounds; i++) {
    out = await pushOnce(storage, { transport, syncEpoch: epoch, requestId: deps.requestId() });
    if (out.kind !== "applied") break;
  }
  if (out.kind === "halt") await deps.onHalt?.(out.failure, epoch);
  await storage.transaction(async (tx) => {
    if (out.kind === "retry") {
      const attempts = Number((await tx.getMeta("push_attempts")) ?? "0");
      if (attempts >= MAX_AUTO_ATTEMPTS) await tx.putMeta(HALTED_META, new Date().toISOString());
    } else if (out.kind === "applied" || out.kind === "idle") {
      await tx.putMeta(HALTED_META, "");
    }
  });
  // آخر محاولة رفع — تقرؤها POS-11 لتقول «الخادم ردّ بخطأ 500» باسمه لا «حدث خطأ»
  await storage.transaction((tx) =>
    tx.putMeta(
      LAST_PUSH_META,
      JSON.stringify({
        kind: out.kind,
        status: out.kind === "retry" ? out.failure.status : undefined,
        at: new Date().toISOString(),
      } satisfies LastPush),
    ),
  );
  return out;
}

/** فحص الوصول: «هناك شبكة» ≠ «نجح الوصول» — ردٌّ مصادَق من الخادم يحدّث `sync.last_ok`. */
export async function checkReach(
  api: ContractsClient,
  storage: StoragePort,
): Promise<ReachStatus | null> {
  try {
    const { data, response } = await api.GET("/api/sync/status", {});
    const body = data as unknown as ReachStatus | undefined;
    if (!response.ok || !body) return null;
    await storage.transaction((tx) => tx.putMeta(LAST_OK_META, new Date().toISOString()));
    return body;
  } catch {
    return null;
  }
}

/** «طابق الآن»: رفع يدوي يستأنف بعد الوقوف ثم فحص وصول — «رُفعت 12 عملية» لا «تمت المزامنة». */
export async function reconcileNow(
  deps: PushDeps,
): Promise<{ push: PushOnceOutcome; synced: number; reach: ReachStatus | null }> {
  const before = await countPending(deps.storage);
  const push = await pushPending(deps, 10, { manual: true });
  const after = await countPending(deps.storage);
  const reach = await checkReach(deps.api, deps.storage);
  return { push, synced: Math.max(0, before - after), reach };
}

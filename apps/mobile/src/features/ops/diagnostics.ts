import { readHalted, readLastOk } from "@sting/app-core";
import type { LocalOpState, StoragePort, StoredOperation } from "@sting/platform";
import { type AttemptEntry, readAttempts } from "@sting/sync-core";
import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * التشخيص المحلي للدعم (SYS-11؛ §١٣.١) — منفذ `lib/diagnostics.ts` في الويب: سجل الأخطاء التقنية من
 * سجلّ محاولات العمليات (بلا أسماء ولا مبالغ)، فشل الطباعة، وحالة المزامنة. لا أسرار ولا بيانات (ACC-87).
 */
export const PRINT_FAILURES_META = "diag.print_failures";

const FAILURE_EVENTS: readonly AttemptEntry["event"][] = [
  "transient",
  "auth",
  "epoch_mismatch",
  "permanent",
  "rejected",
  "conflicted",
];
const STATES: readonly LocalOpState[] = ["local", "pending", "conflict", "quarantined", "synced"];

export interface ErrorEntry {
  readonly at: string;
  readonly event: AttemptEntry["event"];
  readonly status?: number | undefined;
  readonly code?: string | undefined;
  /** أول 6 أحرف من معرّف العملية — كافٍ للدعم ولا يكشف شيئاً */
  readonly op: string;
  readonly kind: string;
}

export interface SupportPayload {
  readonly generated_at: string;
  readonly app: { readonly version: string; readonly platform: string; readonly ua_family: string };
  readonly device: { readonly id: string; readonly prefix: string; readonly branch_code: string };
  readonly storage: {
    readonly usage_bytes: number;
    readonly quota_bytes: number;
    readonly persisted: boolean | null;
    readonly write_failures: number;
  };
  readonly sync: {
    readonly pending: number;
    readonly held: number;
    readonly halted: boolean;
    readonly last_ok: string | null;
  };
  readonly errors: readonly ErrorEntry[];
  readonly print_failures: number;
}

async function allOperations(storage: StoragePort): Promise<StoredOperation[]> {
  return storage.read(async (tx) => {
    const out: StoredOperation[] = [];
    for (const st of STATES) out.push(...(await tx.listOperationsByState(st)));
    return out;
  });
}

/** سجل الأخطاء التقنية في آخر `hours` ساعة — لا حمولات ولا أسماء. */
export async function errorLog(storage: StoragePort, hours: number): Promise<ErrorEntry[]> {
  const since = Date.now() - hours * 3_600_000;
  const out: ErrorEntry[] = [];
  for (const op of await allOperations(storage)) {
    for (const a of await readAttempts(storage, op.operationId)) {
      if (!FAILURE_EVENTS.includes(a.event)) continue;
      if (new Date(a.at).getTime() < since) continue;
      out.push({
        at: a.at,
        event: a.event,
        status: a.status,
        code: a.code,
        op: op.operationId.replace(/-/g, "").slice(0, 6),
        kind: op.kind,
      });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export async function printFailures(storage: StoragePort): Promise<string[]> {
  const raw = await storage.read((tx) => tx.getMeta(PRINT_FAILURES_META));
  return raw ? (JSON.parse(raw) as string[]) : [];
}

/** يبني التقرير كما سيُرسل حرفياً — بنية تقنية لا غير. */
export async function buildSupportPayload(
  storage: StoragePort,
  device: { id: string; prefix: string; branchCode: string },
): Promise<SupportPayload> {
  const [errors, ops, prints, halted, lastOk] = await Promise.all([
    errorLog(storage, 48),
    allOperations(storage),
    printFailures(storage),
    readHalted(storage),
    readLastOk(storage),
  ]);
  return {
    generated_at: new Date().toISOString(),
    app: {
      version: Constants.expoConfig?.version ?? "dev",
      platform: Platform.OS,
      ua_family: Platform.OS,
    },
    device: { id: device.id, prefix: device.prefix, branch_code: device.branchCode },
    storage: { usage_bytes: 0, quota_bytes: 0, persisted: null, write_failures: 0 },
    sync: {
      pending: ops.filter((o) => o.state === "local" || o.state === "pending").length,
      held: ops.filter((o) => o.state === "conflict" || o.state === "quarantined").length,
      halted: Boolean(halted),
      last_ok: lastOk,
    },
    errors,
    print_failures: prints.length,
  };
}

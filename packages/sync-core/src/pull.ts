/**
 * دورة PULL من جهة الجهاز (§٨.٦–٨.٧): الطلب يُبنى من المؤشرات المحفوظة **للجيل المعتمد** وحده،
 * والصفحة تُطبَّق بـ`applyPullPage` في معاملة واحدة، وتتكرر حتى `has_more = false` بسقف صفحات.
 *
 * كان PULL معرَّفاً في الخادم والنواة ولا يستدعيه التطبيق أصلاً، فلا يرى جهازٌ ما رفعه جهاز آخر في
 * فرعه (مراجعة 2026-10-26 بند 11). العابر يعيد موعد المحاولة؛ المصادقة والجيل يوقفان كالرفع.
 */

import type { StoragePort } from "@sting/platform";

import { applyPullPage, type PullApplyOutcome, type PullPage } from "./pull-apply";
import { DEFAULT_RETRY, type RetryPolicy, retryDelayMs } from "./retry";
import { PROTOCOL_VERSION, type TransportFailure } from "./types";

export interface PullEnvelope {
  readonly protocol_version: number;
  readonly sync_epoch: string;
  readonly request_id: string;
  readonly cursors: readonly {
    readonly scope: string;
    readonly entity_group: string;
    readonly scope_id?: string;
    readonly server_seq: string;
  }[];
  readonly limit?: number;
}

export type PullTransportOutcome =
  { readonly ok: true; readonly page: PullPage } | ({ readonly ok: false } & TransportFailure);

export interface PullTransport {
  pull(envelope: PullEnvelope): Promise<PullTransportOutcome>;
}

export interface PullOptions {
  readonly transport: PullTransport;
  readonly syncEpoch: string;
  readonly newRequestId: () => string;
  readonly maxPages?: number;
  readonly limit?: number;
  readonly retry?: RetryPolicy;
  readonly random?: () => number;
}

export type PullOutcome =
  | { readonly kind: "applied"; readonly pages: number; readonly applied: PullApplyOutcome[] }
  | {
      readonly kind: "retry";
      readonly failure: Extract<TransportFailure, { kind: "transient" }>;
      readonly delayMs: number;
      readonly pages: number;
    }
  | {
      readonly kind: "halt";
      readonly failure: Exclude<TransportFailure, { kind: "transient" }>;
      readonly pages: number;
    };

const PULL_ATTEMPTS_KEY = "pull_attempts";

/** مؤشرات الجيل المعتمد؛ مؤشر بلا وسم جيل (قبل هذا الإصلاح) يُعامل من الجيل الحالي. */
export async function pullCursors(
  storage: StoragePort,
  syncEpoch: string,
): Promise<PullEnvelope["cursors"]> {
  const rows = await storage.read((tx) => tx.listCursors());
  return rows
    .filter((c) => c.syncEpoch === undefined || c.syncEpoch === syncEpoch)
    .map((c) => ({
      scope: c.scope,
      entity_group: c.entityGroup,
      ...(c.scopeId ? { scope_id: c.scopeId } : {}),
      server_seq: c.serverSeq,
    }));
}

export async function pullAll(storage: StoragePort, options: PullOptions): Promise<PullOutcome> {
  const applied: PullApplyOutcome[] = [];
  const maxPages = options.maxPages ?? 20;
  for (let pages = 0; pages < maxPages; pages++) {
    const envelope: PullEnvelope = {
      protocol_version: PROTOCOL_VERSION,
      sync_epoch: options.syncEpoch,
      request_id: options.newRequestId(),
      cursors: await pullCursors(storage, options.syncEpoch),
      ...(options.limit ? { limit: options.limit } : {}),
    };
    let outcome: PullTransportOutcome;
    try {
      outcome = await options.transport.pull(envelope);
    } catch {
      outcome = { ok: false, kind: "transient", reason: "network" };
    }
    if (!outcome.ok) {
      if (outcome.kind !== "transient") return { kind: "halt", failure: outcome, pages };
      const attempts = await storage.transaction(async (tx) => {
        const n = Number((await tx.getMeta(PULL_ATTEMPTS_KEY)) ?? "0") + 1;
        await tx.putMeta(PULL_ATTEMPTS_KEY, String(n));
        return n;
      });
      return {
        kind: "retry",
        failure: outcome,
        delayMs: retryDelayMs(attempts, options.retry ?? DEFAULT_RETRY, options.random),
        pages,
      };
    }
    if (outcome.page.sync_epoch !== options.syncEpoch) {
      // صفحة من جيل غير المعتمد لا تُطبَّق (§٨.١٢) — يُسجَّل التغيّر للمصالحة كما في الرفع
      return {
        kind: "halt",
        failure: { kind: "epoch_mismatch", currentEpoch: outcome.page.sync_epoch },
        pages,
      };
    }
    applied.push(await applyPullPage(storage, outcome.page, options.syncEpoch));
    await storage.transaction((tx) => tx.putMeta(PULL_ATTEMPTS_KEY, "0"));
    if (!outcome.page.has_more) return { kind: "applied", pages: pages + 1, applied };
  }
  return { kind: "applied", pages: maxPages, applied };
}

import "fake-indexeddb/auto";
import type { StoragePort } from "@sting/platform";
import { DexieStorage } from "@sting/platform/dexie";
import { MemoryStorage } from "@sting/platform/memory";
import { describe, expect, it } from "vitest";

import { saveOperation } from "./local-save";
import { pushOnce, recoverInFlight } from "./pusher";
import { readAttempts } from "./sync-log";
import type { OperationDraft, PushEnvelope, PushTransport } from "./types";

/**
 * مراجعة 2026-11-10 (ع-١): عملية خرج طلبها ولم يعد ردّه (أُغلق التطبيق أثناء الرفع) تبقى `pending`،
 * والرفع التالي لا يلتقط إلا `local` — فكانت لا تُرفع أبداً. تحت Dexie الحقيقي كذلك لا الذاكرة وحدها.
 */
const draft = (n: number): OperationDraft => ({
  operationId: `00000000-0000-7000-8000-00000000000${n}`,
  kind: "sale",
  opVersion: 1,
  dependencies: [],
  members: [
    {
      entity: "sales.Sale",
      id: `00000000-0000-7000-8000-0000000000a${n}`,
      schemaVersion: 1,
      payload: { invoice_number: `INV-${n}`, total_minor: "10000" },
    },
  ],
});

const hang: PushTransport = { push: () => new Promise(() => {}) };

function accepting(sent: PushEnvelope[]): PushTransport {
  return {
    push: (env) => {
      sent.push(env);
      return Promise.resolve({
        ok: true as const,
        response: {
          protocol_version: 1,
          sync_epoch: env.sync_epoch,
          request_id: env.request_id,
          results: env.operations.map((op) => ({
            operation_id: op.operation_id,
            status: "accepted" as const,
            member_receipts: [],
          })),
          server_seq_high: "1",
        },
      });
    },
  };
}

const states = (s: StoragePort) =>
  s.read(async (tx) => ({
    local: (await tx.listOperationsByState("local")).length,
    pending: (await tx.listOperationsByState("pending")).length,
    synced: (await tx.listOperationsByState("synced")).length,
  }));

describe.each([
  ["الذاكرة", () => new MemoryStorage() as StoragePort],
  ["Dexie", () => new DexieStorage({ databaseName: `rec-${Math.random()}` }) as StoragePort],
])("استرداد العالق «قيد الرفع» — %s", (_name, make) => {
  it("بلا استرداد: العالق لا يُرفع (العيب)، وبعده يُرفع مرة واحدة بهويته", async () => {
    const storage = make();
    await saveOperation(storage, draft(1));
    // التشغيل الأول: الطلب خرج ولم يعد — لا ننتظر الوعد
    void pushOnce(storage, { transport: hang, syncEpoch: "e", requestId: "r1" });
    await expect.poll(() => states(storage)).toEqual({ local: 0, pending: 1, synced: 0 });

    const sent: PushEnvelope[] = [];
    const first = await pushOnce(storage, {
      transport: accepting(sent),
      syncEpoch: "e",
      requestId: "r2",
    });
    expect(first.kind).toBe("idle");
    expect(sent).toHaveLength(0);

    // التشغيل التالي يبدأ بالاسترداد
    expect(await recoverInFlight(storage)).toBe(1);
    expect(await states(storage)).toEqual({ local: 1, pending: 0, synced: 0 });
    const second = await pushOnce(storage, {
      transport: accepting(sent),
      syncEpoch: "e",
      requestId: "r3",
    });
    expect(second).toMatchObject({ kind: "applied", synced: 1 });
    expect(sent.map((e) => e.operations.map((o) => o.operation_id))).toEqual([
      [draft(1).operationId],
    ]);
    expect(await states(storage)).toEqual({ local: 0, pending: 0, synced: 1 });
    const log = await readAttempts(storage, draft(1).operationId);
    expect(log.map((a) => a.event)).toEqual(["saved", "sent", "requeued", "sent", "accepted"]);
  });

  it("يعيد العالق وحده بموضعه في الطابور، ولا يمسّ المحلي ولا المرفوع", async () => {
    const storage = make();
    await saveOperation(storage, draft(1));
    await pushOnce(storage, { transport: accepting([]), syncEpoch: "e", requestId: "r1" });
    await saveOperation(storage, draft(2));
    void pushOnce(storage, { transport: hang, syncEpoch: "e", requestId: "r2" });
    await expect.poll(() => states(storage)).toEqual({ local: 0, pending: 1, synced: 1 });
    await saveOperation(storage, draft(3));

    expect(await recoverInFlight(storage)).toBe(1);
    expect(await recoverInFlight(storage)).toBe(0);
    const sent: PushEnvelope[] = [];
    await pushOnce(storage, { transport: accepting(sent), syncEpoch: "e", requestId: "r3" });
    // ترتيب الإنشاء المحلي محفوظ: العالق (2) قبل اللاحق (3)، والمرفوع (1) لا يُعاد
    expect(sent[0]?.operations.map((o) => o.operation_id)).toEqual([
      draft(2).operationId,
      draft(3).operationId,
    ]);
    expect(await states(storage)).toEqual({ local: 0, pending: 0, synced: 3 });
  });
});

import type { ContractsClient } from "@sting/contracts";
import { MemoryStorage } from "@sting/platform/memory";
import {
  HALTED_META,
  type OperationDraft,
  type PushEnvelope,
  pushOnce,
  saveOperation,
} from "@sting/sync-core";
import { describe, expect, it } from "vitest";

import { classifyFailure, countPending, pushPending, readLastPush } from "./sync";

const draft: OperationDraft = {
  operationId: "00000000-0000-7000-8000-000000000001",
  kind: "sale",
  opVersion: 1,
  dependencies: [],
  members: [
    {
      entity: "sales.Sale",
      id: "00000000-0000-7000-8000-0000000000a1",
      schemaVersion: 1,
      payload: { invoice_number: "INV-1", total_minor: "10000" },
    },
  ],
};

/** عميل API يردّ على `/api/sync/push` بما يُملى عليه، ويعدّ النداءات. */
function fakeApi(reply: (env: PushEnvelope) => { status: number; body: unknown }) {
  const calls: PushEnvelope[] = [];
  const api = {
    POST: (_path: string, init: { body: PushEnvelope }) => {
      calls.push(init.body);
      const { status, body } = reply(init.body);
      const ok = status >= 200 && status < 300;
      return Promise.resolve({
        data: ok ? body : undefined,
        error: ok ? undefined : body,
        response: { ok, status },
      });
    },
  } as unknown as ContractsClient;
  return { api, calls };
}

const accept = (env: PushEnvelope) => ({
  status: 200,
  body: {
    protocol_version: 1,
    sync_epoch: env.sync_epoch,
    request_id: env.request_id,
    results: env.operations.map((op) => ({
      operation_id: op.operation_id,
      status: "accepted",
      member_receipts: [],
    })),
    server_seq_high: "1",
  },
});

let n = 0;
const requestId = () => `r${++n}`;

describe("تصنيف ردّ الخادم (مراجعة 2026-11-10 ع-٣، ع-١٠)", () => {
  it("5xx و408 و429 عابرة؛ وبقية 4xx دائمة برمزها", () => {
    expect(classifyFailure(500, undefined)).toMatchObject({
      kind: "transient",
      reason: "server_error",
    });
    expect(classifyFailure(503, "network_cut")).toMatchObject({ kind: "transient", status: 503 });
    expect(classifyFailure(408, undefined)).toMatchObject({ kind: "transient", reason: "timeout" });
    expect(classifyFailure(429, undefined)).toMatchObject({
      kind: "transient",
      reason: "rate_limited",
    });
    expect(classifyFailure(400, "protocol_version_unsupported")).toEqual({
      ok: false,
      kind: "permanent",
      status: 400,
      detail: "protocol_version_unsupported",
    });
    expect(classifyFailure(413, undefined)).toMatchObject({ kind: "permanent", status: 413 });
  });
});

describe("pushPending", () => {
  it("يسترد العالق «قيد الرفع» من تشغيل سابق عند أول رفع فيصل الخادم (ع-١)", async () => {
    const storage = new MemoryStorage();
    await saveOperation(storage, draft);
    // تشغيل سابق: الطلب خرج ولم يعد
    void pushOnce(storage, {
      transport: { push: () => new Promise(() => {}) },
      syncEpoch: "",
      requestId: "old",
    });
    await expect
      .poll(() => storage.read(async (tx) => (await tx.listOperationsByState("pending")).length))
      .toBe(1);

    const { api, calls } = fakeApi(accept);
    // الجولة الأخيرة `idle`: رُفع كل شيء في التي قبلها
    expect((await pushPending({ api, storage, requestId })).kind).toBe("idle");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.operations.map((o) => o.operation_id)).toEqual([draft.operationId]);
    expect(await countPending(storage)).toBe(0);
  });

  it("لا يعيد ما هو في الطريق فعلاً: نداء ثانٍ في التشغيل نفسه لا يسترد", async () => {
    const storage = new MemoryStorage();
    await saveOperation(storage, draft);
    let release: (v: { status: number; body: unknown }) => void = () => {};
    const calls: PushEnvelope[] = [];
    const api = {
      POST: (_p: string, init: { body: PushEnvelope }) => {
        calls.push(init.body);
        return new Promise((resolve) => {
          release = ({ status, body }) =>
            resolve({ data: body, error: undefined, response: { ok: true, status } });
        });
      },
    } as unknown as ContractsClient;
    const first = pushPending({ api, storage, requestId });
    await expect.poll(() => calls.length).toBe(1);
    // رفع ثانٍ والأول في الطريق: لا شيء `local` ولا استرداد — لا طلب ثانٍ
    const second = await pushPending({ api, storage, requestId });
    expect(second.kind).toBe("idle");
    expect(calls).toHaveLength(1);
    release(accept(calls[0]!));
    expect((await first).kind).toBe("idle");
    expect(calls).toHaveLength(1);
    expect(await countPending(storage)).toBe(0);
  });

  it("رفض دائم (400 إصدار البروتوكول): وقوف معلَن برمزه من أول مرة بلا إعادة تلقائية (ع-١٠)", async () => {
    const storage = new MemoryStorage();
    await saveOperation(storage, draft);
    const { api, calls } = fakeApi(() => ({
      status: 400,
      body: { detail: "protocol_version_unsupported", sync_epoch: null },
    }));
    const halts: unknown[] = [];
    const deps = {
      api,
      storage,
      requestId,
      onHalt: (failure: unknown) => {
        halts.push(failure);
        return Promise.resolve();
      },
    };
    const out = await pushPending(deps);
    expect(out).toMatchObject({
      kind: "halt",
      failure: { kind: "permanent", status: 400, detail: "protocol_version_unsupported" },
    });
    expect(halts).toHaveLength(1);
    expect(await storage.read((tx) => tx.getMeta(HALTED_META))).toBeTruthy();
    expect(await readLastPush(storage)).toMatchObject({ kind: "halt", status: 400 });
    // العملية محفوظة في الطابور لا محجورة ولا ضائعة
    expect(await storage.read(async (tx) => (await tx.listOperationsByState("local")).length)).toBe(
      1,
    );
    // الرفع التلقائي واقف: لا طلب جديد؛ اليدوي يحاول
    await pushPending(deps);
    await pushPending(deps);
    expect(calls).toHaveLength(1);
    await pushPending(deps, 10, { manual: true });
    expect(calls).toHaveLength(2);
  });

  it("5xx عابر: يُعاد حتى ثلاث محاولات ثم يقف، والنجاح اللاحق يرفع الوقوف", async () => {
    const storage = new MemoryStorage();
    await saveOperation(storage, draft);
    let status = 500;
    const { api, calls } = fakeApi((env) => (status === 200 ? accept(env) : { status, body: {} }));
    const deps = { api, storage, requestId };
    for (let i = 0; i < 3; i++) expect((await pushPending(deps)).kind).toBe("retry");
    expect(calls).toHaveLength(3);
    expect(await storage.read((tx) => tx.getMeta(HALTED_META))).toBeTruthy();
    await pushPending(deps);
    expect(calls).toHaveLength(3);
    status = 200;
    expect((await pushPending(deps, 10, { manual: true })).kind).toBe("idle");
    expect(calls).toHaveLength(4);
    expect(await countPending(storage)).toBe(0);
    expect(await storage.read((tx) => tx.getMeta(HALTED_META))).toBe("");
  });
});

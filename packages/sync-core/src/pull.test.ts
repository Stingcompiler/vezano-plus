/**
 * دورة PULL وإصلاحات مراجعة 2026-10-26 (البنود 10، 11، 12): الطلب من مؤشرات الجيل المعتمد، والصفحات
 * حتى `has_more=false`؛ جيل جديد بأرقام أصغر لا تمنعه مؤشرات وإسقاطات قديمة؛ المعلّق المتروك يعود
 * محلياً تحت القفل؛ استثناء الشبكة عابر لا يعلّق العملية.
 */
import { MemoryStorage } from "@sting/platform/memory";
import { describe, expect, it } from "vitest";

import { adoptEpoch } from "./epoch";
import { saveOperation } from "./local-save";
import { pullAll, type PullEnvelope, type PullTransport } from "./pull";
import type { PullEntity, PullPage } from "./pull-apply";
import { pushOnce, recoverStalePending } from "./pusher";
import type { OperationDraft } from "./types";

const page = (over: Partial<PullPage> = {}): PullPage => ({
  protocol_version: 1,
  sync_epoch: "epoch-A",
  request_id: "p",
  entities: [],
  operation_projections: [],
  tombstones: [],
  access_manifest_version: "1",
  cursors: [],
  has_more: false,
  snapshot_candidates: [],
  ...over,
});

const entity = (id: string, seq: string, v: string): PullEntity => ({
  entity: "sales.Sale",
  id,
  schema_version: 1,
  payload: { v },
  server_seq: seq,
  operation_id: `op-${id}`,
});

const cursor = (seq: string) => ({
  scope: "branch",
  entity_group: "sales",
  scope_id: "b1",
  server_seq: seq,
});

function scripted(pages: PullPage[]): { transport: PullTransport; sent: PullEnvelope[] } {
  const sent: PullEnvelope[] = [];
  return {
    sent,
    transport: {
      pull: (env) => {
        sent.push(env);
        const next = pages.shift();
        return Promise.resolve(
          next ? { ok: true as const, page: next } : { ok: true, page: page() },
        );
      },
    },
  };
}

let n = 0;
const ids = () => `00000000-0000-7000-8000-${String(++n).padStart(12, "0")}`;
const draft = (): OperationDraft => ({
  operationId: ids(),
  kind: "probe",
  opVersion: 1,
  dependencies: [],
  members: [{ entity: "probe.Head", id: ids(), schemaVersion: 1, payload: { value: "1" } }],
});

describe("دورة PULL من الجهاز (بند 11)", () => {
  it("يتابع الصفحات حتى has_more=false ويرسل المؤشر المحفوظ في الطلب التالي", async () => {
    const storage = new MemoryStorage();
    const { transport, sent } = scripted([
      page({ entities: [entity("s1", "3", "a")], cursors: [cursor("3")], has_more: true }),
      page({ entities: [entity("s2", "7", "b")], cursors: [cursor("7")] }),
    ]);
    const out = await pullAll(storage, {
      transport,
      syncEpoch: "epoch-A",
      newRequestId: () => "r",
    });
    expect(out.kind).toBe("applied");
    expect(out.pages).toBe(2);
    expect(sent[0]!.cursors).toEqual([]);
    expect(sent[1]!.cursors).toEqual([cursor("3")]);
    const s2 = await storage.read((tx) => tx.getProjection("entity:sales.Sale:s2"));
    expect(s2!.value.payload).toEqual({ v: "b" });
    const cur = await storage.read((tx) => tx.getCursor("branch", "b1", "sales"));
    expect(cur).toMatchObject({ serverSeq: "7", syncEpoch: "epoch-A" });
  });

  it("استثناء الشبكة عابر بموعد إعادة، وصفحة جيل آخر لا تُطبَّق", async () => {
    const storage = new MemoryStorage();
    const failing: PullTransport = { pull: () => Promise.reject(new TypeError("Failed to fetch")) };
    const r = await pullAll(storage, {
      transport: failing,
      syncEpoch: "epoch-A",
      newRequestId: () => "r",
    });
    expect(r.kind).toBe("retry");
    const { transport } = scripted([
      page({ sync_epoch: "epoch-B", entities: [entity("x", "1", "z")] }),
    ]);
    const h = await pullAll(storage, { transport, syncEpoch: "epoch-A", newRequestId: () => "r" });
    expect(h).toMatchObject({
      kind: "halt",
      failure: { kind: "epoch_mismatch", currentEpoch: "epoch-B" },
    });
    expect(await storage.read((tx) => tx.getProjection("entity:sales.Sale:x"))).toBeNull();
  });
});

describe("جيل جديد بأرقام أصغر (بند 12)", () => {
  it("مؤشر الجيل القديم 100 لا يمنع تنزيل الجيل الجديد عند 5، والإسقاط القديم لا يُفضَّل", async () => {
    const storage = new MemoryStorage();
    await adoptEpoch(storage, "epoch-A");
    const before = scripted([
      page({ entities: [entity("s1", "100", "old")], cursors: [cursor("100")] }),
    ]);
    await pullAll(storage, {
      transport: before.transport,
      syncEpoch: "epoch-A",
      newRequestId: () => "r",
    });

    await adoptEpoch(storage, "epoch-B");
    const after = scripted([
      page({
        sync_epoch: "epoch-B",
        entities: [entity("s1", "5", "new")],
        cursors: [cursor("5")],
      }),
    ]);
    await pullAll(storage, {
      transport: after.transport,
      syncEpoch: "epoch-B",
      newRequestId: () => "r",
    });
    // الطلب الأول في الجيل الجديد يبدأ من صفر لا من 100
    expect(after.sent[0]!.cursors).toEqual([cursor("0")]);
    const s1 = await storage.read((tx) => tx.getProjection("entity:sales.Sale:s1"));
    expect(s1!.value).toMatchObject({
      payload: { v: "new" },
      server_seq: "5",
      sync_epoch: "epoch-B",
    });
    const cur = await storage.read((tx) => tx.getCursor("branch", "b1", "sales"));
    expect(cur).toMatchObject({ serverSeq: "5", syncEpoch: "epoch-B" });
    // الحالة السابقة مؤرشفة لا ممحوّة
    const archive = await storage.read((tx) => tx.getMeta("epoch_archive:epoch-A"));
    const archived = JSON.parse(archive!) as { cursors: Record<string, unknown>[] };
    expect(archived.cursors[0]).toMatchObject({
      serverSeq: "100",
      syncEpoch: "epoch-A",
    });
  });
});

describe("المعلّق المتروك والشبكة (بند 10)", () => {
  it("عملية بقيت pending بعد انهيار تعود local وتُرفع؛ والأصل لا يُفقد", async () => {
    const storage = new MemoryStorage();
    const d = draft();
    await saveOperation(storage, d);
    await storage.transaction(async (tx) => {
      const op = await tx.getOperation(d.operationId);
      await tx.putOperation({ ...op!, state: "pending" }); // انهار التبويب بعد التحويل وقبل الرد
    });
    let calls = 0;
    const transport = {
      push: () => {
        calls++;
        return Promise.reject(new Error("unreachable"));
      },
    };
    // بلا استرجاع: الدفعة لا تلتقط pending فلا يُستدعى النقل أصلاً
    expect((await pushOnce(storage, { transport, syncEpoch: "e", requestId: "r" })).kind).toBe(
      "idle",
    );
    expect(calls).toBe(0);
    expect(await recoverStalePending(storage)).toBe(1);
    const out = await pushOnce(storage, { transport, syncEpoch: "e", requestId: "r" });
    // استثناء النقل («Failed to fetch») عابر: العملية تعود local ولا تعلق pending
    expect(out.kind).toBe("retry");
    expect(calls).toBe(1);
    const op = await storage.read((tx) => tx.getOperation(d.operationId));
    expect(op!.state).toBe("local");
    expect(op!.members[0]!.payload).toEqual({ value: "1" });
  });
});

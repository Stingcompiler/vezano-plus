import { MemoryStorage } from "@sting/platform/memory";
import { describe, expect, it } from "vitest";

import {
  filterLocalItems,
  itemMatches,
  type LocalItem,
  readLocalGroups,
  readLocalItems,
  refreshLocalItems,
  type ServerItemsPage,
} from "./catalog-local";

const item = (id: string, over: Partial<LocalItem>): LocalItem => ({
  id,
  name: id,
  name_normalized: id,
  group_id: "",
  group_name: "",
  base_unit_id: "u",
  base_unit_code: "piece",
  base_unit_name: "حبة",
  units: [],
  barcode: "",
  sale_price_minor: "0",
  price_updated_at: "",
  aliases: [],
  is_active: true,
  deactivated_at: "",
  updated_at: "",
  ...over,
});

describe("الكتالوج المحلي (CAT-01 المحلي أولاً؛ §٧.٥)", () => {
  it("يقرأ الأصناف والمجموعات من الإسقاطات ويرتّب المجموعات", async () => {
    const s = new MemoryStorage();
    await s.transaction(async (tx) => {
      await tx.putProjection({
        key: "entity:catalog.Item:a",
        value: { ...item("a", { name: "سكر" }), id: undefined },
      });
      await tx.putProjection({
        key: "entity:catalog.ItemGroup:g2",
        value: { name: "مشروبات", parent_id: "", parent_name: "", sort_order: 1, note: "" },
      });
      await tx.putProjection({
        key: "entity:catalog.ItemGroup:g1",
        value: { name: "بقالة", parent_id: "", parent_name: "", sort_order: 0, note: "" },
      });
      await tx.putProjection({ key: "entity:parties.Party:p", value: { name: "ليس صنفاً" } });
    });
    expect((await readLocalItems(s)).map((i) => [i.id, i.name])).toEqual([["a", "سكر"]]);
    expect((await readLocalGroups(s)).map((g) => g.name)).toEqual(["بقالة", "مشروبات"]);
  });

  it("يطابق بالبادئة بعد التطبيع على الاسم والأسماء البديلة والباركود", () => {
    const oil = item("o", { name: "زيت 1 لتر", aliases: ["زيت طعام"], barcode: "6291000000501" });
    expect(itemMatches(oil, "زي")).toBe(true);
    expect(itemMatches(oil, "طعام")).toBe(true);
    expect(itemMatches(oil, "١ لتر")).toBe(true);
    expect(itemMatches(oil, "629100000")).toBe(true);
    expect(itemMatches(oil, "يت")).toBe(false);
  });

  it("المعطَّل محفوظ بشاهده ولا يظهر افتراضياً (ACC-45)؛ التصفية بالمجموعة", () => {
    const items = [
      item("a", { name: "سكر", name_normalized: "سكر", group_id: "g1" }),
      item("b", {
        name: "صابون قديم",
        name_normalized: "صابون قديم",
        group_id: "g3",
        is_active: false,
      }),
    ];
    expect(filterLocalItems(items, {}).map((i) => i.id)).toEqual(["a"]);
    expect(filterLocalItems(items, { includeInactive: true }).map((i) => i.id)).toEqual(["a", "b"]);
    expect(
      filterLocalItems(items, { groupId: "g3", includeInactive: true }).map((i) => i.id),
    ).toEqual(["b"]);
    expect(filterLocalItems(items, { q: "صاب" })).toEqual([]);
  });
});

describe("تحديث الكتالوج المحلي من الخادم (0005 §٢٨٠)", () => {
  const server = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      ...item(`i${i}`, { barcode: `20000000000${String(i).padStart(2, "0")}` }),
    }));

  it("يجلب الصفحات كلها ويكتب الباركود الجديد فوق النسخة القديمة", async () => {
    const s = new MemoryStorage();
    await s.transaction((tx) =>
      tx.putProjection({
        key: "entity:catalog.Item:i0",
        value: { ...item("i0", {}), id: undefined },
      }),
    );
    const all = server(5);
    const offsets: number[] = [];
    const fetchPage = (offset: number): Promise<ServerItemsPage> => {
      offsets.push(offset);
      return Promise.resolve({ items: all.slice(offset, offset + 2), total: all.length });
    };
    expect(await refreshLocalItems(s, fetchPage)).toBe(5);
    expect(offsets).toEqual([0, 2, 4]);
    const local = await readLocalItems(s);
    expect(local).toHaveLength(5);
    expect(local.find((i) => i.id === "i0")?.barcode).toBe("2000000000000");
  });

  it("لا يجلب ثانية قبل عشر دقائق إلا صراحة، والفشل يترك النسخة كما هي", async () => {
    const s = new MemoryStorage();
    let calls = 0;
    const fetchPage = (): Promise<ServerItemsPage> => {
      calls++;
      return Promise.resolve({ items: server(1), total: 1 });
    };
    const t0 = new Date("2026-11-18T10:00:00Z");
    await refreshLocalItems(s, fetchPage, { now: () => t0 });
    expect(
      await refreshLocalItems(s, fetchPage, { now: () => new Date(t0.getTime() + 60_000) }),
    ).toBe(0);
    expect(calls).toBe(1);
    await refreshLocalItems(s, fetchPage, { force: true, now: () => t0 });
    expect(calls).toBe(2);
    expect(await refreshLocalItems(s, () => Promise.resolve(null), { force: true })).toBeNull();
    expect(await readLocalItems(s)).toHaveLength(1);
  });
});

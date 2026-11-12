import { describe, expect, it } from "vitest";

import type { LocalItem } from "./catalog-local";
import { chunkPages, expandLabels, labelRows } from "./labels-local";

const item = (over: Partial<LocalItem>): LocalItem => ({
  id: "i1",
  name: "سكر",
  name_normalized: "سكر",
  group_id: "",
  group_name: "",
  base_unit_id: "u-kg",
  base_unit_code: "kg",
  base_unit_name: "كغ",
  units: [],
  barcode: "",
  sale_price_minor: "10000",
  price_updated_at: "",
  aliases: [],
  is_active: true,
  deactivated_at: "",
  updated_at: "",
  ...over,
});

describe("ملصقات الأصناف (0005 §٢٧٠)", () => {
  it("كل وحدة نشطة بباركود EAN-13 صحيح صفّ، بسعر وحدتها؛ غير EAN-13 يُعدّ ولا يُرسم", () => {
    const { rows, skipped } = labelRows([
      item({
        barcode: "2000000000015",
        units: [
          {
            unit_id: "u-ctn",
            code: "carton",
            name: "كرتونة",
            factor_milli: "12000",
            barcode: "2000000000022",
          },
          { unit_id: "u-bag", code: "bag", name: "كيس", factor_milli: "5000", barcode: "" },
        ],
      }),
      item({ id: "i2", name: "شاي", barcode: "6291000000142" }), // خانة تحقق خاطئة
      item({ id: "i3", name: "زيت", barcode: "ABC-128" }),
      item({ id: "i4", name: "موقوف", barcode: "2000000000039", is_active: false }),
      item({ id: "i5", name: "بلا باركود" }),
    ]);
    expect(skipped).toBe(2);
    expect(rows.map((r) => [r.label, r.barcode, r.priceMinor])).toEqual([
      ["سكر", "2000000000015", "10000"],
      ["سكر — كرتونة", "2000000000022", "120000"],
    ]);
  });

  it("النسخ بعددها والصفحات أربعاً وعشرين", () => {
    const rows = [{ key: "a" }, { key: "b" }, { key: "c" }];
    const all = expandLabels(rows, { a: 2, b: 0, c: 23, x: 5 });
    expect(all.map((r) => r.key).join("")).toBe("aa" + "c".repeat(23));
    expect(chunkPages(all).map((p) => p.length)).toEqual([24, 1]);
    expect(expandLabels(rows, { a: -3, b: 1.7 }).length).toBe(1);
  });
});

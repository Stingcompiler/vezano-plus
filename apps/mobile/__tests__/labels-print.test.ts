import type { LabelRow } from "@sting/sync-core";

import { labelsSheetHtml } from "@/lib/labels-print";

/** 0005 §٢٧٠ — ورقة A4 للجوال: 24 ملصقاً في الصفحة، بلا سعر افتراضاً، والأرقام لاتينية. */
const row: LabelRow = {
  key: "i1:u",
  itemId: "i1",
  label: "عدس <أحمر>",
  unitName: "حبة",
  barcode: "2000000000015",
  priceMinor: "1250",
};

describe("labelsSheetHtml", () => {
  it("صفحتان لخمسة وعشرين ملصقاً، والاسم مُهرَّب، والسعر حين يُطلب", () => {
    const html = labelsSheetHtml("ملصقات الأصناف", Array(25).fill(row), false);
    expect(html.match(/class="pg"/g)).toHaveLength(2);
    expect(html.match(/class="l"/g)).toHaveLength(25);
    expect(html).toContain("عدس &lt;أحمر&gt;");
    expect(html).not.toContain('class="p"');
    expect(html).toContain("<title>ملصقات الأصناف</title>");
    const priced = labelsSheetHtml("ملصقات الأصناف", [row], true);
    expect(priced).toContain('<span class="d">12.50</span> · حبة');
    // 30 شريطاً لكل EAN-13 (اثنان لكل خانة من الاثنتي عشرة + الحواجز)
    expect(priced.match(/<rect /g)).toHaveLength(30);
  });
});

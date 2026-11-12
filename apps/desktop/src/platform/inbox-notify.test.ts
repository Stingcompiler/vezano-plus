import { describe, expect, it } from "vitest";

import {
  CATEGORY_TEXT,
  type InboxItem,
  MAX_PER_ROUND,
  nextRound,
  SEEN_CAP,
  textOf,
} from "./inbox-notify";

const item = (id: string, o: Partial<InboxItem> = {}): InboxItem => ({
  id,
  kind: "invoice_due",
  category: "operational",
  title: "فاتورة آجلة لمحمد عثمان — 5,000",
  body: "استحقت اليوم",
  read: false,
  ...o,
});

describe("إشعارات النظام من الوارد (DESK-05 · 0005 §٢٥٦)", () => {
  it("أول جولة خطّ أساس: الوارد القديم لا يُفرَغ إشعارات", () => {
    const r = nextRound([item("a"), item("b")], null);
    expect(r.notify).toEqual([]);
    expect(r.seen).toEqual(["a", "b"]);
  });

  it("جديد غير مقروء والنافذة في الخلفية: إشعار بعنوان الفئة — بلا أسماء ولا مبالغ", () => {
    const r = nextRound([item("c"), item("a")], ["a"]);
    expect(r.notify).toEqual([CATEGORY_TEXT["operational"]]);
    expect(JSON.stringify(r.notify)).not.toMatch(/محمد|5,000/);
    expect(r.seen).toEqual(["a", "c"]);
    // الجولة التالية بالوارد نفسه: لا تكرار
    expect(nextRound([item("c"), item("a")], r.seen).notify).toEqual([]);
  });

  it("النافذة في المقدمة لا تحجب الإشعار (0005 §٢٦٨)", () => {
    expect(nextRound([item("c"), item("a")], ["a"]).notify).toEqual([CATEGORY_TEXT["operational"]]);
  });

  it("المقروء لا يُشعَر به، والمكرّر من الفئة نفسها إشعار واحد", () => {
    const r = nextRound(
      [
        item("c", { read: true }),
        item("d"),
        item("e"),
        item("f", { category: "account" }),
        item("a"),
      ],
      ["a"],
    );
    expect(r.notify).toEqual([CATEGORY_TEXT["operational"], CATEGORY_TEXT["account"]]);
    expect(r.seen).toEqual(["a", "c", "d", "e", "f"]);
  });

  it("إعلان المنصة يظهر بنصّه (كتبه المشغّل للمتاجر كلها) مقصوصاً، وفئة مجهولة تُعامل تشغيلية", () => {
    const ann = item("p", {
      kind: "platform_announcement",
      category: "account",
      title: "صيانة الليلة",
      body: "ب".repeat(400),
    });
    expect(textOf(ann).title).toBe("فيزانو بلص — صيانة الليلة");
    expect(textOf(ann).body).toHaveLength(240);
    expect(textOf(item("x", { category: "weird" }))).toEqual(CATEGORY_TEXT["operational"]);
  });

  it("لا إغراق ولا ذاكرة بلا حدّ", () => {
    const anns = Array.from({ length: 9 }, (_, i) =>
      item(`p${i}`, { kind: "platform_announcement", title: `إعلان ${i}` }),
    );
    expect(nextRound(anns, []).notify).toHaveLength(MAX_PER_ROUND);
    const many = Array.from({ length: SEEN_CAP + 50 }, (_, i) => item(`m${i}`));
    const r = nextRound(many, []);
    expect(r.seen).toHaveLength(SEEN_CAP);
    expect(r.seen.at(-1)).toBe(`m${SEEN_CAP + 49}`);
  });
});

import { NAV_GROUPS, NAV_ITEMS } from "@sting/app-core";

import { NAV_GROUP_ICONS, NAV_ITEM_ICONS } from "@/lib/nav-icons";

/** كل بند ومجموعة في «المزيد» لهما أيقونة (§٢٠٤) — بند جديد في `NAV_ITEMS` بلا أيقونة يُكسر هنا. */
describe("أيقونات «المزيد»", () => {
  it("لكل بند ضمن مجموعة أيقونة، ولا مفتاح يتيم", () => {
    const ids = NAV_ITEMS.filter((i) => i.group).map((i) => i.id);
    expect(ids.filter((id) => !NAV_ITEM_ICONS[id])).toEqual([]);
    expect(Object.keys(NAV_ITEM_ICONS).filter((k) => !ids.includes(k))).toEqual([]);
  });

  it("لكل مجموعة أيقونة", () => {
    expect(Object.values(NAV_GROUPS).filter((g) => !NAV_GROUP_ICONS[g])).toEqual([]);
  });
});

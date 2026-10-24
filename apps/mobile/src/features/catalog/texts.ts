import { mtx } from "@sting/texts";
/**
 * نصوص الكتالوج على الجوال وحده — لا مقابل حرفي لها في الويب. قليلة عمداً: صيغ العدّ مأخوذة من
 * `lib/count.tsx` في الويب (لا تدخل في مولّد النصوص)، والباقي أزرار ملازمة لكون الجوال بلا مستعرض ملفات.
 */
export const CT = {
  showMore: mtx("catShowMore"),
  pasteFirst: mtx("catPasteFirst"),
  pasteLabel: mtx("catPasteLabel"),
  pasteHint: mtx("catPasteHint"),
  groupsOne: mtx("catGroupsOne"),
  groupsTwo: mtx("catGroupsTwo"),
  groupsFew: mtx("catGroupsFew"),
  groupsMany: mtx("catGroupsMany"),
  itemsOne: mtx("catItemsOne"),
  itemsTwo: mtx("catItemsTwo"),
  itemsFew: mtx("catItemsFew"),
  itemsMany: mtx("catItemsMany"),
} as const;

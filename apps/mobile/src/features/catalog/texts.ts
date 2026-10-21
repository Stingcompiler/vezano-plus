/**
 * نصوص الكتالوج على الجوال وحده — لا مقابل حرفي لها في الويب. قليلة عمداً: صيغ العدّ مأخوذة من
 * `lib/count.tsx` في الويب (لا تدخل في مولّد النصوص)، والباقي أزرار ملازمة لكون الجوال بلا مستعرض ملفات.
 */
export const CT = {
  showMore: "عرض المزيد",
  pasteFirst: "الصق محتوى CSV أولاً",
  pasteLabel: "محتوى CSV",
  pasteHint: "الصق الأسطر هنا — سطر لكل صنف: الصنف، السعر.",
  groupsOne: "مجموعة واحدة",
  groupsTwo: "مجموعتان",
  groupsFew: "مجموعات",
  groupsMany: "مجموعة",
  itemsOne: "صنف واحد",
  itemsTwo: "صنفان",
  itemsFew: "أصناف",
  itemsMany: "صنفاً",
} as const;

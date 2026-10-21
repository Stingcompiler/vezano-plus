import type { CountForms } from "@/components/reports/ui";

/**
 * صيغ العدّ كما في `lib/count.tsx` بالويب (لا تدخل قوائم نصوص الشاشات المولَّدة) — الأجهزة والعمليات
 * الناقصة وحدها؛ صيغ الفروع في `MOBILE_TEXTS`. لا نصوص جديدة غيرها هنا.
 */
export const DEVICES: CountForms = {
  one: "جهاز واحد",
  two: "جهازان",
  few: "أجهزة",
  many: "جهازاً",
};
/** بعد «ناقص» (منصوب): «ناقص عمليتين» */
export const MISSING_OPERATIONS: CountForms = {
  one: "عملية واحدة",
  two: "عمليتين",
  few: "عمليات",
  many: "عملية",
};

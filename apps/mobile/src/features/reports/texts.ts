import { mtx } from "@sting/texts";
import type { CountForms } from "@/components/reports/ui";

/**
 * صيغ العدّ كما في `lib/count.tsx` بالويب (لا تدخل قوائم نصوص الشاشات المولَّدة) — الأجهزة والعمليات
 * الناقصة وحدها؛ صيغ الفروع في `MOBILE_TEXTS`. لا نصوص جديدة غيرها هنا.
 */
export const DEVICES: CountForms = {
  one: mtx("repDevicesOne"),
  two: mtx("repDevicesTwo"),
  few: mtx("repDevicesFew"),
  many: mtx("repDevicesMany"),
};
/** بعد «ناقص» (منصوب): «ناقص عمليتين» */
export const MISSING_OPERATIONS: CountForms = {
  one: mtx("repMissingOperationsOne"),
  two: mtx("repMissingOperationsTwo"),
  few: mtx("repMissingOperationsFew"),
  many: mtx("repMissingOperationsMany"),
};

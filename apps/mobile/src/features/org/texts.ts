import { mtx } from "@sting/texts";
/**
 * نصوص الجوال وحده في شاشات المنشأة (ORG-01…10) — لا مقابل لها في الويب (أو أضافها الويب بعد آخر
 * توليد لـ`@sting/texts`: تعليمات التحويل وتغطية الفترة في ORG-07). قليلة عمداً.
 */
export const ORG_TEXTS = {
  /** ورقة المشاركة الأصلية لرابط الدعوة (ORG-01) — بدل نسخ الرابط من الشاشة */
  shareLink: mtx("orgShareLink"),
  /** ORG-07 — بطاقة «حوّل إلى» وتغطية الفترة (الويب أضافها بعد التوليد الأخير) */
  payTo: mtx("orgPayTo"),
  copyAccount: mtx("orgCopyAccount"),
  coversUntil: mtx("orgCoversUntil"),
  /** ORG-07 — صورة الإيصال لا تُرفع من الجوال بعد (منتقي الصور غير مثبَّت): الرقم نصاً يكفي للمراجعة */
  noImagePicker: mtx("orgNoImagePicker"),
  /** ORG-10 — تصدير الملف بورقة المشاركة الأصلية قد يفشل أو يُلغى */
  exportFailed: mtx("orgExportFailed"),
} as const;

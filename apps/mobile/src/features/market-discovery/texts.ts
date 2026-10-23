import { mtx } from "@sting/texts";
/**
 * نصوص جوال سوق المشتري وحده — لا مقابل لها في الويب (التقاط الدليل بالكاميرا بدل رفع ملف، ومشاركة الهاتف
 * الأصلية بدل نسخ الحافظة). قليلة عمداً؛ كل ما له نظير في الويب يُؤخذ من `tx`.
 */
export const MD_TEXTS = {
  shoot: mtx("mdShoot"),
  shootTitle: mtx("mdShootTitle"),
  shutter: mtx("mdShutter"),
  retake: mtx("mdRetake"),
  attached: mtx("mdAttached"),
  cached: mtx("mdCached"),
  needsServer: mtx("mdNeedsServer"),
  share: mtx("mdShare"),
  retry: mtx("mdRetry"),
} as const;

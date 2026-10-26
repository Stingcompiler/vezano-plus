import { mtx } from "@sting/texts";
/**
 * نصوص الجوال وحده في قسم الأطراف — لا مقابل لها في الويب (أزرار المشاركة الأصلية). قليلة عمداً؛
 * كل نص له مقابل في الويب يُؤخذ من `tx` لا من هنا.
 */
export const PARTY_TEXTS = {
  whatsapp: mtx("ptyWhatsapp"),
} as const;

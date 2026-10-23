import { type TextKey, type TextOf, tx, mtx } from "@sting/texts";

/**
 * نصوص جوال سوق الطلبات وحده — لا مقابل لها في الويب (الويب يعرض الأخطاء بصمت أو يعيد التوجيه). قليلة
 * عمداً؛ كل ما له نظير في الويب يُؤخذ من `tx`.
 */
export const MO_TEXTS = {
  cached: mtx("moCached"),
  needsServer: mtx("moNeedsServer"),
  retry: mtx("moRetry"),
  loadFailed: mtx("moLoadFailed"),
} as const;

/** مترجم شاشة: يقبل فقط نصاً موجوداً حرفياً في نصوص شاشة الويب `key` (فحص النوع). */
export function tOf<K extends TextKey>(key: K) {
  return <S extends TextOf<K>>(s: S): S => tx(key, s);
}

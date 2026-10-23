import { mtx } from "@sting/texts";
/**
 * نصوص جوال بائع السوق وحده — لا مقابل حرفياً لها في الويب (لا رفع ملفات، ولا قراءة للتاريخ بمنتقٍ).
 * قليلة عمداً؛ كل ما له نظير في الويب يُؤخذ من `tx`.
 */
export const MS_TEXTS = {
  cached: mtx("msCached"),
  needsServer: mtx("msNeedsServer"),
  noUpload: mtx("msNoUpload"),
  retry: mtx("msRetry"),
  loadFailed: mtx("msLoadFailed"),
  serverError: mtx("msServerError"),
  denied: mtx("msDenied"),
  dateHint: mtx("msDateHint"),
  pick: mtx("msPick"),
  choose: mtx("msChoose"),
  noUnits: mtx("msNoUnits"),
  on: mtx("msOn"),
  off: mtx("msOff"),
} as const;

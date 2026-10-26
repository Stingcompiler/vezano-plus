import { mtx } from "@sting/texts";
/**
 * نصوص جوال المخزون وحده — لا مقابل لها في الويب (اختيار الصنف بورقة والمسح بالكاميرا). قليلة عمداً؛
 * كل ما له نظير في الويب يُؤخذ من `tx`.
 */
export const INV_TEXTS = {
  pickItem: mtx("invPickItem"),
  searchHint: mtx("invSearchHint"),
  noMatch: mtx("invNoMatch"),
  scanItems: mtx("invScanItems"),
  needsServer: mtx("invNeedsServer"),
  stepUp: "+",
  stepDown: "−",
} as const;

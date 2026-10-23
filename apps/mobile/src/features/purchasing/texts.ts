import { mtx } from "@sting/texts";
/**
 * نصوص جوال المشتريات وحده — لا مقابل لها في الويب. قليلة عمداً؛ كل ما له نظير في الويب يُؤخذ من `tx`.
 */
export const PUR_TEXTS = {
  needsServer: mtx("purNeedsServer"),
  searchHint: mtx("purSearchHint"),
  stale: mtx("purStale"),
  offlineEmpty: mtx("purOfflineEmpty"),
} as const;

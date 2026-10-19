/**
 * صورة الإيصال كما خزّنها الخادم ← `src` صالح (مراجعة 2026-10-19 B5).
 *
 * ORG-07 يرفع الصورة base64 خاماً بلا بادئة `data:` (حدّ الحجم في الخادم محسوب على الخام)، والمشغّل
 * كان يضعها في `<img src>` كما هي فلا تظهر — فيعتمد إثباتاً لا يرى إيصاله. تُشتقّ البادئة من توقيع
 * الملف أولاً ثم من امتداد الاسم؛ ما كان رابط بيانات كاملاً يمرّ كما هو.
 */
const SIGNATURES: readonly (readonly [string, string])[] = [
  ["iVBORw0KGgo", "image/png"],
  ["/9j/", "image/jpeg"],
  ["R0lGOD", "image/gif"],
  ["UklGR", "image/webp"],
  ["Qk", "image/bmp"],
  ["JVBERi0", "application/pdf"],
];
const BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
};

export function imageSrc(data: string, name = ""): string {
  const raw = data.trim();
  if (!raw || raw.startsWith("data:")) return raw;
  const bySig = SIGNATURES.find(([sig]) => raw.startsWith(sig))?.[1];
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const mime = bySig ?? BY_EXT[ext] ?? "image/jpeg";
  return `data:${mime};base64,${raw}`;
}

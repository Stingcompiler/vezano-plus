/**
 * بايتات ↔ base64 لطابور الطباعة. على دفعات: `String.fromCharCode(...b)` يمرّر كل بايت وسيطاً،
 * فإيصال طويل (صورته النقطية مئات الآلاف من البايتات) يتجاوز حدّ وسائط المحرّك ويرمي قبل أن يدخل
 * الطابور (مراجعة 2026-11-10 ع-١٢).
 */
const CHUNK = 0x8000;

export function toBase64(b: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < b.length; i += CHUNK)
    binary += String.fromCharCode(...b.subarray(i, i + CHUNK));
  return btoa(binary);
}

export const fromBase64 = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

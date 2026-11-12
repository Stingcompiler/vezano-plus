/**
 * الباركود الداخلي (0005 §٢٦٩): EAN-13 بالبادئة 20 يولّده الخادم من عدّاد المنشأة. هنا الحساب المشترك
 * فقط — خانة التحقق، والتمييز بين باركود المصنع وباركود المتجر، ونمط الخطوط (95 وحدة) لرسم الملصق
 * لاحقاً (المرحلة ٢) بلا مكتبة خارجية.
 */

const L = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
] as const;

/** R = عكس بتّات L؛ G = R مقلوباً. */
const R = L.map((p) => [...p].map((b) => (b === "1" ? "0" : "1")).join(""));
const G = R.map((p) => [...p].reverse().join(""));

/** تكافؤ النصف الأيسر بحسب الخانة الأولى (لا تُرسم؛ يُستدل عليها من التكافؤ). */
const PARITY = [
  "LLLLLL",
  "LLGLGG",
  "LLGGLG",
  "LLGGGL",
  "LGLLGG",
  "LGGLLG",
  "LGGGLL",
  "LGLGLG",
  "LGLGGL",
  "LGGLGL",
] as const;

/** خانة التحقق لـ EAN-13 من 12 خانة: الأوزان 1 و3 بالتناوب من اليسار. */
export function ean13CheckDigit(twelve: string): number {
  if (!/^[0-9]{12}$/.test(twelve)) throw new Error("ean13: twelve digits expected");
  let total = 0;
  for (let i = 0; i < 12; i++) total += Number(twelve[i]) * (i % 2 ? 3 : 1);
  return (10 - (total % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^[0-9]{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/**
 * باركود «للتداول داخل المتجر» (GS1 20–29): لا يحمله منتج حقيقي ولا يصلح خارج المنشأة، فلا يُطابَق
 * به صنفٌ بين متجرين أبداً. 20 للباركود الداخلي، و21–29 لباركود الميزان (المرحلة ٣ المقفلة).
 */
export function isStoreInternalBarcode(code: string): boolean {
  return /^2[0-9]{12}$/.test(code.trim());
}

/** نمط EAN-13 كاملاً: 95 وحدة («1» خط، «0» فراغ) — 101 + 6 يسار + 01010 + 6 يمين + 101. */
export function ean13Modules(code: string): string {
  if (!isValidEan13(code)) throw new Error("ean13: invalid code");
  const first = Number(code[0]);
  const parity = PARITY[first] ?? PARITY[0];
  let out = "101";
  for (let i = 1; i <= 6; i++) {
    const d = Number(code[i]);
    out += (parity[i - 1] === "G" ? G[d] : L[d]) ?? "";
  }
  out += "01010";
  for (let i = 7; i <= 12; i++) out += R[Number(code[i])] ?? "";
  return out + "101";
}

/** شريط واحد متصل في النمط: بدايته وعرضه بوحدات النمط (0…95). */
export interface BarRun {
  readonly x: number;
  readonly w: number;
}

/** خطوط EAN-13 أشرطةً متصلة — يرسمها الملصق (SVG في الويب والجوال) والإيصال الحراري (لوحة raster). */
export function ean13Bars(code: string): BarRun[] {
  const m = ean13Modules(code);
  const bars: BarRun[] = [];
  let i = 0;
  while (i < m.length) {
    if (m[i] !== "1") {
      i++;
      continue;
    }
    let j = i;
    while (j < m.length && m[j] === "1") j++;
    bars.push({ x: i, w: j - i });
    i = j;
  }
  return bars;
}

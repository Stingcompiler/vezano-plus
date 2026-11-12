import { describe, expect, it } from "vitest";

import {
  ean13Bars,
  ean13CheckDigit,
  ean13Modules,
  isStoreInternalBarcode,
  isValidEan13,
} from "./barcode";

/** قارئ مستقل للنمط: يعيد الخانات الثلاث عشرة من 95 وحدة — يثبت أن الرسم يُقرأ كما كُتب. */
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
];
const flip = (p: string) => [...p].map((b) => (b === "1" ? "0" : "1")).join("");
const R = L.map(flip);
const G = R.map((p) => [...p].reverse().join(""));
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
];

function decode(m: string): string {
  expect(m).toHaveLength(95);
  expect(m.slice(0, 3)).toBe("101");
  expect(m.slice(45, 50)).toBe("01010");
  expect(m.slice(92)).toBe("101");
  let parity = "";
  let left = "";
  for (let i = 0; i < 6; i++) {
    const chunk = m.slice(3 + i * 7, 10 + i * 7);
    const l = L.indexOf(chunk);
    const g = G.indexOf(chunk);
    expect(l >= 0 || g >= 0).toBe(true);
    parity += l >= 0 ? "L" : "G";
    left += String(l >= 0 ? l : g);
  }
  let right = "";
  for (let i = 0; i < 6; i++) right += String(R.indexOf(m.slice(50 + i * 7, 57 + i * 7)));
  return String(PARITY.indexOf(parity)) + left + right;
}

describe("EAN-13 (0005 §٢٦٩)", () => {
  it("خانة التحقق تطابق مثال GS1 والخادم", () => {
    expect(ean13CheckDigit("400638133393")).toBe(1);
    expect(ean13CheckDigit("200000000001")).toBe(5); // = services.internal_barcode(1)
    expect(ean13CheckDigit("200000000002")).toBe(2);
    expect(isValidEan13("4006381333931")).toBe(true);
    expect(isValidEan13("2000000000015")).toBe(true);
    expect(isValidEan13("2000000000016")).toBe(false);
    expect(isValidEan13("6291041500213")).toBe(true); // مثال إطار CAT-02
    expect(() => ean13CheckDigit("12")).toThrow();
  });

  it("باركود المتجر 20–29 بثلاث عشرة خانة فقط", () => {
    expect(isStoreInternalBarcode("2000000000015")).toBe(true);
    expect(isStoreInternalBarcode("2512345000013")).toBe(true);
    expect(isStoreInternalBarcode("6291000000142")).toBe(false);
    expect(isStoreInternalBarcode("200123")).toBe(false);
  });

  it("النمط 95 وحدة ويُقرأ كما كُتب", () => {
    for (const code of [
      "4006381333931",
      "2000000000015",
      "2000000000046",
      "6291041500213",
      "0012345678905",
      "9780201379624",
    ]) {
      expect(isValidEan13(code)).toBe(true);
      expect(decode(ean13Modules(code))).toBe(code);
    }
    expect(() => ean13Modules("2000000000016")).toThrow();
  });

  it("الأشرطة المتصلة تعيد النمط نفسه", () => {
    const code = "2000000000015";
    const m = ean13Modules(code);
    const rebuilt = Array.from({ length: 95 }, () => "0");
    for (const b of ean13Bars(code)) for (let k = 0; k < b.w; k++) rebuilt[b.x + k] = "1";
    expect(rebuilt.join("")).toBe(m);
    expect(ean13Bars(code)[0]).toEqual({ x: 0, w: 1 });
  });
});

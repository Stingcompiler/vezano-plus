import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * تغطية الحروف بعد الاقتطاع (0005 §٢٠٣ — «ادرس تقليل حجم الخطوط»): كل حرف في نصوص الواجهة يغطيه المصدر
 * الكامل (fonts/source/) يجب أن يغطيه الملف المقتطع (fonts/) — لا يسقط حرف تستعمله الواجهة بالاقتطاع.
 * الـwoff2 تُولَّد من الـttf المقتطعة نفسها (scripts/subset-fonts.sh) فتغطيتها واحدة.
 */
const root = resolve(import.meta.dirname, "../../..");
const fonts = resolve(import.meta.dirname, "../fonts");

/** جدول cmap من ملف TTF (الصيغتان 4 و12) — بلا اعتماديات. */
function cmap(file: string): Set<number> {
  const b = readFileSync(file);
  const numTables = b.readUInt16BE(4);
  let off = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (b.toString("latin1", rec, rec + 4) === "cmap") off = b.readUInt32BE(rec + 8);
  }
  const out = new Set<number>();
  const n = b.readUInt16BE(off + 2);
  for (let i = 0; i < n; i++) {
    const sub = off + b.readUInt32BE(off + 4 + i * 8 + 4);
    const format = b.readUInt16BE(sub);
    if (format === 4) {
      const segX2 = b.readUInt16BE(sub + 6);
      const ends = sub + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const ranges = deltas + segX2;
      for (let s = 0; s < segX2; s += 2) {
        const end = b.readUInt16BE(ends + s);
        const start = b.readUInt16BE(starts + s);
        const delta = b.readUInt16BE(deltas + s);
        const ro = b.readUInt16BE(ranges + s);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          const gid = ro ? b.readUInt16BE(ranges + s + ro + (c - start) * 2) : (c + delta) & 0xffff;
          if (gid) out.add(c);
        }
      }
    } else if (format === 12) {
      const groups = b.readUInt32BE(sub + 12);
      for (let g = 0; g < groups; g++) {
        const p = sub + 16 + g * 12;
        for (let c = b.readUInt32BE(p); c <= b.readUInt32BE(p + 4); c++) out.add(c);
      }
    }
  }
  return out;
}

/** كل حرف في نصوص الواجهة: الويب والحزم والجوال (حين يوجد). */
function corpus(): Set<number> {
  const dirs = ["apps/web/src", "apps/mobile/src", "packages"].map((d) => join(root, d));
  const chars = new Set<number>();
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      if (n === "node_modules" || n.startsWith(".") || n === "fonts") continue;
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|css)$/.test(n))
        for (const ch of readFileSync(p, "utf8")) chars.add(ch.codePointAt(0)!);
    }
  };
  for (const d of dirs) if (existsSync(d)) walk(d);
  return chars;
}

const used = corpus();
const FILES = [
  "Tajawal-Regular",
  "Tajawal-Medium",
  "Tajawal-Bold",
  "Tajawal-ExtraBold",
  "IBMPlexMono-Regular",
  "IBMPlexMono-Medium",
  "IBMPlexMono-SemiBold",
  "ReemKufi[wght]",
];

describe("تغطية الحروف بعد اقتطاع الخطوط", () => {
  it.each(FILES)("%s: لا حرف مستعمل يغطيه المصدر ويسقطه المقتطع", (name) => {
    const full = cmap(join(fonts, "source", `${name}.ttf`));
    const cut = cmap(join(fonts, `${name}.ttf`));
    const wordmark = name.startsWith("ReemKufi");
    const need = wordmark
      ? new Set([..."فيزانو بلص Vezano Plus"].map((c) => c.codePointAt(0)!))
      : used;
    const dropped = [...need]
      .filter((c) => full.has(c) && !cut.has(c))
      .map((c) => `U+${c.toString(16).toUpperCase().padStart(4, "0")} ${String.fromCodePoint(c)}`);
    expect(dropped).toEqual([]);
  });

  it("Tajawal يغطي العربية كاملة (أسماء الزبائن والأصناف أي حرف) وأرقام Plex اللاتينية", () => {
    const t = cmap(join(fonts, "Tajawal-Regular.ttf"));
    const full = cmap(join(fonts, "source", "Tajawal-Regular.ttf"));
    const arabic = [...full].filter((c) => c >= 0x600 && c <= 0x6ff);
    expect(arabic.filter((c) => !t.has(c))).toEqual([]);
    const mono = cmap(join(fonts, "IBMPlexMono-Regular.ttf"));
    expect([..."0123456789.,:-+%/#"].every((c) => mono.has(c.codePointAt(0)!))).toBe(true);
  });
});

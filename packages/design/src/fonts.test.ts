import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const fontsDir = resolve(import.meta.dirname, "../fonts");
const required = [
  "Tajawal-Regular.ttf",
  "Tajawal-Medium.ttf",
  "Tajawal-Bold.ttf",
  "Tajawal-ExtraBold.ttf",
  "IBMPlexMono-Regular.ttf",
  "IBMPlexMono-Medium.ttf",
  "IBMPlexMono-SemiBold.ttf",
  "ReemKufi[wght].ttf",
  "ReemKufi-Wordmark.woff2",
];

describe("ملفات الخطوط المحلية", () => {
  it("كل ملف يشير إليه fonts.css موجود في packages/design/fonts/", () => {
    const missing = required.filter((f) => !existsSync(resolve(fontsDir, f)));
    expect(missing).toEqual([]);
  });
  it("ثلاث عائلات لا غير: Tajawal وIBM Plex Mono وReem Kufi (0005 §٢٠٣)", () => {
    const stray = readdirSync(fontsDir).filter(
      (f) => /\.(ttf|woff2?|otf)$/.test(f) && !/^(Tajawal|IBMPlexMono|ReemKufi)/.test(f),
    );
    expect(stray).toEqual([]);
    const faces = readFileSync(resolve(import.meta.dirname, "fonts.faces.css"), "utf8");
    const declared = new Set([...faces.matchAll(/font-family:\s*"([^"]+)"/g)].map((m) => m[1]));
    expect([...declared].sort()).toEqual(["IBM Plex Mono", "Reem Kufi Wordmark"]);
  });
  it("قاعدة الأرقام الواحدة: .num وبديلها .sting-mono بـPlex Mono جدولية LTR معزولة", () => {
    const css = readFileSync(resolve(import.meta.dirname, "fonts.css"), "utf8");
    expect(css).toMatch(
      /\.num,\s*\[data-num\],\s*\.sting-mono,\s*\[data-mono\]\s*\{\s*font-family: var\(--font-mono\);\s*font-variant-numeric: tabular-nums;\s*direction: ltr;\s*unicode-bidi: isolate;/,
    );
  });
});

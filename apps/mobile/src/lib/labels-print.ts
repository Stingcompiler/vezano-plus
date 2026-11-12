import { formatMinor } from "@sting/app-core";
import { ean13Bars } from "@sting/domain";
import { chunkPages, type LabelRow } from "@sting/sync-core";

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

function svg(code: string): string {
  const rects = ean13Bars(code)
    .map((b) => `<rect x="${10 + b.x}" y="0" width="${b.w}" height="40"/>`)
    .join("");
  return `<svg class="b" viewBox="0 0 115 40" preserveAspectRatio="none" fill="#000">${rects}</svg>`;
}

/**
 * ورقة ملصقات A4 لطباعة النظام (expo-print) — نظير ورقة CAT-07 في الويب (0005 §٢٧٠): ثلاثة أعمدة
 * وثمانية صفوف (70×37 مم)، هامش صفر، الاسم ثم السعر إن طُلب ثم الخطوط والأرقام لاتينية تحتها.
 */
export function labelsSheetHtml(
  title: string,
  labels: readonly LabelRow[],
  withPrice: boolean,
): string {
  const cell = (r: LabelRow) =>
    `<div class="l"><div class="n">${esc(r.label)}</div>${
      withPrice
        ? `<div class="p"><span class="d">${esc(formatMinor(r.priceMinor))}</span> · ${esc(r.unitName)}</div>`
        : ""
    }${svg(r.barcode)}<div class="d">${esc(r.barcode)}</div></div>`;
  const pages = chunkPages(labels)
    .map((p) => `<div class="pg">${p.map(cell).join("")}</div>`)
    .join("");
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:A4;margin:0}body{margin:0;color:#000;background:#fff;font-family:-apple-system,Roboto,sans-serif}
.pg{display:grid;grid-template-columns:repeat(3,70mm);grid-template-rows:repeat(8,37mm);width:210mm;height:296mm;page-break-after:always;break-after:page}
.pg:last-child{page-break-after:auto;break-after:auto}
.l{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:2mm 3mm;overflow:hidden;text-align:center}
.n{font-size:9pt;font-weight:600;line-height:1.25;max-height:2.5em;overflow:hidden}
.p{font-size:9pt}.b{width:100%;max-width:46mm;height:11mm}
.d{font-family:Menlo,"Roboto Mono",monospace;font-size:8pt;direction:ltr;unicode-bidi:isolate}</style></head>
<body>${pages}</body></html>`;
}

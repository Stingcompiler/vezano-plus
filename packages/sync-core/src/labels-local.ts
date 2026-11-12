/**
 * ملصقات الأصناف (CAT-07؛ 0005 §٢٧٠): ما يُطبع ملصقاً = كل وحدة نشطة تحمل باركود EAN-13 صحيحاً (باركود
 * الصنف لوحدته الأساسية، وباركود كل وحدة لها). السعر سعر الوحدة كما في POS-01 (`catalogRows`). باركود
 * المصنع الذي ليس EAN-13 (Code 128، EAN-8، 12 خانة) لا يُرسم هنا — يُعدّ ويُقال، ولا يُخمَّن.
 */
import { isValidEan13 } from "@sting/domain";

import type { LocalItem } from "./catalog-local";
import { catalogRows } from "./pos-local";

export interface LabelRow {
  readonly key: string;
  readonly itemId: string;
  /** «سكر» أو «سكر — كرتونة». */
  readonly label: string;
  readonly unitName: string;
  readonly barcode: string;
  readonly priceMinor: string;
}

export interface LabelRows {
  readonly rows: LabelRow[];
  /** وحدات تحمل باركوداً ليس EAN-13 — لا تُطبع هنا. */
  readonly skipped: number;
}

export function labelRows(items: readonly LocalItem[]): LabelRows {
  const rows: LabelRow[] = [];
  let skipped = 0;
  for (const r of catalogRows(items.filter((i) => i.is_active))) {
    const code = (
      r.isBase ? r.item.barcode : (r.item.units.find((u) => u.unit_id === r.unitId)?.barcode ?? "")
    ).trim();
    if (!code) continue;
    if (!isValidEan13(code)) {
      skipped++;
      continue;
    }
    rows.push({
      key: r.key,
      itemId: r.item.id,
      label: r.label,
      unitName: r.unitName,
      barcode: code,
      priceMinor: r.unitPriceMinor,
    });
  }
  rows.sort((a, b) => a.label.localeCompare(b.label, "ar"));
  return { rows, skipped };
}

/** النسخ بالترتيب: كل صف مكرَّر بعدده — ما يُرسم على الورقة أو يُرسل للطابعة. */
export function expandLabels<T extends { key: string }>(
  rows: readonly T[],
  counts: Readonly<Record<string, number>>,
): T[] {
  const out: T[] = [];
  for (const r of rows) {
    const n = Math.max(0, Math.min(999, Math.floor(counts[r.key] ?? 0)));
    for (let i = 0; i < n; i++) out.push(r);
  }
  return out;
}

/** ورقة A4 بثلاثة أعمدة وثمانية صفوف (70×37 مم). */
export const LABELS_PER_A4 = 24;

export function chunkPages<T>(labels: readonly T[], size = LABELS_PER_A4): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < labels.length; i += size) pages.push(labels.slice(i, i + size));
  return pages;
}

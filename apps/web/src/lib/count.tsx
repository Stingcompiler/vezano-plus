/**
 * عدد بصيغته العربية الصحيحة (FIX-14 · 0005 §١٨٤): «1 فروع» و«1 صنفاً» خطأ نحوي يظهر في الواجهة.
 * 1 ← المفرد بلا رقم («فرع واحد»)، 2 ← المثنى («فرعان»)، 3–10 ← جمع القلّة، 11+ والصفر ← الجمع
 * التمييزي. الرقم نفسه latin في `.sting-mono` حيث يظهر.
 */
import type { ReactNode } from "react";

export interface CountForms {
  /** المفرد بلا عدد: «فرع واحد» */
  readonly one: string;
  /** المثنى: «فرعان» */
  readonly two: string;
  /** 3–10: «فروع» */
  readonly few: string;
  /** 0 و11+: «فرعاً» (التمييز المنصوب) */
  readonly many: string;
}

export function countText(n: number, f: CountForms): string {
  if (n === 1) return f.one;
  if (n === 2) return f.two;
  return `${n} ${n >= 3 && n <= 10 ? f.few : f.many}`;
}

export function Count({ n, ...forms }: { readonly n: number } & CountForms): ReactNode {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  return (
    <>
      <span className="sting-mono">{n}</span> {n >= 3 && n <= 10 ? forms.few : forms.many}
    </>
  );
}

export const BRANCHES: CountForms = { one: "فرع واحد", two: "فرعان", few: "فروع", many: "فرعاً" };
export const DEVICES: CountForms = {
  one: "جهاز واحد",
  two: "جهازان",
  few: "أجهزة",
  many: "جهازاً",
};
export const ITEMS: CountForms = { one: "صنف واحد", two: "صنفان", few: "أصناف", many: "صنفاً" };
export const GROUPS: CountForms = {
  one: "مجموعة واحدة",
  two: "مجموعتان",
  few: "مجموعات",
  many: "مجموعة",
};
/** بعد «ناقص» (منصوب): «ناقص عمليتين» لا «عمليتان» */
export const MISSING_OPERATIONS: CountForms = {
  one: "عملية واحدة",
  two: "عمليتين",
  few: "عمليات",
  many: "عملية",
};

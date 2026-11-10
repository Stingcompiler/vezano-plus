import type { ReactNode } from "react";

/**
 * جدول سطور السوق (`.pur-lines`). على الهاتف يتمرّر داخل نفسه بعناوين أعمدته بدل أن تُقصّ أعمدته
 * الأخيرة داخل البطاقة (مراجعة 2026-11-10 و-١؛ `market.css`)، ومنطقة التمرير يجب أن تبلغها لوحة
 * المفاتيح لتُمرَّر (WCAG 2.1.1) — لذلك `tabIndex` على عنصر غير تفاعلي هنا وحده.
 */
export function LinesTable({ children }: { children: ReactNode }) {
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- منطقة تمرير تُمرَّر بلوحة المفاتيح
    <table className="pur-lines" tabIndex={0}>
      {children}
    </table>
  );
}

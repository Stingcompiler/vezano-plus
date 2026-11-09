/**
 * C-FILTER — شريط مرشّحات، وسوم مطبّقة، ترقيم صفحات، تحميل المزيد.
 * الوسوم تتراكم من البداية؛ «مسح الكل» في الطرف النهائي؛ Backspace على وسم يحذفه؛
 * كل تغيير يُعلن عدد النتائج الجديد؛ الفلتر النشط معروض مع عدد ما أخفاه (R-10).
 */
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "./Button";

export interface FilterChip {
  readonly key: string;
  readonly label: string;
}

export interface FilterBarProps {
  readonly children?: ReactNode;
  readonly chips: readonly FilterChip[];
  readonly onRemove: (key: string) => void;
  readonly onClearAll: () => void;
  /** عدد النتائج بعد الترشيح — يُعلن في live region. */
  readonly resultCount: number;
  /** عدد ما أخفاه الفلتر — يُعرض مع الفلتر النشط (R-10). */
  readonly hiddenCount?: number | undefined;
  /** نص العدّ من الإطار (يُمرَّر لأن الصياغة العربية للعدد تتبع المعدود). */
  readonly countLabel: (n: number, hidden: number | undefined) => string;
}

export function FilterBar({
  children,
  chips,
  onRemove,
  onClearAll,
  resultCount,
  hiddenCount,
  countLabel,
}: FilterBarProps) {
  return (
    <div className="c-filter">
      {children ? <div className="c-filter__controls">{children}</div> : null}
      {chips.length > 0 ? (
        <ul className="c-filter__chips" aria-label="المرشّحات المطبّقة">
          {chips.map((chip) => (
            <li key={chip.key}>
              <button
                type="button"
                className="c-filter__chip"
                aria-label={`إزالة المرشّح ${chip.label}`}
                onClick={() => onRemove(chip.key)}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" || e.key === "Delete") {
                    e.preventDefault();
                    onRemove(chip.key);
                  }
                }}
              >
                {chip.label}
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
          <li className="c-filter__clear">
            <Button variant="quiet" onClick={onClearAll}>
              مسح الكل
            </Button>
          </li>
        </ul>
      ) : null}
      <p className="c-filter__count" role="status" aria-live="polite">
        {countLabel(resultCount, chips.length ? hiddenCount : undefined)}
      </p>
    </div>
  );
}

export interface PaginationProps {
  readonly page: number;
  readonly pageCount: number;
  readonly onPage: (page: number) => void;
  /** عدد العناصر كلها وحجم الصفحة: يُعرض المدى «1–25 من 312» (0005 §٢٢٨). */
  readonly total?: number | undefined;
  readonly pageSize?: number | undefined;
}

/** أرقام الصفحات الظاهرة: الأولى والأخيرة دائماً، وما حول الحالية، وفجوة «…» بينها. */
export function pageWindow(page: number, pageCount: number): readonly (number | "gap")[] {
  const keep = new Set([1, pageCount, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => keep.add(n));
  if (page >= pageCount - 2)
    [pageCount - 3, pageCount - 2, pageCount - 1].forEach((n) => keep.add(n));
  const nums = [...keep].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  nums.forEach((n, i) => {
    const prev = nums[i - 1];
    if (prev !== undefined && n - prev > 1) out.push("gap");
    out.push(n);
  });
  return out;
}

export function Pagination({ page, pageCount, onPage, total, pageSize }: PaginationProps) {
  if (pageCount <= 1) return null;
  const from = total !== undefined && pageSize ? (page - 1) * pageSize + 1 : undefined;
  const to = from !== undefined && pageSize ? Math.min(page * pageSize, total ?? 0) : undefined;
  return (
    <nav className="c-filter__pagination" aria-label="ترقيم الصفحات">
      {from !== undefined && to !== undefined ? (
        <p className="c-filter__range">
          {/* المدى يُقرأ من اليسار «1–25» داخل سطر عربي — بلا dir يعكسه المتصفح «25–1» */}
          <span className="sting-mono" dir="ltr">
            {from}–{to}
          </span>{" "}
          من <span className="sting-mono">{total}</span>
        </p>
      ) : null}
      <div className="c-filter__pages">
        <Button
          variant="secondary"
          onClick={() => onPage(page - 1)}
          disabledReason={page <= 1 ? "هذه الصفحة الأولى" : undefined}
        >
          السابقة
        </Button>
        <ol className="c-filter__nums">
          {pageWindow(page, pageCount).map((n, i) =>
            n === "gap" ? (
              <li key={`gap-${i}`} className="c-filter__gap" aria-hidden="true">
                …
              </li>
            ) : (
              <li key={n}>
                <button
                  type="button"
                  className={`c-filter__num${n === page ? " c-filter__num--on" : ""}`}
                  aria-current={n === page ? "page" : undefined}
                  aria-label={`الصفحة ${n}`}
                  onClick={() => n !== page && onPage(n)}
                >
                  <span className="sting-mono">{n}</span>
                </button>
              </li>
            ),
          )}
        </ol>
        <Button
          variant="secondary"
          onClick={() => onPage(page + 1)}
          disabledReason={page >= pageCount ? "هذه الصفحة الأخيرة" : undefined}
        >
          التالية
        </Button>
      </div>
    </nav>
  );
}

export interface LoadMoreProps {
  readonly onLoadMore: () => void;
  readonly loading?: boolean | undefined;
  readonly remaining?: number | undefined;
  readonly label?: string;
}

export function LoadMore({
  onLoadMore,
  loading,
  remaining,
  label = "تحميل المزيد",
}: LoadMoreProps) {
  if (remaining === 0) return null;
  return (
    <div className="c-filter__more">
      <Button variant="secondary" onClick={onLoadMore} loading={loading}>
        {label}
        {remaining !== undefined ? (
          <>
            {" "}
            (<span className="sting-mono">{remaining}</span>)
          </>
        ) : null}
      </Button>
    </div>
  );
}

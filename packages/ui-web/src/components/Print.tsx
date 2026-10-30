/**
 * C-PRINT — إيصال 58/80mm، A4، معاينة، إعادة طباعة موسومة «نسخة». الحالات: ready, loading,
 * offline (طباعة محلية متاحة), server_error, permission_denied. الإيصال RTL مع أعمدة مبالغ في
 * النهاية. إعادة الطباعة موسومة «نسخة» في المخرج وفي الإعلان الصوتي. النجاح بعد الحفظ لا بعد
 * الطباعة: فشل الطابعة لا يلغي بيعاً (القاعدة 6). Ctrl+P يفتح المعاينة؛ Enter يطبع.
 */
import { Printer } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";

import { Button } from "./Button";
import { Notice } from "./Notice";

export type PrintOutcome = "idle" | "printing" | "printed" | "failed" | "unknown";

export interface ReceiptLine {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
  readonly strong?: boolean;
}

export interface ReceiptProps {
  readonly shopName: string;
  readonly title: string;
  /** رقم المستند — مستند بلا رقم (افتتاحيات) يُطبع بعنوانه وحده. */
  readonly number?: string | undefined;
  readonly dateLabel: string;
  readonly lines: readonly ReceiptLine[];
  readonly footer?: ReactNode;
  /** إعادة طباعة بنفس الرقم — تُطبع «نسخة» في الرأس. */
  readonly copy?: boolean;
  readonly width?: 58 | 80 | "a4";
}

export function Receipt({
  shopName,
  title,
  number,
  dateLabel,
  lines,
  footer,
  copy = false,
  width = 80,
}: ReceiptProps) {
  return (
    <article
      className={`c-print__receipt c-print__receipt--${width}`}
      aria-label={`${title}${number ? ` ${number}` : ""}${copy ? " نسخة" : ""}`}
    >
      <header className="c-print__head">
        <p className="c-print__shop">{shopName}</p>
        {copy ? <p className="c-print__copy">نسخة</p> : null}
        <p>
          {title}
          {number ? (
            <>
              {" "}
              <span className="sting-mono">#{number}</span>
            </>
          ) : null}
        </p>
        <p className="sting-mono">{dateLabel}</p>
      </header>
      <dl className="c-print__lines">
        {lines.map((l, i) => (
          <div key={i} className={`c-print__line${l.strong ? " c-print__line--strong" : ""}`}>
            <dt>{l.label}</dt>
            <dd className={l.mono ? "sting-mono" : undefined}>{l.value}</dd>
          </div>
        ))}
      </dl>
      {footer ? <footer className="c-print__foot">{footer}</footer> : null}
    </article>
  );
}

export interface PrintDocProps {
  /** اسم المستند في حوار الطباعة واسم ملف PDF (مثل «فاتورة 1042 — متجر النور») بدل عنوان الصفحة. */
  readonly title: string;
  /** «hidden»: لا يُرسم على الشاشة ويظهر في الورقة وحدها (شاشة نتيجة بلا معاينة). */
  readonly screen?: "shown" | "hidden";
  readonly children: ReactNode;
}

/**
 * C-PRINT-DOC — ما يُطبع من الشاشة، ولا شيء سواه: الترويسة والقائمة والإشعارات والأزرار تسقط من
 * الورقة، وهوامش الصفحة صفر فلا يكتب المتصفح فوقها عنوان الصفحة ورابطها (localhost…) وتاريخها.
 * مستند واحد في الشاشة؛ يُطبع بـ`printDocument()` لا بـ`window.print()` مباشرة.
 */
export function PrintDoc({ title, screen = "shown", children }: PrintDocProps) {
  return (
    <div className="c-print-doc" data-print-title={title} data-screen-view={screen}>
      {children}
    </div>
  );
}

/**
 * يطبع مستند الشاشة (`PrintDoc`) باسمه: عنوان الصفحة يصير اسم المستند حتى ينغلق الحوار، فيحمل ملف
 * PDF اسم الفاتورة لا «فيزانو بلص». يُستعاد العنوان عند `afterprint` وحده، لأن `print()` لا يحجب
 * في كل المتصفحات.
 */
export function printDocument(): void {
  const title = document.querySelector<HTMLElement>(".c-print-doc")?.dataset.printTitle;
  if (title) {
    const before = document.title;
    document.title = title;
    window.addEventListener("afterprint", () => (document.title = before), { once: true });
  }
  window.print();
}

export interface PrintControlsProps {
  readonly outcome: PrintOutcome;
  readonly onPrint: () => void;
  readonly onReprint?: (() => void) | undefined;
  readonly onPreview?: (() => void) | undefined;
  /** الطابعة غير مربوطة/غير مدعومة: الزر لا يُعرض وعداً بقدرة لا نملكها (R-09). */
  readonly printerAvailable: boolean;
  readonly unavailableReason?: string | undefined;
  readonly number: string;
}

export function PrintControls({
  outcome,
  onPrint,
  onReprint,
  onPreview,
  printerAvailable,
  unavailableReason,
  number,
}: PrintControlsProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!rootRef.current?.contains(document.activeElement)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p" && onPreview) {
        e.preventDefault();
        onPreview();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onPreview]);
  return (
    <div ref={rootRef} className="c-print" data-outcome={outcome}>
      <div className="c-print__actions">
        {printerAvailable ? (
          <Button
            icon={<Printer size={18} />}
            onClick={onPrint}
            loading={outcome === "printing"}
            disabledReason={outcome === "printed" ? "طُبع — أعد الطباعة كنسخة" : undefined}
          >
            اطبع
          </Button>
        ) : (
          <Button
            icon={<Printer size={18} />}
            onClick={onPrint}
            disabledReason={unavailableReason ?? "لا طابعة مربوطة — اربط طابعة من الإعدادات"}
          >
            اطبع
          </Button>
        )}
        {onReprint ? (
          <Button
            variant="secondary"
            onClick={onReprint}
            disabledReason={outcome === "printing" ? "جارٍ الطباعة" : undefined}
          >
            أعد الطباعة (نسخة)
          </Button>
        ) : null}
        {onPreview ? (
          <Button variant="quiet" onClick={onPreview}>
            معاينة
          </Button>
        ) : null}
      </div>
      {outcome === "failed" ? (
        <Notice kind="warning" title="لم تتأكد الطباعة">
          الفاتورة <span className="sting-mono">{number}</span> مسجَّلة. الطابعة لم تستجب؛ أعد طباعة
          نسخة بنفس الرقم دون تسجيل بيع جديد.
        </Notice>
      ) : null}
      {outcome === "unknown" ? (
        <Notice kind="warning" title="نتيجة الطباعة غير معروفة">
          انقطع الاتصال بعد الإرسال. تحقق من الطابعة قبل إعادة الطباعة حتى لا يتكرر الإيصال للعميل.
        </Notice>
      ) : null}
      <span id={id} className="visually-hidden" aria-live="polite">
        {outcome === "printed"
          ? "طُبع الإيصال"
          : outcome === "failed"
            ? "لم تتأكد الطباعة — البيع مسجَّل"
            : ""}
      </span>
    </div>
  );
}

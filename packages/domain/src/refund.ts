/**
 * قيمة المرتجع ووجهة ردّه (مراجعة 2026-11-22 S-01/S-02؛ 0005 §٢٩٠) — النظير الخادمي
 * `backend/core/refund.py`، والمتجهات المشتركة `vectors/refund.json`.
 *
 * ١. **خصم الفاتورة يُوزَّع على السطور بنسبة قيمها** (`allocateInvoiceDiscount`): نصيب كل سطر
 *    = floor(الخصم × السطر ÷ المجموع)، وما بقي من وحدات صغرى يذهب واحدةً واحدةً لأكبر الكسور
 *    (التعادل للمفتاح الأصغر). كل نصيب بين صفر وقيمة سطره، ومجموعها = الخصم بالضبط.
 * ٢. **قيمة المرتجع تراكمية** (`returnValueCapMinor`): ما يحقّ ردّه لكمية تراكمية c من سطر مُباع
 *    بكمية Q وصافٍ N = round_half_away(N × c ÷ Q). مرتجع q بعد ما رُدّ p يساوي V(p+q) − V(p)،
 *    فمجموع المرتجعات الجزئية لا يتجاوز المدفوع أبداً، والمرتجع الكامل = N بالضبط.
 * ٣. **الوجهة تتبع الدفع الأصلي** (`refundSplit`): الآجل أولاً (تخفيض الذمّة بحدود ما بقي آجلاً
 *    من الفاتورة)، ثم التحويل البنكي بحدود ما دُفع بتحويل، ثم النقد بحدود ما دُفع نقداً — كلٌّ
 *    ناقصاً ما رُدّ منه سابقاً.
 */
import { DomainError, assertInt64, roundHalfAwayDiv } from "./money";

export interface SaleLineAmount {
  /** معرّف السطر — يحسم التعادل بترتيب ثابت على الطرفين. */
  readonly key: string;
  readonly totalMinor: bigint;
}

/** الصافي المدفوع لكل سطر بعد توزيع خصم الفاتورة — بترتيب المدخلات. */
export function allocateInvoiceDiscount(
  lines: readonly SaleLineAmount[],
  discountMinor: bigint,
): bigint[] {
  assertInt64(discountMinor, "discount_minor");
  if (discountMinor < 0n) throw new DomainError("negative_amount", "discount_minor");
  let subtotal = 0n;
  for (const l of lines) {
    assertInt64(l.totalMinor, "line_total_minor");
    if (l.totalMinor < 0n) throw new DomainError("negative_amount", "line_total_minor");
    subtotal += l.totalMinor;
  }
  if (discountMinor > subtotal) throw new DomainError("discount_exceeds_subtotal");
  if (discountMinor === 0n || subtotal === 0n) return lines.map((l) => l.totalMinor);
  const shares = lines.map((l) => (discountMinor * l.totalMinor) / subtotal);
  const rems = lines.map((l, i) => ({
    i,
    key: l.key,
    rem: (discountMinor * l.totalMinor) % subtotal,
  }));
  let remaining = discountMinor - shares.reduce((a, b) => a + b, 0n);
  rems.sort((a, b) =>
    a.rem !== b.rem ? (a.rem > b.rem ? -1 : 1) : a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  for (const r of rems) {
    if (remaining === 0n) break;
    if (r.rem === 0n) continue;
    shares[r.i]! += 1n;
    remaining -= 1n;
  }
  return lines.map((l, i) => l.totalMinor - shares[i]!);
}

/** V(c): ما يحقّ ردّه تراكمياً لكمية c من سطر صافيه N وكميته المباعة Q (c ≤ Q). */
export function returnValueCapMinor(
  netLineMinor: bigint,
  soldQtyMilli: bigint,
  cumulativeQtyMilli: bigint,
): bigint {
  assertInt64(netLineMinor, "net_line_minor");
  if (netLineMinor < 0n) throw new DomainError("negative_amount", "net_line_minor");
  if (soldQtyMilli <= 0n) throw new DomainError("invalid_quantity", "sold_qty_milli");
  if (cumulativeQtyMilli < 0n) throw new DomainError("invalid_quantity", "cumulative_qty_milli");
  if (cumulativeQtyMilli > soldQtyMilli) throw new DomainError("return_exceeds_sale");
  return roundHalfAwayDiv(netLineMinor * cumulativeQtyMilli, soldQtyMilli);
}

/** قيمة ردّ q بعد ما رُدّ p من السطر: V(p+q) − V(p). */
export function returnLineValueMinor(
  netLineMinor: bigint,
  soldQtyMilli: bigint,
  priorQtyMilli: bigint,
  qtyMilli: bigint,
): bigint {
  if (qtyMilli <= 0n) throw new DomainError("invalid_quantity", "qty_milli");
  return (
    returnValueCapMinor(netLineMinor, soldQtyMilli, priorQtyMilli + qtyMilli) -
    returnValueCapMinor(netLineMinor, soldQtyMilli, priorQtyMilli)
  );
}

export interface RefundChannels {
  readonly creditMinor: bigint;
  readonly bankMinor: bigint;
  readonly cashMinor: bigint;
}

const left = (paid: bigint, refunded: bigint) => (paid > refunded ? paid - refunded : 0n);

/**
 * يوزّع قيمة المرتجع على وجهات الدفع الأصلي: الآجل ← التحويل ← النقد، كلٌّ بحدود ما بقي منه.
 * قيمة تتجاوز ما بقي مدفوعاً كله → `refund_exceeds_paid`.
 */
export function refundSplit(
  totalMinor: bigint,
  paid: RefundChannels,
  refunded: RefundChannels,
): RefundChannels {
  assertInt64(totalMinor, "total_minor");
  if (totalMinor < 0n) throw new DomainError("negative_amount", "total_minor");
  for (const c of [paid, refunded])
    if (c.creditMinor < 0n || c.bankMinor < 0n || c.cashMinor < 0n)
      throw new DomainError("negative_amount", "channel");
  const credit = left(paid.creditMinor, refunded.creditMinor);
  const bank = left(paid.bankMinor, refunded.bankMinor);
  const cash = left(paid.cashMinor, refunded.cashMinor);
  if (totalMinor > credit + bank + cash) throw new DomainError("refund_exceeds_paid");
  const creditMinor = totalMinor < credit ? totalMinor : credit;
  const rest = totalMinor - creditMinor;
  const bankMinor = rest < bank ? rest : bank;
  return { creditMinor, bankMinor, cashMinor: rest - bankMinor };
}

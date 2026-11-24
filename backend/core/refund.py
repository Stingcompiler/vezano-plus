"""قيمة المرتجع ووجهة ردّه — النظير الخادمي لـ packages/domain/src/refund.ts (0005 §٢٩٠).

نفس القواعد حرفاً، ويثبت التطابق ملف packages/domain/vectors/refund.json عبر
core/tests/test_refund_vectors.py:

١. خصم الفاتورة يُوزَّع على السطور بنسبة قيمها: floor ثم أكبر الكسور (التعادل للمفتاح الأصغر).
٢. قيمة المرتجع تراكمية: V(c) = round_half_away(N × c ÷ Q)، ومرتجع q بعد p = V(p+q) − V(p).
٣. الوجهة تتبع الدفع الأصلي: الآجل ← التحويل ← النقد، كلٌّ بحدود ما بقي منه.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from core.money import DomainError, assert_int64, round_half_away_div


@dataclass(frozen=True)
class SaleLineAmount:
    key: str
    total_minor: int


def allocate_invoice_discount(lines: Sequence[SaleLineAmount], discount_minor: int) -> list[int]:
    """الصافي المدفوع لكل سطر بعد توزيع خصم الفاتورة — بترتيب المدخلات."""
    assert_int64(discount_minor, "discount_minor")
    if discount_minor < 0:
        raise DomainError("negative_amount", "discount_minor")
    subtotal = 0
    for ln in lines:
        assert_int64(ln.total_minor, "line_total_minor")
        if ln.total_minor < 0:
            raise DomainError("negative_amount", "line_total_minor")
        subtotal += ln.total_minor
    if discount_minor > subtotal:
        raise DomainError("discount_exceeds_subtotal")
    if discount_minor == 0 or subtotal == 0:
        return [ln.total_minor for ln in lines]
    shares = [discount_minor * ln.total_minor // subtotal for ln in lines]
    rems = sorted(
        ((discount_minor * ln.total_minor % subtotal, ln.key, i) for i, ln in enumerate(lines)),
        key=lambda r: (-r[0], r[1]),
    )
    left = discount_minor - sum(shares)
    for rem, _key, i in rems:
        if left == 0:
            break
        if rem == 0:
            continue
        shares[i] += 1
        left -= 1
    return [ln.total_minor - shares[i] for i, ln in enumerate(lines)]


def return_value_cap_minor(
    net_line_minor: int, sold_qty_milli: int, cumulative_qty_milli: int
) -> int:
    """V(c): ما يحقّ ردّه تراكمياً لكمية c من سطر صافيه N وكميته المباعة Q (c ≤ Q)."""
    assert_int64(net_line_minor, "net_line_minor")
    if net_line_minor < 0:
        raise DomainError("negative_amount", "net_line_minor")
    if sold_qty_milli <= 0:
        raise DomainError("invalid_quantity", "sold_qty_milli")
    if cumulative_qty_milli < 0:
        raise DomainError("invalid_quantity", "cumulative_qty_milli")
    if cumulative_qty_milli > sold_qty_milli:
        raise DomainError("return_exceeds_sale")
    return round_half_away_div(net_line_minor * cumulative_qty_milli, sold_qty_milli)


def return_line_value_minor(
    net_line_minor: int, sold_qty_milli: int, prior_qty_milli: int, qty_milli: int
) -> int:
    """قيمة ردّ q بعد ما رُدّ p من السطر: V(p+q) − V(p)."""
    if qty_milli <= 0:
        raise DomainError("invalid_quantity", "qty_milli")
    return return_value_cap_minor(
        net_line_minor, sold_qty_milli, prior_qty_milli + qty_milli
    ) - return_value_cap_minor(net_line_minor, sold_qty_milli, prior_qty_milli)


@dataclass(frozen=True)
class RefundChannels:
    credit_minor: int
    bank_minor: int
    cash_minor: int


def _left(paid: int, refunded: int) -> int:
    return paid - refunded if paid > refunded else 0


def refund_split(
    total_minor: int, paid: RefundChannels, refunded: RefundChannels
) -> RefundChannels:
    """يوزّع قيمة المرتجع على وجهات الدفع الأصلي: الآجل ← التحويل ← النقد، كلٌّ بحدود ما بقي منه.
    قيمة تتجاوز ما بقي مدفوعاً كله → `refund_exceeds_paid`."""
    assert_int64(total_minor, "total_minor")
    if total_minor < 0:
        raise DomainError("negative_amount", "total_minor")
    for c in (paid, refunded):
        if c.credit_minor < 0 or c.bank_minor < 0 or c.cash_minor < 0:
            raise DomainError("negative_amount", "channel")
    credit = _left(paid.credit_minor, refunded.credit_minor)
    bank = _left(paid.bank_minor, refunded.bank_minor)
    cash = _left(paid.cash_minor, refunded.cash_minor)
    if total_minor > credit + bank + cash:
        raise DomainError("refund_exceeds_paid")
    credit_part = min(total_minor, credit)
    rest = total_minor - credit_part
    bank_part = min(rest, bank)
    return RefundChannels(
        credit_minor=credit_part, bank_minor=bank_part, cash_minor=rest - bank_part
    )

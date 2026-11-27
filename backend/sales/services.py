"""خدمات البيع: سقوف الخصم بحسب الدور (مصفوفة ORG-02 عبر `core.permissions`) وتطبيق حدث تجاوز
الخصم."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from core.models import User
from sales.models import DiscountOverride
from sync.appliers import BusinessConflict


@dataclass(frozen=True)
class DiscountCaps:
    """حدّ العملية وحدّ اليوم بالوحدة الصغرى ونسبة مئوية؛ صفر = بلا حدّ (المالك). `forbidden` =
    «لا» في المصفوفة: لا خصم أصلاً."""

    per_op_minor: int
    daily_minor: int
    percent: int
    forbidden: bool = False


#: «القيم تجريبية — تُضبط في ORG-02 مصفوفة الأدوار» (03-D2 POS-03؛ G-09)
DISCOUNT_CAPS: dict[str, DiscountCaps] = {
    "owner": DiscountCaps(0, 0, 0),
    "manager": DiscountCaps(per_op_minor=50000, daily_minor=250000, percent=25),
    "cashier": DiscountCaps(per_op_minor=1000, daily_minor=5000, percent=10),
}
DEFAULT_CAPS = DISCOUNT_CAPS["cashier"]
#: «لا» = لا خصم (مراجعة 2026-11-22 O-02؛ 0005 §٢٩٢). الحدود 0.01 لا 0: الصفر «بلا حد» عند نسخ
#: التطبيق التي لا تعرف `forbidden` بعد، فتبقى مانعةً لا مفتوحة.
FORBIDDEN_CAPS = DiscountCaps(per_op_minor=1, daily_minor=1, percent=1, forbidden=True)

#: «المستخدَم اليوم» — مجموع خصومات المستخدم اليوم؛ تسجّله POS-05 من مبيعاته (حتى ذلك الحين صفر)
DISCOUNT_USAGE_PROVIDERS: list[Callable[[uuid.UUID], int]] = []


def caps_for(role_code: str, is_owner: bool) -> DiscountCaps:
    """سقف الخصم من مصفوفة الأدوار (ORG-02 · «خصم وتجاوز سعر») عبر `core.permissions`: «بلا حد»
    و«نعم» بلا حدّ؛ «لا» لا خصم؛ «حد مالي» حدّ العملية (أو اليوم إن حُرِّر «يومياً»). النسبة والحدّ
    الآخر يبقيان قيماً تجريبية حتى تُحرَّر في المصفوفة."""
    from core import permissions

    d = permissions.decide(role_code, is_owner, "discount")
    if d.unrestricted:
        return DISCOUNT_CAPS["owner"]
    # حدّ صفر = لا خصم (الصفر في السقوف يعني «بلا حد» فلا يُرسَل كذلك)
    if not d.allowed or (d.value == "limit" and not d.limit_minor):
        return FORBIDDEN_CAPS
    base = DISCOUNT_CAPS.get(role_code, DEFAULT_CAPS)
    if d.value == "limit" and d.limit_minor is not None:
        if d.period == "daily":
            return DiscountCaps(base.per_op_minor, d.limit_minor, base.percent)
        return DiscountCaps(d.limit_minor, base.daily_minor, base.percent)
    return base


def used_today_minor(user_id: uuid.UUID) -> int:
    return sum(p(user_id) for p in DISCOUNT_USAGE_PROVIDERS)


def caps_payload(role_code: str, is_owner: bool, user_id: uuid.UUID) -> dict[str, Any]:
    c = caps_for(role_code, is_owner)
    return {
        "per_op_minor": str(c.per_op_minor),
        "daily_minor": str(c.daily_minor),
        "percent": c.percent,
        "used_today_minor": str(used_today_minor(user_id)),
        "forbidden": c.forbidden,
    }


def apply_discount_override(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    if DiscountOverride.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    actor = User.unscoped.filter(id=actor_user_id).first()
    occurred = parse_datetime(str(payload.get("occurred_at", ""))) or timezone.now()
    if not timezone.is_aware(occurred):
        occurred = timezone.make_aware(occurred)
    branch_id = uuid.UUID(str(payload["branch_id"]))
    discount = discount_minor_of(payload)
    decision = _pin_decision(
        tenant_id, "discount", payload, actor_user_id, branch_id, discount, occurred
    )
    DiscountOverride.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        branch_id=branch_id,
        device_id=device_id,
        requested_by_user_id=actor_user_id,
        requested_by_name=actor.display_name if actor else "",
        mode=str(payload["mode"]),
        value=str(payload["value"]),
        cap=str(payload.get("cap", "")),
        reason=str(payload.get("reason", "")).strip(),
        cart_total_minor=int(payload.get("cart_total_minor", 0)),
        discount_minor=discount,
        occurred_at=occurred,
        **decision,
    )


def discount_minor_of(payload: Mapping[str, Any]) -> int:
    """قيمة الخصم المطلوب: ما حسبه الجهاز، وإلا المبلغ نفسه أو النسبة من المجموع (نصف بعيداً)."""
    raw = payload.get("discount_minor")
    if raw not in (None, ""):
        return int(str(raw))
    value = int(str(payload["value"]))
    if payload["mode"] == "amount":
        return value
    total = int(payload.get("cart_total_minor", 0) or 0)
    q, r = divmod(total * value, 100)
    return q + (1 if r * 2 >= 100 else 0)


def _pin_decision(
    tenant_id: uuid.UUID,
    kind: str,
    payload: Mapping[str, Any],
    requester_id: uuid.UUID,
    branch_id: uuid.UUID,
    amount: int,
    occurred: Any,
) -> dict[str, Any]:
    """اعتماد مدير حاضر برمزه (0005 §٢٩٣): يُفحص الآن ويُسجَّل معتمداً باسمه، وإلا تُحجر العملية."""
    if payload.get("approval_method") != "pin":
        return {}
    from core import approvals

    approvals.check_pin_approval(
        tenant_id=tenant_id,
        kind=kind,
        approver_id=payload.get("approved_by_user_id"),
        requester_id=requester_id,
        branch_id=branch_id,
        amount=amount,
        verifier_version=payload.get("verifier_version"),
        occurred_at=payload.get("occurred_at"),
    )
    approver_id = uuid.UUID(str(payload["approved_by_user_id"]))
    return {
        "status": "approved",
        "decided_by_user_id": approver_id,
        "decided_by_name": approvals.approver_name(approver_id),
        "decided_at": occurred,
        "approved_via": "pin",
    }


# ---------------------------------------------------------------- إسقاط البيع (T1.16)


def _dt(value: Any) -> Any:
    parsed = parse_datetime(str(value)) if value else None
    if parsed is None:
        return timezone.now()
    return parsed if timezone.is_aware(parsed) else timezone.make_aware(parsed)


def _caps_in_branch(user: User | None, branch_id: uuid.UUID) -> DiscountCaps:
    from core.models import UserBranchAccess

    access = (
        UserBranchAccess.unscoped.filter(user=user, branch_id=branch_id, revoked_at__isnull=True)
        .select_related("role")
        .first()
        if user
        else None
    )
    return caps_for(access.role.code if access else "", bool(user and user.is_owner))


def _exceeds_discount_cap(
    seller: User | None, uploader: User | None, branch_id: uuid.UUID, discount: int, subtotal: int
) -> bool:
    """يقيس الخصم بسقف الدور في فرع البيع (حدّ العملية والنسبة؛ صفر = بلا حدّ). الرفض ليس
    المطلوب دون اتصال (0005 §٧.٤)، والمطلوب أن يكتشف الخادم التجاوز (مراجعة 2026-11-05 بند ٣).

    البائع من الحمولة وصاحب الجلسة الرافعة قد يختلفان (جهاز مشترك يرفع عمل زميل)، فيُقاس الخصم
    بسقف كليهما ويُوسم إن تجاوز أيّهما: كاشير ينسب بيعه إلى المالك في حمولة مُعدّة لا يستعير
    سقفه (مراجعة 2026-11-10 ع-٢). ثمن ذلك أن خصم المالك الذي يرفعه كاشير يُوسم للمراجعة."""
    if discount <= 0:
        return False
    people = [seller] if uploader is None or uploader == seller else [seller, uploader]
    for person in people:
        caps = _caps_in_branch(person, branch_id)
        if caps.forbidden:
            return True
        if caps.per_op_minor and discount > caps.per_op_minor:
            return True
        if caps.percent and discount * 100 > subtotal * caps.percent:
            return True
    return False


def apply_sale(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    """رأس البيع (متكرّر الأثر)؛ السطور والدفعات أعضاء منفصلة تصل بمُطبِّقاتها في العملية نفسها."""
    from sales.models import Sale

    if Sale.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    user = User.unscoped.filter(id=payload["user_id"]).first()
    branch_id = uuid.UUID(str(payload["branch_id"]))
    discount = int(payload.get("discount_minor", 0) or 0)
    Sale.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        branch_id=branch_id,
        device_id=device_id,
        shift_id=uuid.UUID(str(payload["shift_id"])) if payload.get("shift_id") else None,
        user_id=uuid.UUID(str(payload["user_id"])),
        user_name=user.display_name if user else "",
        party_id=uuid.UUID(str(payload["party_id"])) if payload.get("party_id") else None,
        invoice_number=str(payload["invoice_number"]),
        subtotal_minor=int(payload["subtotal_minor"]),
        discount_mode=str(payload.get("discount_mode", "") or ""),
        discount_value=str(payload.get("discount_value", "") or ""),
        discount_minor=discount,
        discount_reason=str(payload.get("discount_reason", "") or ""),
        exceeds_discount_cap=_exceeds_discount_cap(
            user,
            User.unscoped.filter(id=actor_user_id).first(),
            branch_id,
            discount,
            int(payload["subtotal_minor"]),
        ),
        total_minor=int(payload["total_minor"]),
        business_date=parse_date(str(payload["business_date"])) or timezone.localdate(),
        occurred_at=_dt(payload.get("occurred_at")),
    )


def apply_sale_line(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    from sales.models import Sale, SaleLine

    if SaleLine.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    sale = Sale.unscoped.filter(tenant_id=tenant_id, id=payload["sale_id"]).first()
    if sale is None:
        return
    SaleLine.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        sale=sale,
        item_id=uuid.UUID(str(payload["item_id"])),
        item_name=str(payload.get("item_name", "")),
        unit_id=uuid.UUID(str(payload["unit_id"])),
        unit_code=str(payload.get("unit_code", "")),
        factor_milli=int(payload["factor_milli"]),
        qty_milli=int(payload["qty_milli"]),
        unit_price_minor=int(payload["unit_price_minor"]),
        line_total_minor=int(payload["line_total_minor"]),
        manual_price=bool(payload.get("manual_price", False)),
        sort_order=int(payload.get("sort_order", 0) or 0),
    )


def apply_payment(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    from sales.models import Payment, Sale

    if Payment.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    sale = Sale.unscoped.filter(tenant_id=tenant_id, id=payload["sale_id"]).first()
    if sale is None:
        return
    amount = int(payload["amount_minor"])
    method = str(payload["method"])
    Payment.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        sale=sale,
        method=method,
        amount_minor=amount,
        received_minor=int(payload["received_minor"]) if payload.get("received_minor") else None,
        change_minor=int(payload["change_minor"]) if payload.get("change_minor") else None,
        reference=str(payload.get("reference", "") or ""),
    )
    # مجاميع التسوية على الرأس (§٧.٤: النقد وحده يدخل الصندوق)
    field = {"cash": "cash_minor", "bank": "bank_minor", "credit": "credit_minor"}[method]
    setattr(sale, field, getattr(sale, field) + amount)
    sale.save(update_fields=[field])


def apply_credit_override(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    from sales.models import CreditOverride

    if CreditOverride.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    actor = User.unscoped.filter(id=actor_user_id).first()
    branch_id = uuid.UUID(str(payload["branch_id"]))
    occurred = _dt(payload.get("occurred_at"))
    limit = int(payload["credit_limit_minor"])
    after = int(payload["balance_after_minor"])
    decision = _pin_decision(
        tenant_id, "credit", payload, actor_user_id, branch_id, after - limit, occurred
    )
    CreditOverride.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        sale_id=uuid.UUID(str(payload["sale_id"])),
        party_id=uuid.UUID(str(payload["party_id"])),
        branch_id=branch_id,
        device_id=device_id,
        requested_by_user_id=actor_user_id,
        requested_by_name=actor.display_name if actor else "",
        credit_limit_minor=limit,
        balance_after_minor=after,
        reason=str(payload["reason"]).strip(),
        occurred_at=occurred,
        **decision,
    )


# ---------------------------------------------------------------- المرتجع (T1.20؛ POS-10)

#: قرار المالك في SYS-03 بقبول مرتجع تجاوز أصله — داخله يُطبَّق المرتجع موسوماً بدل أن يُحجر
_accepting_exceeding_return: ContextVar[bool] = ContextVar(
    "accepting_exceeding_return", default=False
)


@contextmanager
def accepting_exceeding_return() -> Iterator[None]:
    token = _accepting_exceeding_return.set(True)
    try:
        yield
    finally:
        _accepting_exceeding_return.reset(token)


def _return_parts_expected(sale: Any, total: int) -> tuple[int, int, int]:
    """(آجل، تحويل، نقد) كما يجب أن يُردّ المرتجع: من الدفع الأصلي ناقصاً ما رُدّ سابقاً من كل وجهة —
    الآجل أولاً ثم التحويل ثم النقد (0005 §٢٩٠؛ `core/refund.py`)."""
    from django.db.models import Sum

    from core.money import DomainError
    from core.refund import RefundChannels, refund_split
    from sales.models import SaleReturn

    prior = SaleReturn.unscoped.filter(tenant_id=sale.tenant_id, sale=sale).aggregate(
        credit=Sum("credit_minor"), bank=Sum("bank_minor"), cash=Sum("cash_minor")
    )
    try:
        split = refund_split(
            total,
            RefundChannels(sale.credit_minor, sale.bank_minor, sale.cash_minor),
            RefundChannels(
                int(prior["credit"] or 0), int(prior["bank"] or 0), int(prior["cash"] or 0)
            ),
        )
    except DomainError as e:
        # قيمة تتجاوز ما بقي مدفوعاً من الفاتورة كلها: تجاوزٌ للأصل يقرّره المالك (SYS-03)
        raise BusinessConflict("return_exceeds_sale", str(sale.id)) from e
    return split.credit_minor, split.bank_minor, split.cash_minor


def apply_sale_return(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    """رأس المرتجع: مستند مستقل يشير إلى أصله (ACC-09). وجهة الردّ تتبع الدفع الأصلي — الآجل يُخصم من
    الذمّة أولاً، ثم التحويل، ثم النقد (0005 §٢٩٠): وجهة لا تطابق ذلك، أو مرتجع على فاتورة ألغاها
    مستند عكسي (S-06)، يُحجر تعارضاً قبل أن يمسّ الصندوق أو الذمّة."""
    from sales.models import Sale, SaleReturn, SaleReversal
    from sync.kinds import refund_destination, refund_parts

    if SaleReturn.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    sale = Sale.unscoped.filter(tenant_id=tenant_id, id=payload["sale_id"]).first()
    if sale is None:
        # مرتجع بلا أصل معروف لا يُقبل صامتاً ولا يُسقط: يُحجر بنسخته إلى المراجعة (0005 §١٣٠)
        raise BusinessConflict("return_sale_unknown", str(payload["sale_id"]))
    if SaleReversal.unscoped.filter(tenant_id=tenant_id, sale=sale).exists():
        # الفاتورة ألغاها مستند عكسي أعاد مخزونها ونقدها وذمّتها: مرتجعها يُخرج المال مرتين (S-06)
        raise BusinessConflict("return_sale_reversed", str(sale.id))
    user = User.unscoped.filter(id=payload["user_id"]).first()
    total = int(payload["total_minor"])
    credit, bank, cash = refund_parts(payload)
    if not _accepting_exceeding_return.get():
        expected = _return_parts_expected(sale, total)
        party_ok = credit == 0 or str(payload.get("party_id") or "") == str(sale.party_id or "")
        if (credit, bank, cash) != expected or not party_ok:
            raise BusinessConflict("return_refund_mismatch", str(sale.id))
    SaleReturn.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        sale=sale,
        return_number=str(payload["return_number"]),
        branch_id=uuid.UUID(str(payload["branch_id"])),
        device_id=device_id,
        shift_id=uuid.UUID(str(payload["shift_id"])) if payload.get("shift_id") else None,
        user_id=uuid.UUID(str(payload["user_id"])),
        user_name=user.display_name if user else "",
        party_id=uuid.UUID(str(payload["party_id"])) if payload.get("party_id") else None,
        condition=str(payload["condition"]),
        destination=refund_destination(credit, bank, cash),
        total_minor=total,
        cash_minor=cash,
        bank_minor=bank,
        credit_minor=credit,
        business_date=parse_date(str(payload["business_date"])) or timezone.localdate(),
        occurred_at=_dt(payload.get("occurred_at")),
    )


def return_line_cap_minor(line: Any, net_minor: int, cumulative_qty_milli: int) -> int:
    """ما يحقّ ردّه تراكمياً من السطر لكمية تراكمية (0005 §٢٩٠): نصيبه من صافي الفاتورة
    `V(c) = round(N × c ÷ Q)`. فاتورة بلا خصم تقبل أيضاً الكمية × السعر الذي ترسله الأجهزة القديمة،
    بلا تجاوز قيمة السطر — كما كان السقف قبل التوزيع."""
    from core.money import line_total_minor
    from core.refund import return_value_cap_minor

    c = min(cumulative_qty_milli, line.qty_milli)
    cap = return_value_cap_minor(net_minor, line.qty_milli, c)
    if net_minor == line.line_total_minor:
        cap = min(line.line_total_minor, max(cap, line_total_minor(c, line.unit_price_minor)))
    return cap


def sale_net_lines(sale: Any) -> dict[uuid.UUID, int]:
    """صافي كل سطر بعد توزيع خصم الفاتورة على السطور بنسبة قيمها (`core/refund.py`)."""
    from core.refund import SaleLineAmount, allocate_invoice_discount
    from sales.models import SaleLine

    lines = list(SaleLine.unscoped.filter(tenant_id=sale.tenant_id, sale=sale))
    net = allocate_invoice_discount(
        [SaleLineAmount(str(ln.id), ln.line_total_minor) for ln in lines],
        min(sale.discount_minor, sum(ln.line_total_minor for ln in lines)),
    )
    return {ln.id: n for ln, n in zip(lines, net, strict=True)}


def apply_sale_return_line(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    entity_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> None:
    """سطر المرتجع: السقف تراكمي عبر كل مرتجعات الفاتورة (ACC-11)، كميةً وقيمةً مقابل ما دُفع فعلاً
    (0005 §٢٩٠). التجاوز يُحجر تعارضاً ليقرّره المالك في SYS-03؛ قبوله يحفظ الواقعة موسومة
    `exceeds_original` دون تعديل الأصل (§٧.٣)."""
    from django.db.models import Sum

    from sales.models import Sale, SaleLine, SaleReturn, SaleReturnLine

    if SaleReturnLine.unscoped.filter(tenant_id=tenant_id, id=entity_id).exists():
        return
    ret = SaleReturn.unscoped.filter(tenant_id=tenant_id, id=payload["return_id"]).first()
    line = SaleLine.unscoped.filter(tenant_id=tenant_id, id=payload["sale_line_id"]).first()
    if ret is None or line is None or line.sale_id != ret.sale_id:
        raise BusinessConflict("return_line_not_in_sale", str(payload["sale_line_id"]))
    qty = int(payload["qty_milli"])
    total = int(payload["line_total_minor"])
    # الاستحقاق من سطر البيع الأصلي لا مما يرسله الجهاز: الجهاز يأخذ سعر الأصل، فسعر أعلى لا يأتي
    # إلا من طلب مُعدّ — يُحجر قبل أن يمسّ الصندوق (مراجعة 2026-11-05 بند ١)
    if int(payload["unit_price_minor"]) > line.unit_price_minor:
        raise BusinessConflict("return_price_exceeds_sale", str(line.id))
    sums = SaleReturnLine.unscoped.filter(tenant_id=tenant_id, sale_line=line).aggregate(
        q=Sum("qty_milli"), v=Sum("line_total_minor")
    )
    already = sums["q"] or 0
    already_value = sums["v"] or 0
    over_qty = int(already) + qty > line.qty_milli
    # القيمة مقابل ما دُفع لا سعر القائمة: نصيب السطر من صافي الفاتورة بعد خصمها، تراكمياً
    # (مراجعة 2026-11-22 S-01: فاتورة 21,000 بخصم 200 كان مرتجعها الكامل يردّ 21,000)
    sale = Sale.unscoped.get(tenant_id=tenant_id, id=line.sale_id)
    net = sale_net_lines(sale).get(line.id, line.line_total_minor)
    over_value = int(already_value) + total > return_line_cap_minor(line, net, int(already) + qty)
    # تجاوز الأصل تراكمياً (كمية أو قيمة) لا يدخل الصندوق ولا المخزون تلقائياً: يُحجر تعارضاً
    # ليقرّر المالك في SYS-03. كان يُقبل ويُوسم، فمرتجع 5 من فاتورة بوحدة واحدة يُخرج نقد الخمس
    # قبل أي مراجعة (مراجعة 2026-11-10 ع-٦). قبول المالك يطبّقه موسوماً كما كان.
    if (over_qty or over_value) and not _accepting_exceeding_return.get():
        raise BusinessConflict("return_exceeds_sale", str(line.id))
    SaleReturnLine.unscoped.create(
        tenant_id=tenant_id,
        id=entity_id,
        sale_return=ret,
        sale_line=line,
        item_id=uuid.UUID(str(payload["item_id"])),
        factor_milli=int(payload["factor_milli"]),
        qty_milli=qty,
        unit_price_minor=int(payload["unit_price_minor"]),
        line_total_minor=total,
    )
    if (over_qty or over_value) and not ret.exceeds_original:
        ret.exceeds_original = True
        ret.save(update_fields=["exceeds_original"])

"""مساهمات البيع: مُطبِّقات أعضاء عملية `sale` وحدث تجاوز الخصم، ومزوّدو الوحدات الأخرى المنتظرون
للبيع: درج الوردية (نقد البيع)، المستندات المتأخرة، استعمال معاملات الوحدات والأسعار، الخصم
المستخدَم اليوم، آخر بيع للطرف ورصيده الآجل، والرئيسية والبحث."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import datetime
from typing import Any

from django.db.models import Max, Sum
from django.utils import timezone

from catalog import services as catalog_services
from catalog.models import Item
from catalog.prices import PRICE_USAGE_PROVIDERS
from core import approvals, home
from inventory import services as inventory_services
from parties import services as party_services
from parties.models import Party
from sales.duplicates import reversal_payload
from sales.models import CreditOverride, DiscountOverride, Sale, SaleLine, SaleReturn, SaleReversal
from sales.services import (
    DISCOUNT_USAGE_PROVIDERS,
    apply_credit_override,
    apply_discount_override,
    apply_payment,
    apply_sale,
    apply_sale_line,
    apply_sale_return,
    apply_sale_return_line,
)
from shifts import services as shift_services
from shifts.models import Shift
from sync.appliers import register_applier
from sync.reference import register_resolver

register_applier("sales.DiscountOverride", apply_discount_override)
register_applier("sales.Sale", apply_sale)
register_applier("sales.SaleLine", apply_sale_line)
register_applier("sales.Payment", apply_payment)
register_applier("sales.CreditOverride", apply_credit_override)
register_applier("sales.SaleReturn", apply_sale_return)
register_applier("sales.SaleReturnLine", apply_sale_return_line)


def _party_name(party_id: uuid.UUID) -> str:
    p = Party.objects.filter(id=party_id).first()
    return p.name if p else ""


# «طلبات تنتظرك» — الخصم فوق السقف وتجاوز حدّ الائتمان (S-04؛ 0005 §٢٩٣)
approvals.register_source(
    approvals.Source(
        kind="discount",
        model=DiscountOverride,
        branch_of=lambda r: r.branch_id,
        amount_of=lambda r: int(r.discount_minor or (r.value if r.mode == "amount" else 0)),
        requested_at=lambda r: r.occurred_at,
        details=lambda r: {
            "mode": r.mode,
            "value": r.value,
            "cart_total_minor": str(r.cart_total_minor),
        },
    )
)
approvals.register_source(
    approvals.Source(
        kind="credit",
        model=CreditOverride,
        branch_of=lambda r: r.branch_id,
        amount_of=lambda r: int(r.balance_after_minor - r.credit_limit_minor),
        requested_at=lambda r: r.occurred_at,
        details=lambda r: {
            "sale_id": str(r.sale_id),
            "party_name": _party_name(r.party_id),
            "credit_limit_minor": str(r.credit_limit_minor),
            "balance_after_minor": str(r.balance_after_minor),
        },
    )
)


def _shift_cash(shift: Shift) -> dict[str, int]:
    """نقد البيع يدخل درج الوردية (§١٠.٣) — البيع الآجل والتحويل لا. المستند العكسي لتكرار يُخرج
    نقد الفاتورة الملغاة من درج ورديتها (لم يُقبض مرتين)."""
    total = Sale.objects.filter(shift_id=shift.id).aggregate(cash=Sum("cash_minor"))["cash"] or 0
    reversed_cash = (
        Sale.objects.filter(shift_id=shift.id, reversals__isnull=False).aggregate(
            cash=Sum("cash_minor")
        )["cash"]
        or 0
    )
    # المرتجع النقدي يُخرج نقداً من الصندوق (§٧.٢) — حركة الصندوق تُقيَّد لحظتها
    refunds = (
        SaleReturn.objects.filter(shift_id=shift.id).aggregate(cash=Sum("cash_minor"))["cash"] or 0
    )
    return {"cash_sales": int(total) - int(reversed_cash), "cash_refunds": int(refunds)}


def _late_sales(shift: Shift) -> list[shift_services.LateItem]:
    """بيع أو مرتجع نقدي وصل الخادم بعد الإقفال — «وصلت بعد الإغلاق — خارج اللقطة» (SHIFT-05)."""
    if shift.closed_at is None:
        return []
    late_refunds = [
        shift_services.LateItem(
            id=str(r.id),
            number=r.return_number,
            kind="refund",
            signed_amount_minor=-r.cash_minor,
            occurred_at=r.occurred_at,
            received_at=r.received_at,
        )
        for r in SaleReturn.objects.filter(
            shift_id=shift.id, received_at__gt=shift.closed_at, cash_minor__gt=0
        ).order_by("received_at")
    ]
    return late_refunds + [
        shift_services.LateItem(
            id=str(s.id),
            number=s.invoice_number,
            kind="sale",
            signed_amount_minor=s.cash_minor,
            occurred_at=s.occurred_at,
            received_at=s.received_at,
        )
        for s in Sale.objects.filter(
            shift_id=shift.id, received_at__gt=shift.closed_at, cash_minor__gt=0
        ).order_by("received_at")
    ]


shift_services.CASH_EFFECT_PROVIDERS.append(_shift_cash)
shift_services.LATE_DOCUMENT_PROVIDERS.append(_late_sales)

# الكتالوج: سطور البيع بمعامل وحدة (ACC-19) وبسعر (يمنع تراجع دفعة الأسعار)
catalog_services.FACTOR_USAGE_PROVIDERS.append(
    lambda iu: SaleLine.objects.filter(item_id=iu.item_id, unit_id=iu.unit_id).count()
)
catalog_services.ITEM_MOVEMENT_PROVIDERS.append(
    lambda item: SaleLine.objects.filter(item_id=item.id).count()
)


def _price_usage(item: Item, price_minor: int, since: Any) -> int:
    """بيع بهذا السعر منذ وقت الدفعة — يمنع تراجعها (CAT-05)."""
    qs = SaleLine.objects.filter(item_id=item.id, unit_price_minor=price_minor)
    if since:
        qs = qs.filter(sale__occurred_at__gte=since)
    return qs.count()


PRICE_USAGE_PROVIDERS.append(_price_usage)


def _discount_used_today(user_id: uuid.UUID) -> int:
    today = timezone.localdate()
    total = Sale.objects.filter(user_id=user_id, business_date=today).aggregate(
        d=Sum("discount_minor")
    )["d"]
    return int(total or 0)


DISCOUNT_USAGE_PROVIDERS.append(_discount_used_today)


def _party_credit(party: Party) -> int:
    """الآجل من البيع يرفع ذمّة الطرف (§٧.٢) — السداد يخفّضها مع PTY، والعكس لتكرار يُسقطها."""
    ids = party_services.identity_ids(party)
    total = Sale.objects.filter(party_id__in=ids).aggregate(c=Sum("credit_minor"))["c"]
    reversed_credit = Sale.objects.filter(party_id__in=ids, reversals__isnull=False).aggregate(
        c=Sum("credit_minor")
    )["c"]
    # المرتجع خصماً من الذمّة يخفّض الدين (§٧.٢: «مرتجع صالح لتخفيض دين 100 → دائن 100»)
    refunds = SaleReturn.objects.filter(party_id__in=ids).aggregate(c=Sum("credit_minor"))["c"]
    return int(total or 0) - int(reversed_credit or 0) - int(refunds or 0)


def _party_last_sale(party: Party) -> datetime | None:
    stamp: datetime | None = Sale.objects.filter(
        party_id__in=party_services.identity_ids(party)
    ).aggregate(m=Max("occurred_at"))["m"]
    return stamp


def _bulk_party_credit(ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    """نظير `_party_credit` لكل هوية (0005 §٢٨٧) — نفس الاستعلامات مجمّعة بـGROUP BY."""
    sum_by = party_services.sum_by
    total = sum_by(Sale.objects.filter(party_id__in=ids), "party_id", "credit_minor")
    rev = sum_by(
        Sale.objects.filter(party_id__in=ids, reversals__isnull=False), "party_id", "credit_minor"
    )
    refunds = sum_by(SaleReturn.objects.filter(party_id__in=ids), "party_id", "credit_minor")
    keys = set(total) | set(rev) | set(refunds)
    return {k: total.get(k, 0) - rev.get(k, 0) - refunds.get(k, 0) for k in keys}


def _bulk_last_sale(ids: list[uuid.UUID]) -> dict[uuid.UUID, datetime]:
    return {
        row["party_id"]: row["m"]
        for row in Sale.objects.filter(party_id__in=ids)
        .values("party_id")
        .annotate(m=Max("occurred_at"))
        .order_by()
        if row["m"] is not None
    }


party_services.BALANCE_PROVIDERS.append(_party_credit)
party_services.LAST_SALE_PROVIDERS.append(_party_last_sale)
party_services.BULK_BALANCE_PROVIDERS.append(_bulk_party_credit)
party_services.BULK_LAST_SALE_PROVIDERS.append(_bulk_last_sale)
# الافتتاحي قبل أول حركة (PTY-04): البيع حركة
party_services.MOVEMENT_PROVIDERS.append(
    lambda party: Sale.objects.filter(party_id=party.id).exists()
)


#: عنوان بطاقة الرئيسية بالفترة (مراجعة التقارير د-٢ — 0005 §٢٩١): الصافي لا الإجمالي
HOME_SALES_LABELS = {
    "today": "صافي مبيعات اليوم",
    "7d": "صافي مبيعات آخر 7 أيام",
    "month": "صافي مبيعات هذا الشهر",
}


def _home_sales(viewer: home.Viewer, out: dict[str, Any]) -> None:
    """HOME-01: صافي المبيعات للفترة والفرع المختارين — بدالة تقرير المبيعات نفسها فيطابقه حرفياً:
    الملغى بمستند عكسي خارج، والمرتجعات مطروحة (R-01/R-02/R-03 — 0005 §٢٩١). `viewer.branch` هنا
    نطاق الرئيسية (None = كل الفروع)."""
    if not viewer.can_see_finance:
        return
    from sales.reports import parse_range, sales_totals, scoped_sales

    rng = parse_range(out["period"], start=None, end=None)
    sc = scoped_sales(
        viewer=viewer, rng=rng, branch_id=viewer.branch.id if viewer.branch is not None else None
    )
    t = sales_totals(sc)
    out["sales"] = {
        "period": rng.key,
        "start": rng.start.isoformat(),
        "end": rng.end.isoformat(),
        "count": t["invoices"],
        "revenue_minor": t["revenue_minor"],
        "returns_minor": t["returns_minor"],
        "net_minor": t["net_minor"],
    }
    if t["invoices"] == 0 and t["returns_count"] == 0:
        return
    # مؤشر المبيعات (HOME-01): رقم بمصدره ووقته — لا رقم بلا مبيعات (الرئيسية «يومٌ لم يبدأ»)
    branches = sc.sales.values("branch_id").distinct().count()
    out["kpis"].append(
        {
            "key": "sales",
            "label": HOME_SALES_LABELS.get(rng.key, HOME_SALES_LABELS["today"]),
            "value": {"kind": "money", "amount_minor": t["net_minor"], "exponent": 2},
            "scope": viewer.branch.name if viewer.branch is not None else f"من {branches} فروع",
            "note": "",
            "note_kind": "info",
            "as_of": timezone.now().isoformat().replace("+00:00", "Z"),
            "href": "/reports",
            "includes_pending": True,
        }
    )


home.HOME_PROVIDERS.append(_home_sales)


def _search_invoices(viewer: home.Viewer, q: str, out: dict[str, Any]) -> None:
    """HOME-03: الفواتير برقمها في مجموعة «مستندات» — «البحث لا يُظهر ما لا يُفتح»."""
    hits = list(Sale.objects.filter(invoice_number__icontains=q).order_by("-occurred_at")[:5])
    group = next(g for g in out["groups"] if g["kind"] == "documents")
    for s in hits:
        group["results"].append(
            {
                "id": str(s.id),
                "title": s.invoice_number,
                "meta": s.user_name,
                "tag": "بيع",
                "tag_kind": "ok",
                "href": f"/pos/invoices/{s.id}",
            }
        )


home.SEARCH_PROVIDERS.append(_search_invoices)


def _resolve_reversals(
    _tenant_id: uuid.UUID, ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, dict[str, Any]]:
    """المستند العكسي مرجع خادمي يصل الأجهزة في PULL (§٧.٣) — لا يُكتب من الجهاز."""
    return {r.id: reversal_payload(r) for r in SaleReversal.objects.filter(id__in=list(ids))}


register_resolver("sales.SaleReversal", _resolve_reversals)


def _statement_lines(party: Party) -> list[party_services.StatementLine]:
    """سطور الكشف من البيع (PTY-05): الآجل مدين، المرتجع خصماً من الذمّة دائن، البيع النقدي سطر
    معلوماتي «لا أثر آجل»؛ الملغى بمستند عكسي لا يظهر بأثر."""
    out: list[party_services.StatementLine] = []
    reversed_ids = set(SaleReversal.objects.values_list("sale_id", flat=True))
    ids = party_services.identity_ids(party)
    for s in Sale.objects.filter(party_id__in=ids).order_by("occurred_at"):
        if s.id in reversed_ids:
            continue
        credit_part = s.credit_minor
        if credit_part > 0:
            label = (
                "بيع آجل" if s.cash_minor == 0 and s.bank_minor == 0 else "بيع مختلط — الجزء الآجل"
            )
            out.append(
                party_services.StatementLine(
                    doc=s.invoice_number,
                    doc_id=str(s.id),
                    kind="sale",
                    label=label,
                    occurred_at=s.occurred_at,
                    business_date=s.business_date,
                    debit_minor=credit_part,
                    credit_minor=0,
                    branch_id=s.branch_id,
                    party_id=s.party_id,
                )
            )
        else:
            out.append(
                party_services.StatementLine(
                    doc=s.invoice_number,
                    doc_id=str(s.id),
                    kind="sale",
                    label="بيع نقدي — لا أثر آجل",
                    occurred_at=s.occurred_at,
                    business_date=s.business_date,
                    debit_minor=0,
                    credit_minor=0,
                    branch_id=s.branch_id,
                    info=True,
                    party_id=s.party_id,
                )
            )
    for r in SaleReturn.objects.filter(party_id=party.id, credit_minor__gt=0).order_by(
        "occurred_at"
    ):
        out.append(
            party_services.StatementLine(
                doc=r.return_number,
                doc_id=str(r.id),
                kind="return",
                label="مرتجع — خصماً من الذمّة",
                occurred_at=r.occurred_at,
                business_date=r.business_date,
                debit_minor=0,
                credit_minor=r.credit_minor,
                branch_id=r.branch_id,
                party_id=r.party_id,
            )
        )
    return out


party_services.STATEMENT_LINE_PROVIDERS.append(_statement_lines)


# ─── INV-02: مصدر الحركة → المستند والفاعل ───────────────────────────────────


def _sale_sources(ids: list[uuid.UUID]) -> dict[uuid.UUID, tuple[str, str]]:
    return {
        s.id: (s.invoice_number, s.user_name)
        for s in Sale.objects.filter(id__in=ids).only("id", "invoice_number", "user_name")
    }


def _return_sources(ids: list[uuid.UUID]) -> dict[uuid.UUID, tuple[str, str]]:
    return {
        r.id: (r.return_number, r.user_name)
        for r in SaleReturn.objects.filter(id__in=ids).only("id", "return_number", "user_name")
    }


def _reversal_sources(ids: list[uuid.UUID]) -> dict[uuid.UUID, tuple[str, str]]:
    return {
        r.id: (r.sale.invoice_number, r.decided_by_name)
        for r in SaleReversal.objects.filter(id__in=ids).select_related("sale")
    }


inventory_services.MOVEMENT_SOURCE_RESOLVERS["sales.Sale"] = _sale_sources
inventory_services.MOVEMENT_SOURCE_RESOLVERS["sales.SaleReturn"] = _return_sources
inventory_services.MOVEMENT_SOURCE_RESOLVERS["sales.SaleReversal"] = _reversal_sources

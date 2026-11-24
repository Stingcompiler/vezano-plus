"""مساهمات الأطراف: محلّل المراجع وقائمة النسخة المادية، ومُطبِّق حدث الإنشاء السريع."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import Any

from django.utils import timezone

from core import home
from parties.models import OpeningBalance, Party, PaymentReceipt
from parties.services import (
    apply_party_created,
    apply_payment_receipt,
    opening_payload,
    party_figures,
    party_payload,
)
from shifts import services as shift_services
from shifts.models import Shift
from sync.appliers import register_applier
from sync.reference import register_lister, register_resolver


def _resolve(_tenant_id: uuid.UUID, ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, dict[str, Any]]:
    parties = list(Party.objects.filter(id__in=list(ids)))
    figures = party_figures(parties)
    return {p.id: party_payload(p, figures[p.id]) for p in parties}


def _list(_tenant_id: uuid.UUID) -> list[dict[str, Any]]:
    parties = list(Party.objects.order_by("name_normalized"))
    figures = party_figures(parties)  # النسخة المادية كلها باستعلامات ثابتة (0005 §٢٨٧)
    return [
        {"entity": "parties.Party", "id": str(p.id), "payload": party_payload(p, figures[p.id])}
        for p in parties
    ]


def _home_receivables(viewer: home.Viewer, out: dict[str, Any]) -> None:
    """HOME-01 «الذمم»: مجموع ما على الأطراف (الأرصدة الموجبة) وعددهم — لا رقم بلا ذمم. بخلية
    «رؤية ذمم كل العملاء» ونطاقها (0005 §٢٩٢)؛ `viewer.branch` نطاق الرئيسية (None = كل الفروع)."""
    from core.permissions import can
    from parties.services import receivables_visible_ids

    if not can(viewer, "view_receivables"):
        return
    total = 0
    count = 0
    qs = Party.objects.filter(merged_into__isnull=True)
    visible = receivables_visible_ids(viewer)
    if visible is not None:
        qs = qs.filter(id__in=visible)
    figures = party_figures(list(qs))
    for f in figures.values():
        b = f.balance_minor
        if b > 0:
            total += b
            count += 1
    if count == 0:
        return
    out["kpis"].append(
        {
            "key": "receivables",
            "label": "الذمم",
            "value": {"kind": "money", "amount_minor": str(total), "exponent": 2},
            # الذمم للمنشأة كلها (الطرف لا يتبع فرعاً): تحت نطاق فرع يُسمّى نطاقها (0005 §٢٩١)
            "scope": f"{count} طرفاً" if viewer.branch is None else f"{count} طرفاً في المنشأة",
            "note": "",
            "note_kind": "info",
            "as_of": timezone.now().isoformat().replace("+00:00", "Z"),
            "href": "/parties",
        }
    )


def _home_unmatched(viewer: home.Viewer, out: dict[str, Any]) -> None:
    """«قرارات تنتظرك»: تحويلات العملاء المسجَّلة غير المطابقة — الدين باقٍ حتى يطابقها المالك من
    كشف البنك (المرحلة ٤ من مراجعة الأطراف — 0005 §٢٨٦؛ G-04)."""
    if not viewer.is_owner:
        return
    from parties.services import unmatched_transfers

    n = unmatched_transfers()["totals"]["count"]
    if n:
        out["decisions"].append(
            {
                "id": "parties-unmatched",
                "title": home.counted(
                    n,
                    "تحويل ينتظر المطابقة",
                    "تحويلان ينتظران المطابقة",
                    "تحويلات تنتظر المطابقة",
                    "تحويلاً ينتظر المطابقة",
                ),
                "detail": "دين العميل يبقى حتى تطابق التحويل من كشف البنك",
                "action": "طابِق التحويلات",
                "href": "/parties/receipts/matching",
                "severity": "warn",
            }
        )


register_resolver("parties.Party", _resolve)
register_lister("parties", _list)
home.HOME_PROVIDERS.append(_home_receivables)
home.HOME_PROVIDERS.append(_home_unmatched)
register_applier("parties.PartyCreated", apply_party_created)
register_applier("parties.PaymentReceipt", apply_payment_receipt)


def _shift_receipts(shift: Shift) -> dict[str, int]:
    """السداد النقدي يدخل درج الوردية فوراً والردّ النقدي يخرج منه (§١٠.٣) — التحويل لا."""
    from parties.services import effective_receipt

    received = refunded = paid = 0
    for r in PaymentReceipt.objects.filter(shift_id=shift.id):
        e = effective_receipt(r)
        # التصحيح (PTY-09) يغيّر الأثر لا الأصل: عكس أو وسيلة أو مبلغ
        if e.reversed or e.method != "cash":
            continue
        if r.kind == "receipt":
            received += e.amount_minor
        elif r.kind == "payment":
            # الدفع لمورد من الدرج نقدٌ صادر كالسحب (0005 §٢٨٤)
            paid += e.amount_minor
        else:
            refunded += e.amount_minor
    return {
        "cash_debt_receipts": int(received),
        "cash_refunds": int(refunded),
        "cash_withdrawals": int(paid),
    }


def _late_receipts(shift: Shift) -> list[shift_services.LateItem]:
    if shift.closed_at is None:
        return []
    return [
        shift_services.LateItem(
            id=str(r.id),
            number=r.receipt_number,
            kind=r.kind,
            signed_amount_minor=r.amount_minor if r.kind == "receipt" else -r.amount_minor,
            occurred_at=r.occurred_at,
            received_at=r.received_at,
        )
        for r in PaymentReceipt.objects.filter(
            shift_id=shift.id, method="cash", received_at__gt=shift.closed_at
        ).order_by("received_at")
    ]


shift_services.CASH_EFFECT_PROVIDERS.append(_shift_receipts)
shift_services.LATE_DOCUMENT_PROVIDERS.append(_late_receipts)


def _resolve_openings(
    _tenant_id: uuid.UUID, ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, dict[str, Any]]:
    return {ob.id: opening_payload(ob) for ob in OpeningBalance.objects.filter(id__in=list(ids))}


register_resolver("parties.OpeningBalance", _resolve_openings)

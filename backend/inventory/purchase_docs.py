"""PUR-03/PUR-04 — مستند الشراء واعتماده ومرتجع المشتريات (32-D24؛ §٧.٢، §٧.٧، §٧.٩؛ ACC-128).

الاعتماد توقيع على مبلغ: المستند يُعرض بفروقه عن الأمر، ويُعتمد باسمٍ ووقت مرة واحدة بالهوية،
فيتحرّك المخزون (استلام INV-04 بحركاته) وتتحرّك ذمّة المورد (تستحق بعد 30 يوماً)؛ رقم فاتورة المورد
إلزامي والزيادة عن الأمر تحتاج سبباً؛ حدّ الاعتماد من مصفوفة ORG-02 (`purchase_approve`) — فوقه
تُعرض الرقمان والإحالة إلى المالك تُبقي المستند مسوّدة. المرتجع يُبنى على مستند بعينه بسعره، لا
يتجاوز المستلَم ناقص ما رُدّ، بسبب لكل سطر، ويخفّض الذمّة والمخزون معاً — إشعار دائن لا نقد؛ ردّ
المورد الجزئي يُسجَّل نصاً ويبقى المرتجع مفتوحاً بالمرفوض. الاعتماد لا يُلغى — يُعكس بمستند مضادّ.

د-١ (0005 §٢٨٩): الاستلام وحده يُدخل المخزون، والمستند يضيف السعر والذمّة. مستند لمورد له استلام
INV-04 قائم بالأصناف نفسها لا يُعتمد حتى يُربط به («اربط بالاستلام») أو يُقال إنه شحنة أخرى؛
المستند المربوط كمياته من الاستلام واعتماده بلا حركة مخزون. المستند بلا استلام (المالك يعمل وحده)
يُدخل المخزون والذمّة معاً كما كان. أمرٌ مستلَم كاملاً لا يولّد مستنداً ثانياً، والمستند الثاني للأمر
يقترح الباقي وحده. السعر صفر لا يُعتمد إلا «هدية من المورد».
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone

from core import audit, home, permissions
from core.models import User
from core.tenancy import require_tenant
from inventory.models import (
    GoodsReceipt,
    GoodsReceiptLine,
    PurchaseDocument,
    PurchaseDocumentLine,
    PurchaseDocumentReceipt,
    PurchaseOrder,
    PurchaseReturn,
    PurchaseReturnLine,
    QuarantineMovement,
    StockMovement,
)
from inventory.purchasing import OrderRejected, can_create
from inventory.receipt_costs import costed_receipt_lines

#: نافذة البحث عن استلام قائم قبل إنشاء الأمر (أو المستند) — كما في ربط السوق
CANDIDATE_WINDOW_DAYS = 7
LINKED = PurchaseDocumentReceipt.Kind.LINKED
DISTINCT = PurchaseDocumentReceipt.Kind.DISTINCT


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def approval_limit(viewer: home.Viewer) -> int | None:
    """حدّ الاعتماد من المصفوفة: None = بلا حدّ (المالك)؛ 0 = ممنوع."""
    return permissions.limit_of(permissions.can(viewer, "purchase_approve"))


def _doc_number() -> str:
    return str(PurchaseDocument.objects.count() + 1)


def _ret_number() -> str:
    return str(PurchaseReturn.objects.count() + 1)


def _weighted_avg_cost(item_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    """متوسط التكلفة المرجّح لوحدة الأساس (بأجزاء الألف) — للإعلان عن أثر الاعتماد."""
    acc: dict[uuid.UUID, tuple[int, int]] = {}
    for ln in costed_receipt_lines().filter(item_id__in=item_ids, unit_cost_minor__isnull=False):
        if ln.base_qty_milli <= 0 or ln.unit_cost_minor is None:
            continue
        c = ln.unit_cost_minor * 1000 * 1000 // max(int(ln.factor_milli), 1)
        a, q = acc.get(ln.item_id, (0, 0))
        acc[ln.item_id] = (a + c * ln.base_qty_milli, q + ln.base_qty_milli)
    return {i: (a // q if q else 0) for i, (a, q) in acc.items()}


# ------------------------------------------------------------- د-١ ربط المستند بالاستلام القائم


def _supplier_identity(d: PurchaseDocument) -> list[uuid.UUID]:
    from parties.models import Party
    from parties.services import identity_ids

    party = Party.objects.filter(id=d.supplier_id).first()
    return identity_ids(party) if party is not None else [d.supplier_id]


def _claimed_items(receipt_id: uuid.UUID, document_id: uuid.UUID) -> set[uuid.UUID]:
    """أصناف استلامٍ سعّرها مستند آخر مربوط به — الاستلام الواحد قد يغطي أمرين."""
    return set(
        PurchaseDocumentLine.objects.filter(
            document__receipt_links__receipt_id=receipt_id,
            document__receipt_links__kind=LINKED,
        )
        .exclude(document_id=document_id)
        .values_list("item_id", flat=True)
    )


def receipt_candidates(d: PurchaseDocument) -> list[GoodsReceipt]:
    """استلامات INV-04 قد تكون الشحنة نفسها: الفرع والمورد نفسهما، وصنف مشترك لم يسعّره مستند آخر،
    منذ إنشاء الأمر بنافذة أسبوع، ولم يُقرَّر فيها لهذا المستند. استلام المستندات (`PD-`) واستلام
    رُبط بشحنة سوق خارجها."""
    if d.status == PurchaseDocument.Status.APPROVED:
        return []
    items = set(d.lines.values_list("item_id", flat=True))
    if not items:
        return []
    from market.models import MarketDocumentLink

    decided = set(d.receipt_links.values_list("receipt_id", flat=True))
    market = set(
        MarketDocumentLink.objects.filter(local_entity="inventory.GoodsReceipt").values_list(
            "local_id", flat=True
        )
    )
    base = d.order.created_at if d.order is not None else d.created_at
    by_supplier = Q(
        occurred_at__gte=base - timedelta(days=CANDIDATE_WINDOW_DAYS),
        purchase_order_id__isnull=True,
    ) & (
        Q(party_id__in=_supplier_identity(d))
        | Q(party_id__isnull=True, supplier_name=d.supplier_name)
    )
    # استلام على أمر بعينه (I-02، 0005 §٢٩٥) مرشّح لمستند ذلك الأمر وحده، بلا نافذة زمنية
    on_order = Q(purchase_order_id=d.order_id) if d.order_id else Q(pk__in=[])
    out: list[GoodsReceipt] = []
    for rc in (
        GoodsReceipt.objects.filter(branch_id=d.branch_id)
        .filter(by_supplier | on_order)
        .exclude(receipt_number__startswith="PD-")
        .exclude(id__in=decided | market)
        .order_by("occurred_at", "id")
    ):
        got = set(rc.lines.values_list("item_id", flat=True))
        if (got & items) - _claimed_items(rc.id, d.id):
            out.append(rc)
    return out


def linked_receipts(d: PurchaseDocument) -> list[GoodsReceipt]:
    return [
        x.receipt
        for x in d.receipt_links.filter(kind=LINKED)
        .select_related("receipt")
        .order_by("decided_at")
    ]


def _lines_total(d: PurchaseDocument) -> int:
    return sum(ln.unit_price_minor * ln.received_qty_milli // 1000 for ln in d.lines.all())


def _apply_linked_quantities(d: PurchaseDocument) -> None:
    """المستند المربوط كمياته ما استُلم فعلاً (بوحدة سطره)؛ صنفٌ لم يُستلم صفر — لا مخزون ولا ذمّة
    لما لم يصل، ويبقى باقيه على الأمر لمستند تالٍ."""
    items = set(d.lines.values_list("item_id", flat=True))
    got: dict[uuid.UUID, int] = {}
    for link in d.receipt_links.filter(kind=LINKED).select_related("receipt"):
        claimed = _claimed_items(link.receipt_id, d.id)
        for rl in link.receipt.lines.all():
            if rl.item_id in items and rl.item_id not in claimed:
                got[rl.item_id] = got.get(rl.item_id, 0) + int(rl.base_qty_milli)
    for ln in d.lines.order_by("line_no"):
        b = got.pop(ln.item_id, 0)
        ln.base_qty_milli = b
        ln.received_qty_milli = b * 1000 // max(int(ln.factor_milli), 1)
        ln.save(update_fields=["base_qty_milli", "received_qty_milli"])
    d.total_minor = _lines_total(d)
    d.save(update_fields=["total_minor", "updated_at"])


def _receipt_brief(rc: GoodsReceipt) -> dict[str, Any]:
    return {
        "receipt_id": str(rc.id),
        "receipt_number": rc.receipt_number,
        "supplier_name": rc.supplier_name,
        "user_name": rc.user_name,
        "occurred_at": _iso(rc.occurred_at),
    }


def link_receipts(
    *,
    actor: User,
    viewer: home.Viewer,
    document: PurchaseDocument,
    link: list[str],
    distinct: list[str],
) -> PurchaseDocument:
    """«اربط بالاستلام» أو «شحنتان مختلفتان» — قرار باسم صاحبه على استلام مرشّح فقط."""
    if not can_create(viewer):
        raise OrderRejected("permission_denied")
    if document.status == PurchaseDocument.Status.APPROVED:
        raise OrderRejected("document_locked")
    candidates = {str(rc.id): rc for rc in receipt_candidates(document)}
    wanted = [(str(r), LINKED) for r in link] + [(str(r), DISTINCT) for r in distinct]
    if not wanted:
        raise OrderRejected("receipt_required", "receipt_id")
    for rid, _kind in wanted:
        if rid not in candidates:
            raise OrderRejected("receipt_not_candidate", "receipt_id", {"receipt_id": rid})
    with transaction.atomic():
        for rid, kind in wanted:
            PurchaseDocumentReceipt.objects.create(
                tenant_id=document.tenant_id,
                document=document,
                receipt=candidates[rid],
                kind=kind,
                decided_by_name=actor.display_name,
            )
        if any(k == LINKED for _r, k in wanted):
            _apply_linked_quantities(document)
    for rid, kind in wanted:
        number = candidates[rid].receipt_number
        audit.record(
            kind=(
                "purchase_document.receipt_linked"
                if kind == LINKED
                else "purchase_document.receipt_distinct"
            ),
            title=(
                f"ربط مستند الشراء {document.number} بالاستلام {number}"
                if kind == LINKED
                else f"الاستلام {number} شحنة غير مستند الشراء {document.number}"
            ),
            actor=actor,
            branch=document.branch,
            detail=(
                "المخزون دخل من الاستلام — الاعتماد لا يُدخله مرة ثانية"
                if kind == LINKED
                else "قرار المستخدم: شحنتان مختلفتان"
            ),
            ref_entity="inventory.PurchaseDocument",
            ref_id=document.id,
        )
    return document


# ------------------------------------------------ I-02 كاملاً: «حوّل إلى مستند شراء» (0005 §٢٩٥)


def _market_receipt_ids() -> set[uuid.UUID]:
    from market.models import MarketDocumentLink

    return set(
        MarketDocumentLink.objects.filter(local_entity="inventory.GoodsReceipt").values_list(
            "local_id", flat=True
        )
    )


def receipt_document(rc: GoodsReceipt) -> PurchaseDocument | None:
    """مستند الشراء المربوط بالاستلام (الأحدث) — أو لا شيء: الاستلام «بلا مستند شراء» بعدُ."""
    link = (
        rc.document_links.filter(kind=LINKED)
        .select_related("document")
        .order_by("-decided_at")
        .first()
    )
    return link.document if link is not None else None


def receipt_payload(
    rc: GoodsReceipt, viewer: home.Viewer, *, market: set[uuid.UUID] | None = None
) -> dict[str, Any]:
    """الاستلام المسجَّل كما كتبه أمين المخزن — بكمياته، وبتكلفته لمن يرى المال وحده — ومستنده إن
    وُجد، وهل يُحوَّل. أمين المخزن يرى ولا يحوّل (الاعتماد توقيع على مبلغ)."""
    from core.models import Unit

    show_value = can_create(viewer)
    names = dict(Unit.objects.values_list("code", "name"))
    doc = receipt_document(rc)
    order = (
        PurchaseOrder.objects.filter(id=rc.purchase_order_id).first()
        if rc.purchase_order_id
        else None
    )
    in_market = rc.id in (market if market is not None else _market_receipt_ids())
    convertible = not rc.receipt_number.startswith("PD-") and not in_market
    return {
        "id": str(rc.id),
        "receipt_number": rc.receipt_number,
        "branch_id": str(rc.branch_id),
        "branch_name": rc.branch.name,
        "supplier_name": rc.supplier_name,
        "party_id": str(rc.party_id) if rc.party_id else "",
        "reference": rc.reference,
        "user_name": rc.user_name,
        "occurred_at": _iso(rc.occurred_at),
        "order_id": str(order.id) if order is not None else "",
        "order_number": order.number if order is not None else "",
        "lines": [
            {
                "id": str(ln.id),
                "item_id": str(ln.item_id),
                "item_name": ln.item_name,
                "unit_code": ln.unit_code,
                "unit_name": names.get(ln.unit_code, ln.unit_code),
                "factor_milli": str(ln.factor_milli),
                "qty_milli": str(ln.qty_milli),
                "base_qty_milli": str(ln.base_qty_milli),
                "unit_cost_minor": (
                    str(ln.unit_cost_minor) if show_value and ln.unit_cost_minor is not None else ""
                ),
            }
            for ln in rc.lines.order_by("id")
        ],
        "document": (
            {
                "id": str(doc.id),
                "number": doc.number,
                "status": doc.status,
                "status_label": PurchaseDocument.Status(doc.status).label,
            }
            if doc is not None
            else None
        ),
        "can_convert": show_value and convertible,
    }


def visible_receipts(viewer: home.Viewer, branch_id: uuid.UUID | None) -> Any:
    """الاستلامات اليدوية (INV-04) للفرع — المالك أي فرع، وغيره فرعه. استلام المستندات (`PD-`)
    خارجها: هو سطر تكلفة المستند لا شحنة."""
    qs = (
        GoodsReceipt.objects.exclude(receipt_number__startswith="PD-")
        .select_related("branch")
        .order_by("-occurred_at", "-id")
    )
    if viewer.is_owner:
        return qs.filter(branch_id=branch_id) if branch_id is not None else qs
    own = viewer.branch.id if viewer.branch is not None else None
    return qs.filter(branch_id=own) if own is not None else qs.none()


def unpriced_receipts(
    viewer: home.Viewer, branch_id: uuid.UUID | None = None
) -> list[GoodsReceipt]:
    """استلامات بلا مستند شراء معتمد ولا مسوّدة مربوطة — دخلت المخزون ولم تدخل الذمّة بعد."""
    market = _market_receipt_ids()
    return [
        rc
        for rc in visible_receipts(viewer, branch_id).exclude(id__in=market)
        if not rc.document_links.filter(kind=LINKED).exists()
    ]


def _supplier_of_receipt(rc: GoodsReceipt) -> Any:
    from parties.models import Party

    party = Party.objects.filter(id=rc.party_id).first() if rc.party_id else None
    if party is None:
        party = Party.objects.filter(
            is_supplier=True, merged_into__isnull=True, name=rc.supplier_name.strip()
        ).first()
    seen: set[uuid.UUID] = set()
    while party is not None and party.merged_into_id is not None and party.id not in seen:
        seen.add(party.id)
        party = Party.objects.filter(id=party.merged_into_id).first()
    return party


def _add_receipt_lines(d: PurchaseDocument, rc: GoodsReceipt) -> None:
    """أصناف في الاستلام ليست في المستند تُضاف سطوراً بلا أمر (بوحدة الاستلام وتكلفته إن كُتبت، وإلا
    آخر سعر شراء) — فما وصل يُسعَّر كله، لا ما طُلب وحده."""
    from core.models import Unit
    from inventory.purchasing import last_purchase_prices

    have = set(d.lines.values_list("item_id", flat=True))
    new = [ln for ln in rc.lines.order_by("id") if ln.item_id not in have]
    if not new:
        return
    names = dict(Unit.objects.values_list("code", "name"))
    prices = last_purchase_prices([ln.item_id for ln in new])
    no = (d.lines.order_by("-line_no").values_list("line_no", flat=True).first() or 0) + 1
    seen: set[uuid.UUID] = set()
    for ln in new:
        if ln.item_id in seen:
            continue
        seen.add(ln.item_id)
        price = (
            int(ln.unit_cost_minor)
            if ln.unit_cost_minor is not None
            else prices.get((ln.item_id, ln.unit_code), 0)
        )
        PurchaseDocumentLine.objects.create(
            tenant_id=d.tenant_id,
            document=d,
            item_id=ln.item_id,
            item_name=ln.item_name,
            unit_code=ln.unit_code,
            unit_name=names.get(ln.unit_code, ln.unit_code),
            factor_milli=ln.factor_milli,
            ordered_qty_milli=0,
            received_qty_milli=ln.qty_milli,
            base_qty_milli=ln.base_qty_milli,
            unit_price_minor=price,
            line_no=no,
        )
        no += 1


def document_from_receipt(
    *, actor: User, viewer: home.Viewer, receipt: GoodsReceipt
) -> PurchaseDocument:
    """«حوّل إلى مستند شراء» (د-١ كاملاً): يفتح المدير استلام أمين المخزن فيصير مستند شراء مربوطاً
    به — يضيف الأسعار ورقم الفاتورة ويعتمد، فترتفع الذمّة ويُحدَّث الأمر **بلا حركة مخزون ثانية**.

    الاستلام على أمر مفتوح يُربط بمسوّدة ذلك الأمر (أو مسوّدة جديدة بباقيه)؛ وإلا مستند بلا أمر
    بمورد الاستلام وأصنافه. الاستلام المربوط سابقاً يعيد مستنده — لا مستند ثانٍ للشحنة نفسها."""
    if not can_create(viewer):
        raise OrderRejected("permission_denied")
    if receipt.receipt_number.startswith("PD-"):
        raise OrderRejected("receipt_is_document")
    if receipt.id in _market_receipt_ids():
        raise OrderRejected("receipt_market")
    existing = receipt_document(receipt)
    if existing is not None:
        return existing
    order = (
        PurchaseOrder.objects.filter(id=receipt.purchase_order_id)
        .exclude(status=PurchaseOrder.Status.CANCELLED)
        .first()
        if receipt.purchase_order_id
        else None
    )
    supplier = None
    if order is None:
        supplier = _supplier_of_receipt(receipt)
        if supplier is None:
            raise OrderRejected("supplier_required", "supplier")
    with transaction.atomic():
        d: PurchaseDocument | None = None
        if order is not None:
            d = order.documents.exclude(status=PurchaseDocument.Status.APPROVED).first()
            if d is None and any(
                ol.base_qty_milli > ol.received_base_qty_milli for ol in order.lines.all()
            ):
                d = draft_from_order(actor=actor, viewer=viewer, order=order)
            if d is None:
                supplier = _supplier_of_receipt(receipt)
        if d is None:
            if supplier is None:
                raise OrderRejected("supplier_required", "supplier")
            d = PurchaseDocument.objects.create(
                tenant_id=require_tenant(),
                number=_doc_number(),
                supplier_id=supplier.id,
                supplier_name=supplier.name,
                branch=receipt.branch,
                created_by_user_id=actor.id,
                created_by_name=actor.display_name,
            )
        _add_receipt_lines(d, receipt)
        PurchaseDocumentReceipt.objects.update_or_create(
            document=d,
            receipt=receipt,
            defaults={
                "tenant_id": d.tenant_id,
                "kind": LINKED,
                "decided_by_name": actor.display_name,
                "decided_at": timezone.now(),
            },
        )
        _apply_linked_quantities(d)
    audit.record(
        kind="purchase_document.from_receipt",
        title=f"حُوّل الاستلام {receipt.receipt_number} إلى مستند الشراء {d.number}",
        actor=actor,
        branch=receipt.branch,
        detail="المخزون دخل من الاستلام — الاعتماد لا يُدخله مرة ثانية",
        ref_entity="inventory.PurchaseDocument",
        ref_id=d.id,
    )
    return d


# ------------------------------------------------------------------------ PUR-03 المستند


def line_payload(ln: PurchaseDocumentLine) -> dict[str, Any]:
    returned = (
        PurchaseReturnLine.objects.filter(document_line=ln).aggregate(s=Sum("qty_milli"))["s"] or 0
    )
    return {
        "id": str(ln.id),
        "item_id": str(ln.item_id),
        "item_name": ln.item_name,
        "unit_code": ln.unit_code,
        "unit_name": ln.unit_name,
        "factor_milli": str(ln.factor_milli),
        "ordered_qty_milli": str(ln.ordered_qty_milli),
        "received_qty_milli": str(ln.received_qty_milli),
        "base_qty_milli": str(ln.base_qty_milli),
        "unit_price_minor": str(ln.unit_price_minor),
        "est_unit_price_minor": str(ln.est_unit_price_minor)
        if ln.est_unit_price_minor is not None
        else "",
        "line_total_minor": str(ln.unit_price_minor * ln.received_qty_milli // 1000),
        "est_total_minor": str(ln.est_unit_price_minor * ln.ordered_qty_milli // 1000)
        if ln.est_unit_price_minor is not None
        else "",
        "excess_reason": ln.excess_reason,
        "is_gift": ln.is_gift,
        "returned_qty_milli": str(int(returned)),
        # الفرق عن الأمر: كمية أو سعر — المستند بلا أمر (من استلام) لا فرق له
        "diff": (
            ""
            if ln.order_line_id is None and ln.ordered_qty_milli == 0
            else "qty"
            if ln.received_qty_milli != ln.ordered_qty_milli
            else (
                "price"
                if ln.est_unit_price_minor is not None
                and ln.unit_price_minor != ln.est_unit_price_minor
                else ""
            )
        ),
        "line_no": ln.line_no,
    }


def document_payload(d: PurchaseDocument, viewer: home.Viewer | None = None) -> dict[str, Any]:
    lines = [line_payload(ln) for ln in d.lines.order_by("line_no")]
    candidates = receipt_candidates(d)
    est_total = sum(int(x["est_total_minor"]) for x in lines if x["est_total_minor"])
    limit = approval_limit(viewer) if viewer is not None else None
    return {
        "id": str(d.id),
        "number": d.number,
        "order_id": str(d.order_id) if d.order_id else "",
        "order_number": d.order.number if d.order is not None else "",
        "supplier_id": str(d.supplier_id),
        "supplier_name": d.supplier_name,
        "branch_id": str(d.branch_id),
        "branch_name": d.branch.name,
        "supplier_invoice_number": d.supplier_invoice_number,
        "status": d.status,
        "status_label": PurchaseDocument.Status(d.status).label,
        "total_minor": str(d.total_minor),
        "order_estimated_minor": str(est_total) if est_total else "",
        "diff_count": sum(1 for x in lines if x["diff"]),
        "due_days": d.due_days,
        "due_at": _iso(d.approved_at + timedelta(days=d.due_days)) if d.approved_at else "",
        "note": d.note,
        "lines": lines,
        "created_by_name": d.created_by_name,
        "created_at": _iso(d.created_at),
        "approved_by_name": d.approved_by_name,
        "approved_at": _iso(d.approved_at),
        "referred_to_name": d.referred_to_name,
        "referred_at": _iso(d.referred_at),
        "receipt_number": d.receipt.receipt_number if d.receipt is not None else "",
        "effects": d.effects or {},
        "linked_receipts": [_receipt_brief(rc) for rc in linked_receipts(d)],
        "receipt_candidates": [_receipt_brief(rc) for rc in candidates],
        "blockers": blockers(d, candidates=candidates),
        "approval": {
            "viewer_name": viewer.user.display_name if viewer is not None else "",
            "limit_minor": str(limit) if limit is not None else "",
            "over_limit": limit is not None and d.total_minor > limit,
            "can_approve": viewer is not None
            and can_create(viewer)
            and (limit is None or d.total_minor <= limit),
        }
        if viewer is not None
        else {},
    }


def blockers(
    d: PurchaseDocument,
    *,
    market: bool = False,
    candidates: list[GoodsReceipt] | None = None,
) -> list[dict[str, Any]]:
    """ما يمنع الاعتماد — الحفظ كمسوّدة متاح دائماً: رقم فاتورة المورد، وزيادة بلا سبب، وسعر صفر
    بلا «هدية» (I-05)، واستلام قائم لم يُقرَّر فيه (I-02). مستند السوق له حارسه (`_duplicate_receipts`)
    وسعره من الشحنة، فلا يمرّ بالمانعَين الأخيرين."""
    out: list[dict[str, Any]] = []
    if not d.supplier_invoice_number.strip():
        out.append({"code": "invoice_number_required", "title": "رقم الفاتورة"})
    for ln in d.lines.all():
        if ln.received_qty_milli > ln.ordered_qty_milli > 0 and not ln.excess_reason.strip():
            out.append(
                {
                    "code": "excess_reason_required",
                    "title": "الزيادة",
                    "line_id": str(ln.id),
                    "item_name": ln.item_name,
                    "received_qty_milli": str(ln.received_qty_milli),
                    "ordered_qty_milli": str(ln.ordered_qty_milli),
                }
            )
        if not market and ln.received_qty_milli > 0 and ln.unit_price_minor == 0 and not ln.is_gift:
            out.append(
                {
                    "code": "price_required",
                    "title": "سعر الوحدة",
                    "line_id": str(ln.id),
                    "item_name": ln.item_name,
                }
            )
    if not market:
        for rc in receipt_candidates(d) if candidates is None else candidates:
            out.append(
                {
                    "code": "receipt_link_required",
                    "title": "الاستلام",
                    "receipt_id": str(rc.id),
                    "receipt_number": rc.receipt_number,
                }
            )
    return out


def draft_from_order(*, actor: User, viewer: home.Viewer, order: PurchaseOrder) -> PurchaseDocument:
    """يبدأ مستنداً من الأمر (أو يعيد مسوّدته القائمة) بالباقي وحده بأسعاره التقديرية (I-01):
    الملغى لا مستند له، والمستلَم كاملاً يعيد مستنده المعتمد الأخير ولا يولّد ثانياً."""
    if not can_create(viewer):
        raise OrderRejected("permission_denied")
    if order.status == PurchaseOrder.Status.CANCELLED:
        raise OrderRejected("order_cancelled")
    existing: PurchaseDocument | None = order.documents.exclude(
        status=PurchaseDocument.Status.APPROVED
    ).first()
    if existing is not None:
        return existing
    remaining = [
        (ol, ol.base_qty_milli - ol.received_base_qty_milli)
        for ol in order.lines.order_by("line_no")
        if ol.base_qty_milli - ol.received_base_qty_milli > 0
    ]
    if not remaining:
        last: PurchaseDocument | None = (
            order.documents.filter(status=PurchaseDocument.Status.APPROVED)
            .order_by("-approved_at")
            .first()
        )
        if last is not None:
            return last
        raise OrderRejected("order_received")
    with transaction.atomic():
        d: PurchaseDocument = PurchaseDocument.objects.create(
            tenant_id=require_tenant(),
            number=_doc_number(),
            order=order,
            supplier_id=order.supplier_id,
            supplier_name=order.supplier_name,
            branch=order.branch,
            created_by_user_id=actor.id,
            created_by_name=actor.display_name,
        )
        total = 0
        for i, (ol, base) in enumerate(remaining, start=1):
            price = ol.est_unit_price_minor or 0
            q = (
                ol.qty_milli
                if ol.received_base_qty_milli == 0
                else base * 1000 // max(int(ol.factor_milli), 1)
            )
            PurchaseDocumentLine.objects.create(
                tenant_id=d.tenant_id,
                document=d,
                order_line=ol,
                item_id=ol.item_id,
                item_name=ol.item_name,
                unit_code=ol.unit_code,
                unit_name=ol.unit_name,
                factor_milli=ol.factor_milli,
                ordered_qty_milli=q,
                received_qty_milli=q,
                base_qty_milli=base,
                unit_price_minor=price,
                est_unit_price_minor=ol.est_unit_price_minor,
                line_no=i,
            )
            total += price * q // 1000
        d.total_minor = total
        d.save(update_fields=["total_minor"])
    return d


def save_draft(
    *,
    actor: User,
    viewer: home.Viewer,
    document: PurchaseDocument,
    supplier_invoice_number: str | None,
    lines: list[dict[str, Any]],
    note: str | None,
) -> PurchaseDocument:
    """يحفظ كما كُتب — الحفظ لا يمنعه نقص؛ الاعتماد وحده يُمنع. العمل لا يضيع لأن ورقةً ناقصة."""
    if not can_create(viewer):
        raise OrderRejected("permission_denied")
    if document.status == PurchaseDocument.Status.APPROVED:
        raise OrderRejected("document_locked")
    with transaction.atomic():
        if supplier_invoice_number is not None:
            document.supplier_invoice_number = supplier_invoice_number.strip()
        if note is not None:
            document.note = note.strip()
        by_id = {str(ln.id): ln for ln in document.lines.all()}
        # المربوط باستلام: الكمية ما استُلم ولا تُكتب هنا (د-١)
        linked = document.receipt_links.filter(kind=LINKED).exists()
        for raw in lines:
            ln = by_id.get(str(raw.get("id", "")))
            if ln is None:
                continue
            try:
                qty = int(str(raw.get("received_qty_milli", ln.received_qty_milli)))
                price = int(str(raw.get("unit_price_minor", ln.unit_price_minor)))
            except ValueError as e:
                raise OrderRejected("line_invalid", "lines", {"line_id": str(ln.id)}) from e
            if qty < 0 or price < 0:
                raise OrderRejected("line_invalid", "lines", {"line_id": str(ln.id)})
            if "is_gift" in raw:
                ln.is_gift = raw.get("is_gift") in (True, 1, "1", "true")
            if not linked:
                ln.received_qty_milli = qty
                ln.base_qty_milli = qty * ln.factor_milli // 1000
            ln.unit_price_minor = 0 if ln.is_gift else price
            ln.excess_reason = str(raw.get("excess_reason", ln.excess_reason)).strip()
            ln.save()
        document.total_minor = _lines_total(document)
        document.save()
    return document


def refer(*, actor: User, viewer: home.Viewer, document: PurchaseDocument) -> PurchaseDocument:
    """«أحِل إلى المالك» ترسل المستند كما هو وتُبقيه مسوّدة — الاعتماد يُنسب لمن وقّع."""
    if not can_create(viewer):
        raise OrderRejected("permission_denied")
    if document.status == PurchaseDocument.Status.APPROVED:
        raise OrderRejected("document_locked")
    owner = User.objects.filter(is_owner=True, is_active=True).first()
    document.status = PurchaseDocument.Status.REFERRED
    document.referred_to_name = owner.display_name if owner else ""
    document.referred_at = timezone.now()
    document.save(update_fields=["status", "referred_to_name", "referred_at", "updated_at"])
    from core import notifications

    notifications.emit(
        kind="purchase_referred",
        category="operational",
        title=f"مستند شراء {document.number} يحتاج اعتمادك — {document.supplier_name}",
        body=f"أحاله {actor.display_name}: الإجمالي فوق حدّ صلاحيته.",
        href=f"/purchasing/documents/{document.id}",
        screen="PUR-03",
        needs_action=True,
        owner_only=True,
        dedupe_key=f"purchase_referred:{document.id}",
    )
    audit.record(
        kind="purchase_document.referred",
        title=f"إحالة مستند الشراء {document.number} إلى {document.referred_to_name}",
        actor=actor,
        detail=f"الإجمالي {document.total_minor} فوق حدّ الاعتماد",
        ref_entity="inventory.PurchaseDocument",
        ref_id=document.id,
    )
    return document


def approve(
    *, actor: User, viewer: home.Viewer, document: PurchaseDocument, market: bool = False
) -> PurchaseDocument:
    """الاعتماد مرة واحدة بالهوية: ذمّة المورد وأثرها يُعلَن صراحةً. المخزون (د-١): المستند المربوط
    باستلام قائم لا يُنشئ حركة — دخل المخزون من الاستلام، ويُكتب سطر تكلفة `PD-n` بلا حركة فيصل
    سعر الفاتورة إلى التكلفة؛ المستند بلا استلام يُنشئ استلام `PD-n` بحركاته كما كان."""
    if document.status == PurchaseDocument.Status.APPROVED:
        return document  # متكرّر الأثر — لا اعتماد ثانٍ ولا استلام ثانٍ
    if not can_create(viewer):
        raise OrderRejected("permission_denied")
    linked = [] if market else linked_receipts(document)
    if linked:
        _apply_linked_quantities(document)
    limit = approval_limit(viewer)
    if limit is not None and document.total_minor > limit:
        raise OrderRejected(
            "over_limit",
            "",
            {"limit_minor": str(limit), "total_minor": str(document.total_minor)},
        )
    blk = blockers(document, market=market)
    if blk:
        raise OrderRejected("blocked", "", {"blockers": blk})
    item_ids = list(document.lines.values_list("item_id", flat=True))
    before = _weighted_avg_cost(item_ids)
    now = timezone.now()
    with transaction.atomic():
        receipt: GoodsReceipt = GoodsReceipt.objects.create(
            tenant_id=document.tenant_id,
            branch=document.branch,
            receipt_number=f"PD-{document.number}",
            party_id=document.supplier_id,
            supplier_name=document.supplier_name,
            reference=f"فاتورة المورد {document.supplier_invoice_number}",
            device_id=viewer.device.id if viewer.device else uuid.UUID(int=0),
            user_id=actor.id,
            user_name=actor.display_name,
            note=(
                "سطر تكلفة بلا حركة — المخزون من الاستلام "
                + "، ".join(rc.receipt_number for rc in linked)
                if linked
                else document.note
            )[:300],
            business_date=timezone.localdate(),
            occurred_at=now,
        )
        stock_effects = []
        for ln in document.lines.order_by("line_no"):
            GoodsReceiptLine.objects.create(
                tenant_id=document.tenant_id,
                receipt=receipt,
                item_id=ln.item_id,
                item_name=ln.item_name,
                unit_code=ln.unit_code,
                factor_milli=ln.factor_milli,
                qty_milli=ln.received_qty_milli,
                base_qty_milli=ln.base_qty_milli,
                unit_cost_minor=ln.unit_price_minor,
            )
            # د-١: المربوط دخل مخزونه من الاستلام — لا حركة ثانية
            if not linked and ln.base_qty_milli > 0:
                StockMovement.objects.create(
                    tenant_id=document.tenant_id,
                    branch=document.branch,
                    item_id=ln.item_id,
                    delta_base_qty_milli=ln.base_qty_milli,
                    reason="receive",
                    source_entity="inventory.GoodsReceipt",
                    source_id=receipt.id,
                    occurred_at=now,
                )
            if not linked:
                stock_effects.append(
                    {
                        "item_name": ln.item_name,
                        "qty_milli": str(ln.received_qty_milli),
                        "unit_name": ln.unit_name,
                    }
                )
            ol = ln.order_line
            if ol is not None:
                ol.received_base_qty_milli += ln.base_qty_milli
                ol.save(update_fields=["received_base_qty_milli"])
        after = _weighted_avg_cost(item_ids)
        cost_effects = [
            {
                "item_name": ln.item_name,
                "before_minor": str(before.get(ln.item_id, 0) * ln.factor_milli // 1000 // 1000),
                "after_minor": str(after.get(ln.item_id, 0) * ln.factor_milli // 1000 // 1000),
                "unit_name": ln.unit_name,
            }
            for ln in document.lines.order_by("line_no")
        ]
        document.status = PurchaseDocument.Status.APPROVED
        document.approved_by_user_id = actor.id
        document.approved_by_name = actor.display_name
        document.approved_at = now
        document.receipt = receipt
        document.effects = {
            "stock": stock_effects,
            "linked_receipts": [rc.receipt_number for rc in linked],
            "cost": cost_effects,
            "branch_name": document.branch.name,
            "payable_minor": str(document.total_minor),
            "due_at": _iso(now + timedelta(days=document.due_days)),
        }
        document.save()
        o = document.order
        if o is not None:
            fully = all(x.received_base_qty_milli >= x.base_qty_milli for x in o.lines.all())
            o.status = PurchaseOrder.Status.RECEIVED if fully else PurchaseOrder.Status.PARTIAL
            o.save(update_fields=["status", "updated_at"])
    audit.record(
        kind="purchase_document.approved",
        title=f"اعتماد مستند الشراء {document.number} — {document.supplier_name}",
        actor=actor,
        branch=document.branch,
        detail=(
            f"الإجمالي {document.total_minor} · فاتورة المورد {document.supplier_invoice_number}"
            + (
                " · المخزون من الاستلام " + "، ".join(rc.receipt_number for rc in linked)
                if linked
                else ""
            )
        ),
        ref_entity="inventory.PurchaseDocument",
        ref_id=document.id,
    )
    return document


# ------------------------------------------------------------------------ PUR-04 المرتجع


def return_line_payload(ln: PurchaseReturnLine) -> dict[str, Any]:
    return {
        "id": str(ln.id),
        "document_line_id": str(ln.document_line_id),
        "item_id": str(ln.item_id),
        "item_name": ln.item_name,
        "unit_code": ln.unit_code,
        "unit_name": ln.unit_name,
        "qty_milli": str(ln.qty_milli),
        "unit_price_minor": str(ln.unit_price_minor),
        "line_total_minor": str(ln.unit_price_minor * ln.qty_milli // 1000),
        "reason": ln.reason,
        "from_quarantine": ln.from_quarantine,
        "rejected_qty_milli": str(_rejected_qty(ln)),
        "accepted_qty_milli": str(ln.accepted_qty_milli)
        if ln.accepted_qty_milli is not None
        else "",
        "supplier_note": ln.supplier_note,
        "line_no": ln.line_no,
    }


def return_payload(r: PurchaseReturn) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "number": r.number,
        "document_id": str(r.document_id),
        "document_number": r.document.number,
        "supplier_name": r.supplier_name,
        "status": r.status,
        "status_label": PurchaseReturn.Status(r.status).label,
        "total_minor": str(r.total_minor),
        "accepted_minor": str(r.accepted_minor),
        "rejected_minor": str(r.total_minor - r.accepted_minor)
        if r.status in {PurchaseReturn.Status.PARTIAL, PurchaseReturn.Status.REJECTED}
        else "0",
        "supplier_note": r.supplier_note,
        # I-07 (0005 §٢٩٥): مصير المرفوض — بفاعل وسبب؛ فارغ = لم يُقرَّر بعد
        "rejected_destination": r.rejected_destination,
        "rejected_reason": r.rejected_reason,
        "rejected_by_name": r.rejected_by_name,
        "rejected_at": _iso(r.rejected_at),
        "lines": [return_line_payload(ln) for ln in r.lines.order_by("line_no")],
        "created_by_name": r.created_by_name,
        "created_at": _iso(r.created_at),
        "responded_at": _iso(r.responded_at),
    }


def _rejected_qty(ln: PurchaseReturnLine) -> int:
    """ما رفضه المورد من السطر (بوحدة السطر): المُرتجَع ناقص المقبول — قبل الردّ صفر."""
    if ln.accepted_qty_milli is None:
        return 0
    return max(0, ln.qty_milli - ln.accepted_qty_milli)


def return_limits(document: PurchaseDocument) -> dict[str, int]:
    """الحدّ الأعلى لكل سطر = المستلَم ناقص ما رُدّ سابقاً على المستند نفسه."""
    out: dict[str, int] = {}
    for ln in document.lines.all():
        returned = (
            PurchaseReturnLine.objects.filter(document_line=ln).aggregate(s=Sum("qty_milli"))["s"]
            or 0
        )
        out[str(ln.id)] = max(0, ln.received_qty_milli - int(returned))
    return out


def record_return(
    *, actor: User, viewer: home.Viewer, document: PurchaseDocument, lines: list[dict[str, Any]]
) -> PurchaseReturn:
    if not can_create(viewer):
        raise OrderRejected("permission_denied")
    if document.status != PurchaseDocument.Status.APPROVED:
        raise OrderRejected("document_not_approved")
    from inventory.services import branch_quarantine

    limits = return_limits(document)
    by_id = {str(ln.id): ln for ln in document.lines.all()}
    errors: list[dict[str, Any]] = []
    resolved: list[tuple[PurchaseDocumentLine, int, str, bool]] = []
    held = branch_quarantine(document.branch_id)
    from_q: dict[uuid.UUID, int] = {}
    for raw in lines:
        lid = str(raw.get("document_line_id", ""))
        ln = by_id.get(lid)
        if ln is None:
            continue
        try:
            qty = int(str(raw.get("qty_milli", "0")))
        except ValueError:
            qty = 0
        if qty <= 0:
            continue
        reason = str(raw.get("reason", "")).strip()
        if qty > limits.get(lid, 0):
            errors.append(
                {
                    "line_id": lid,
                    "code": "exceeds_received",
                    "max_qty_milli": str(limits.get(lid, 0)),
                    "item_name": ln.item_name,
                }
            )
        if not reason:
            errors.append({"line_id": lid, "code": "reason_required", "item_name": ln.item_name})
        quarantined = raw.get("from_quarantine") in (True, 1, "1", "true")
        if quarantined:
            # «أرجع للمورد» من الحجر (I-06): الحدّ ما في الحجر من الصنف في فرع المستند
            from_q[ln.item_id] = from_q.get(ln.item_id, 0) + qty * ln.factor_milli // 1000
            if from_q[ln.item_id] > held.get(ln.item_id, 0):
                errors.append(
                    {
                        "line_id": lid,
                        "code": "exceeds_quarantine",
                        "max_qty_milli": str(
                            held.get(ln.item_id, 0) * 1000 // max(int(ln.factor_milli), 1)
                        ),
                        "item_name": ln.item_name,
                    }
                )
        resolved.append((ln, qty, reason, quarantined))
    if errors:
        raise OrderRejected("lines_invalid", "lines", {"errors": errors})
    if not resolved:
        raise OrderRejected("lines_required", "lines")
    now = timezone.now()
    with transaction.atomic():
        r: PurchaseReturn = PurchaseReturn.objects.create(
            tenant_id=document.tenant_id,
            number=_ret_number(),
            document=document,
            supplier_id=document.supplier_id,
            supplier_name=document.supplier_name,
            branch=document.branch,
            created_by_user_id=actor.id,
            created_by_name=actor.display_name,
        )
        total = 0
        for i, (ln, qty, reason, quarantined) in enumerate(resolved, start=1):
            base = qty * ln.factor_milli // 1000
            PurchaseReturnLine.objects.create(
                tenant_id=document.tenant_id,
                purchase_return=r,
                document_line=ln,
                item_id=ln.item_id,
                item_name=ln.item_name,
                unit_code=ln.unit_code,
                unit_name=ln.unit_name,
                factor_milli=ln.factor_milli,
                qty_milli=qty,
                base_qty_milli=base,
                unit_price_minor=ln.unit_price_minor,  # مثبّت من المستند الأصلي
                reason=reason,
                from_quarantine=quarantined,
                line_no=i,
            )
            if quarantined:
                # التالف المحجور يخرج من الحجر — لا يُنقص المتاح للبيع مرة ثانية (I-06)
                QuarantineMovement.objects.create(
                    tenant_id=document.tenant_id,
                    branch=document.branch,
                    item_id=ln.item_id,
                    base_qty_milli=-base,
                    reason="purchase_return",
                    source_entity="inventory.PurchaseReturn",
                    source_id=r.id,
                    occurred_at=now,
                )
            else:
                # خرجت الكميات من المخزون — بسعر المستند نفسه فالمتوسط المرجّح لا يتأثر
                StockMovement.objects.create(
                    tenant_id=document.tenant_id,
                    branch=document.branch,
                    item_id=ln.item_id,
                    delta_base_qty_milli=-base,
                    reason="purchase_return",
                    source_entity="inventory.PurchaseReturn",
                    source_id=r.id,
                    note=reason,
                    occurred_at=now,
                )
            total += ln.unit_price_minor * qty // 1000
        r.total_minor = total
        r.accepted_minor = total  # إشعار دائن بكامله حتى يردّ المورد
        r.save(update_fields=["total_minor", "accepted_minor"])
    audit.record(
        kind="purchase_return.recorded",
        title=f"مرتجع مشتريات {r.number} على مستند {document.number}",
        actor=actor,
        branch=document.branch,
        detail=f"{total} إشعار دائن لصالح المنشأة على {document.supplier_name}",
        ref_entity="inventory.PurchaseReturn",
        ref_id=r.id,
    )
    return r


def respond(
    *,
    actor: User,
    viewer: home.Viewer,
    purchase_return: PurchaseReturn,
    lines: list[dict[str, Any]],
    note: str,
) -> PurchaseReturn:
    """ردّ المورد يُسجَّل نصاً كما قاله: المقبول وحده يُخصم؛ المرفوض لا يُخصم ولا يعود للمخزون
    قبل قرارك."""
    if not can_create(viewer):
        raise OrderRejected("permission_denied")
    if purchase_return.rejected_destination:
        # المرفوض عاد إلى المخزون أو الحجر — تغيير الردّ بعده يُفسد ما تحرّك (I-07)
        raise OrderRejected("rejected_decided")
    by_id = {str(ln.id): ln for ln in purchase_return.lines.all()}
    accepted_total = 0
    with transaction.atomic():
        for raw in lines:
            ln = by_id.get(str(raw.get("id", "")))
            if ln is None:
                continue
            try:
                acc = int(str(raw.get("accepted_qty_milli", ln.qty_milli)))
            except ValueError:
                acc = ln.qty_milli
            ln.accepted_qty_milli = max(0, min(acc, ln.qty_milli))
            ln.supplier_note = str(raw.get("supplier_note", "")).strip()
            ln.save(update_fields=["accepted_qty_milli", "supplier_note"])
        for ln in purchase_return.lines.all():
            acc = ln.accepted_qty_milli if ln.accepted_qty_milli is not None else ln.qty_milli
            accepted_total += ln.unit_price_minor * acc // 1000
        purchase_return.accepted_minor = accepted_total
        purchase_return.supplier_note = note.strip()
        purchase_return.responded_at = timezone.now()
        purchase_return.status = (
            PurchaseReturn.Status.ACCEPTED
            if accepted_total == purchase_return.total_minor
            else PurchaseReturn.Status.REJECTED
            if accepted_total == 0
            else PurchaseReturn.Status.PARTIAL
        )
        purchase_return.save()
    audit.record(
        kind="purchase_return.responded",
        title=f"ردّ المورد على المرتجع {purchase_return.number}",
        actor=actor,
        detail=f"المقبول {accepted_total} من {purchase_return.total_minor} · {note.strip()}",
        ref_entity="inventory.PurchaseReturn",
        ref_id=purchase_return.id,
    )
    return purchase_return


def settle_rejected(
    *,
    actor: User,
    viewer: home.Viewer,
    purchase_return: PurchaseReturn,
    destination: str,
    reason: str,
) -> PurchaseReturn:
    """مصير ما رفضه المورد (I-07، 0005 §٢٩٥): خرج من المخزون عند تسجيل المرتجع، والمورد ردّه — فهو في
    يد المحل. «أعد المرفوض إلى المخزون» يُدخله المتاح للبيع، و«انقله إلى الحجر» يُدخله الحجر. قرار
    واحد للمرتجع بفاعله وسببه ووقته؛ لا يُعاد."""
    if not can_create(viewer):
        raise OrderRejected("permission_denied")
    if destination not in ("stock", "quarantine"):
        raise OrderRejected("destination_invalid", "destination")
    if not reason.strip():
        raise OrderRejected("reason_required", "reason")
    if purchase_return.rejected_destination:
        raise OrderRejected("rejected_decided")
    lines = [(ln, _rejected_qty(ln)) for ln in purchase_return.lines.order_by("line_no")]
    lines = [(ln, q) for ln, q in lines if q > 0]
    if not lines:
        raise OrderRejected("nothing_rejected")
    now = timezone.now()
    with transaction.atomic():
        for ln, q in lines:
            base = q * ln.factor_milli // 1000
            if destination == "stock":
                StockMovement.objects.create(
                    tenant_id=purchase_return.tenant_id,
                    branch=purchase_return.branch,
                    item_id=ln.item_id,
                    delta_base_qty_milli=base,
                    reason="return_rejected",
                    source_entity="inventory.PurchaseReturn",
                    source_id=purchase_return.id,
                    note=reason.strip()[:300],
                    occurred_at=now,
                )
            else:
                QuarantineMovement.objects.create(
                    tenant_id=purchase_return.tenant_id,
                    branch=purchase_return.branch,
                    item_id=ln.item_id,
                    base_qty_milli=base,
                    reason="return_rejected",
                    source_entity="inventory.PurchaseReturn",
                    source_id=purchase_return.id,
                    occurred_at=now,
                )
        purchase_return.rejected_destination = destination
        purchase_return.rejected_reason = reason.strip()[:300]
        purchase_return.rejected_by_name = actor.display_name
        purchase_return.rejected_at = now
        purchase_return.save(
            update_fields=[
                "rejected_destination",
                "rejected_reason",
                "rejected_by_name",
                "rejected_at",
            ]
        )
    audit.record(
        kind="purchase_return.rejected_settled",
        title=(
            f"المرفوض من المرتجع {purchase_return.number} "
            + ("أُعيد إلى المخزون" if destination == "stock" else "نُقل إلى الحجر")
        ),
        actor=actor,
        branch=purchase_return.branch,
        detail=reason.strip(),
        ref_entity="inventory.PurchaseReturn",
        ref_id=purchase_return.id,
    )
    return purchase_return


# ------------------------------------------------------------ ذمّة المورد (PTY): مستندات − مرتجعات


def supplier_documents_approved(party: Any) -> int:
    """عدد مستندات الشراء المعتمدة على المورد (وما دُمج فيه) — مصدر ذمّته في REP-02."""
    from parties.services import identity_ids

    return PurchaseDocument.objects.filter(
        supplier_id__in=identity_ids(party), status=PurchaseDocument.Status.APPROVED
    ).count()


def supplier_statement_lines_from_purchases(party: Any) -> list[Any]:
    """سطور كشف المورد (المرحلة ٣ من مراجعة الأطراف): المستند المعتمد يرفع «له علينا» بكامله
    والمرتجع المقبول يخفّضه — بالمبلغين اللذين يحسبهما `supplier_owed_from_purchases`."""
    from parties.services import StatementLine, identity_ids

    ids = identity_ids(party)
    out: list[Any] = []
    for d in PurchaseDocument.objects.filter(
        supplier_id__in=ids, status=PurchaseDocument.Status.APPROVED
    ).order_by("approved_at"):
        when = d.approved_at or d.created_at
        out.append(
            StatementLine(
                doc=d.number,
                doc_id=str(d.id),
                kind="purchase",
                label="مستند شراء معتمد"
                + (
                    f" — فاتورة المورد {d.supplier_invoice_number}"
                    if d.supplier_invoice_number
                    else ""
                ),
                occurred_at=when,
                business_date=timezone.localdate(when),
                debit_minor=0,
                credit_minor=d.total_minor,
                branch_id=d.branch_id,
                party_id=d.supplier_id,
            )
        )
    for r in PurchaseReturn.objects.filter(supplier_id__in=ids, accepted_minor__gt=0).order_by(
        "created_at"
    ):
        out.append(
            StatementLine(
                doc=r.number,
                doc_id=str(r.id),
                kind="purchase_return",
                label="مرتجع شراء — إشعار دائن",
                occurred_at=r.created_at,
                business_date=timezone.localdate(r.created_at),
                debit_minor=r.accepted_minor,
                credit_minor=0,
                branch_id=r.branch_id,
                party_id=r.supplier_id,
            )
        )
    return out


def supplier_owed_from_purchases(party: Any) -> int:
    from parties.services import identity_ids

    ids = identity_ids(party)
    docs = (
        PurchaseDocument.objects.filter(
            supplier_id__in=ids, status=PurchaseDocument.Status.APPROVED
        ).aggregate(s=Sum("total_minor"))["s"]
        or 0
    )
    rets = (
        PurchaseReturn.objects.filter(supplier_id__in=ids).aggregate(s=Sum("accepted_minor"))["s"]
        or 0
    )
    return int(docs) - int(rets)


def bulk_supplier_owed_from_purchases(ids: list[Any]) -> dict[Any, int]:
    """نظير `supplier_owed_from_purchases` لكل هوية (0005 §٢٨٧)."""
    from parties.services import sum_by

    docs = sum_by(
        PurchaseDocument.objects.filter(
            supplier_id__in=ids, status=PurchaseDocument.Status.APPROVED
        ),
        "supplier_id",
        "total_minor",
    )
    rets = sum_by(
        PurchaseReturn.objects.filter(supplier_id__in=ids), "supplier_id", "accepted_minor"
    )
    return {k: docs.get(k, 0) - rets.get(k, 0) for k in set(docs) | set(rets)}

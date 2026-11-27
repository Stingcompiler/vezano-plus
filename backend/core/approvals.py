"""«طلبات تنتظرك» واعتماد المدير الحاضر (S-04 من مراجعة البيع 2026-11-22؛ 0005 §٢٩٣).

ثلاثة طلبات كانت تُسجَّل ولا تصل أحداً: سحب من الدرج، وخصم فوق سقف الدور، وتجاوز حدّ ائتمان عميل.
القرار د-٤ «كلاهما»:

- **عند الصندوق:** مدير أو مالك حاضر يكتب رمزه (PIN القفل نفسه — §٢٦٥؛ لا سرّ جديد). الجهاز يتحقق
  من الرمز بمتحققات فرعه ومن حدّ صاحبه في المصفوفة، ويرفع العملية باسم من اعتمد. الخادم يعيد
  الفحص عند الرفع (`pin_problem`): صاحب الرمز من المنشأة ونشط وغير الطالب، ومتحققه نفسه، وحدّه
  يغطي المبلغ بـ`can_in_branch`. ما لا يصحّ يُحجر `approval_invalid` إلى «مراجعة التعارضات»
  (SYS-03) ولا يُطبَّق.
- **بلا معتمد حاضر:** الطلب يبقى «بانتظار القرار» ويظهر في «طلبات تنتظرك» للمالك ولمدير الفرع (في
  الرئيسية وفي الإشعارات)، فيوافق أو يرفض بسبب، وتعرف شاشة الكاشير النتيجة.

كل وحدة تسجّل مصدر طلباتها هنا (`register_source`) — الورديات للسحب، والبيع للخصم والائتمان — فلا
تستورد النواة نماذج الوحدات.

من يعتمد ماذا (`approver_decision`):
- السحب: المالك وحده (لا صف له في المصفوفة؛ «السحب للمالك وحده» — SHIFT-03).
- الخصم: خلية «خصم وتجاوز سعر» للمعتمد في فرع الطلب، بقيمة الخصم.
- تجاوز حدّ الائتمان: خلية «رؤية ذمم كل العملاء» للمعتمد في فرع الطلب (لا صف مستقل له بعد).
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from django.db import models, transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from core import permissions
from core.models import Branch, PinVerifier, User, UserBranchAccess

KINDS = ("withdrawal", "discount", "credit")
#: رمز الحجر لاعتماد برمز لا يصحّ عند الرفع
APPROVAL_INVALID = "approval_invalid"


@dataclass(frozen=True)
class Source:
    """مصدر طلبات وحدة: نموذجها، وفرع الطلب ومبلغه، وما يُعرض عنه."""

    kind: str
    model: type[models.Model]
    branch_of: Callable[[Any], uuid.UUID]
    amount_of: Callable[[Any], int]
    requested_at: Callable[[Any], datetime]
    details: Callable[[Any], dict[str, Any]]


SOURCES: dict[str, Source] = {}


def register_source(source: Source) -> None:
    SOURCES[source.kind] = source


class ApprovalRejected(Exception):
    def __init__(self, code: str, field: str = "", decision: Any = None) -> None:
        super().__init__(code)
        self.code = code
        self.field = field
        self.decision = decision


def _iso(dt: datetime | None) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


# ---------------------------------------------------------------- من يعتمد


def approver_decision(
    user: User | None, kind: str, branch_id: uuid.UUID, amount: int
) -> permissions.Decision:
    """هل يحقّ لهذا المستخدم اعتماد هذا الطلب؟ — المصفوفة نفسها التي تحكم الفعل (`can`)."""
    if user is None or not user.is_active:
        return permissions.Decision(kind, False, "role_forbidden")
    if kind == "withdrawal":
        return permissions.Decision(
            "withdrawal", user.is_owner, "" if user.is_owner else "role_forbidden"
        )
    if kind == "discount":
        return permissions.can_in_branch(user, branch_id, "discount", amount)
    if kind == "credit":
        return permissions.can_in_branch(user, branch_id, "view_receivables")
    return permissions.Decision(kind, False, "role_forbidden")


def _in_branch(user: User, branch_id: uuid.UUID) -> bool:
    return user.is_owner or (
        UserBranchAccess.unscoped.filter(
            user=user, branch_id=branch_id, revoked_at__isnull=True
        ).exists()
    )


def pin_problem(
    *,
    tenant_id: uuid.UUID,
    kind: str,
    approver_id: Any,
    requester_id: uuid.UUID,
    branch_id: uuid.UUID,
    amount: int,
    verifier_version: Any,
    occurred_at: Any,
) -> str:
    """فحص الخادم لاعتماد برمز عند الصندوق رُفع من جهاز (ولو بعد ساعات بلا اتصال). الفارغ = صحيح.

    الرمز نفسه لا يصل الخادم (يُتحقق منه على الجهاز — §٩.١)؛ ما يُفحص هنا: صاحبه من المنشأة ونشط
    وفي فرع الطلب وليس الطالب، والمتحقق الذي طابق هو متحققه (أو أقدم منه إن تغيّر الرمز بعد لحظة
    الاعتماد — جهاز بلا اتصال لم يعرف الجديد بعد، §٩.٣)، وحدّه في المصفوفة يغطي الطلب."""
    try:
        approver_uuid = uuid.UUID(str(approver_id))
    except ValueError:
        return "unknown_approver"
    approver = User.unscoped.filter(tenant_id=tenant_id, id=approver_uuid, is_active=True).first()
    if approver is None:
        return "unknown_approver"
    if approver.id == requester_id:
        return "self_approval"
    if not _in_branch(approver, branch_id):
        return "not_in_branch"
    verifier = PinVerifier.unscoped.filter(tenant_id=tenant_id, user=approver).first()
    if verifier is None:
        return "no_pin"
    try:
        version = int(str(verifier_version))
    except ValueError:
        return "stale_pin"
    if version != verifier.version:
        at = parse_datetime(str(occurred_at or "")) or timezone.now()
        if not timezone.is_aware(at):
            at = timezone.make_aware(at)
        # رمز قديم مقبول إن كان الاعتماد قبل تغييره؛ بعده = رمز لم يعد صاحبه يملكه
        if not (version < verifier.version and at <= verifier.updated_at):
            return "stale_pin"
    decision = approver_decision(approver, kind, branch_id, amount)
    if not decision.allowed:
        return decision.reason or "role_forbidden"
    return ""


#: قرار المالك في SYS-03 بقبول اعتماد محجوز — داخله يُطبَّق كما أعلنه الجهاز
_accepting: ContextVar[bool] = ContextVar("accepting_invalid_approval", default=False)


@contextmanager
def accepting_invalid_approval() -> Iterator[None]:
    token = _accepting.set(True)
    try:
        yield
    finally:
        _accepting.reset(token)


def accepting_now() -> bool:
    return _accepting.get()


def check_pin_approval(**kw: Any) -> None:
    """يحجر العملية كلها `approval_invalid` إن لم يصحّ اعتماد الرمز (إلا بقبول المالك في SYS-03)."""
    from sync.appliers import BusinessConflict

    problem = pin_problem(**kw)
    if problem and not _accepting.get():
        raise BusinessConflict(APPROVAL_INVALID, f"{kw['kind']}:{problem}")


def approver_name(user_id: Any) -> str:
    try:
        u = User.unscoped.filter(id=uuid.UUID(str(user_id))).first()
    except ValueError:
        return ""
    return u.display_name if u else ""


# ---------------------------------------------------------------- الصندوق


def item_payload(kind: str, rec: Any, viewer_user: User | None = None) -> dict[str, Any]:
    src = SOURCES[kind]
    branch_id = src.branch_of(rec)
    branch = Branch.objects.filter(id=branch_id).first()
    amount = src.amount_of(rec)
    out: dict[str, Any] = {
        "id": str(rec.pk),
        "kind": kind,
        "status": rec.status,
        "amount_minor": str(amount),
        "reason": rec.reason,
        "requested_by_name": rec.requested_by_name,
        "requested_at": _iso(src.requested_at(rec)),
        "branch_id": str(branch_id),
        "branch_name": branch.name if branch else "",
        "decided_by_user_id": str(rec.decided_by_user_id) if rec.decided_by_user_id else "",
        "decided_by_name": rec.decided_by_name,
        "decided_at": _iso(rec.decided_at),
        "decision_reason": rec.decision_reason,
        "approved_via": rec.approved_via,
        **src.details(rec),
    }
    if viewer_user is not None:
        d = approver_decision(viewer_user, kind, branch_id, amount)
        out["can_decide"] = (
            rec.status == "pending" and d.allowed and viewer_user.id != rec.requested_by_user_id
        )
    return out


def inbox(viewer_user: User, branch_id: uuid.UUID | None) -> list[dict[str, Any]]:
    """الطلبات بانتظار القرار: المالك كل الفروع، وغيره فرعه — الأقدم أولاً."""
    rows: list[tuple[datetime, dict[str, Any]]] = []
    for kind, src in SOURCES.items():
        for rec in src.model.objects.filter(status="pending"):  # type: ignore[attr-defined]
            if branch_id is not None and src.branch_of(rec) != branch_id:
                continue
            rows.append((src.requested_at(rec), item_payload(kind, rec, viewer_user)))
    rows.sort(key=lambda r: r[0])
    return [p for _, p in rows]


def inbox_all() -> list[dict[str, Any]]:
    """كل الطلبات بانتظار القرار في المنشأة — لإشعارات «طلبات تنتظرك»."""
    out: list[tuple[datetime, dict[str, Any]]] = []
    for kind, src in SOURCES.items():
        for rec in src.model.objects.filter(status="pending"):  # type: ignore[attr-defined]
            out.append((src.requested_at(rec), item_payload(kind, rec)))
    out.sort(key=lambda r: r[0])
    return [p for _, p in out]


def get(kind: str, request_id: uuid.UUID) -> Any:
    src = SOURCES.get(kind)
    if src is None:
        return None
    return src.model.objects.filter(pk=request_id).first()  # type: ignore[attr-defined]


def decide(kind: str, rec: Any, *, actor: User, decision: str, reason: str) -> Any:
    """«وافق» أو «ارفض»: باسم من قرّر، والرفض بسبب. الطالب لا يقرّر في طلبه، وحدّ المعتمد يغطيه."""
    src = SOURCES[kind]
    if decision not in ("accept", "reject"):
        raise ApprovalRejected("invalid", "decision")
    if rec.status != "pending":
        raise ApprovalRejected("already_decided")
    if actor.id == rec.requested_by_user_id:
        raise ApprovalRejected("self_approval")
    d = approver_decision(actor, kind, src.branch_of(rec), src.amount_of(rec))
    if not d.allowed:
        raise ApprovalRejected("permission_denied", decision=d)
    if decision == "reject" and not reason.strip():
        raise ApprovalRejected("required", "reason")
    with transaction.atomic():
        rec.status = "approved" if decision == "accept" else "rejected"
        rec.decided_by_user_id = actor.id
        rec.decided_by_name = actor.display_name
        rec.decided_at = timezone.now()
        rec.decision_reason = reason.strip()
        rec.approved_via = "inbox"
        rec.save(
            update_fields=[
                "status",
                "decided_by_user_id",
                "decided_by_name",
                "decided_at",
                "decision_reason",
                "approved_via",
            ]
        )
        from core import audit

        audit.record(
            kind=f"approval.{rec.status}",
            title=f"{'موافقة على' if decision == 'accept' else 'رفض'} طلب {KIND_WORDS[kind]}",
            actor=actor,
            branch=Branch.objects.filter(id=src.branch_of(rec)).first(),
            detail=f"{rec.requested_by_name} · {src.amount_of(rec)}",
            reason=reason.strip(),
            ref_entity=f"{src.model._meta.app_label}.{src.model.__name__}",
            ref_id=rec.pk,
        )
        _notify_requester(kind, rec)
    return rec


KIND_WORDS = {"withdrawal": "سحب", "discount": "خصم", "credit": "تجاوز حدّ ائتمان"}


def _notify_requester(kind: str, rec: Any) -> None:
    """الطالب يعرف النتيجة في إشعاراته أيضاً (للخاص به وحده — 0005 §٢٧٥)."""
    from core.notifications import emit

    accepted = rec.status == "approved"
    emit(
        kind="approval_decided",
        category="operational",
        title=(
            f"وافق {rec.decided_by_name} على طلب {KIND_WORDS[kind]}"
            if accepted
            else f"رفض {rec.decided_by_name} طلب {KIND_WORDS[kind]}"
        ),
        body=rec.decision_reason,
        href=SCREEN_HREF[kind],
        screen=SCREEN_ID[kind],
        for_user=rec.requested_by_user_id,
        branch_id=SOURCES[kind].branch_of(rec),
        dedupe_key=f"approval_decided:{kind}:{rec.pk}",
    )


SCREEN_HREF = {"withdrawal": "/shifts/movements", "discount": "/pos/discount", "credit": "/pos"}
SCREEN_ID = {"withdrawal": "SHIFT-03", "discount": "POS-03", "credit": "POS-06"}


def pending_count(viewer_user: User, branch_id: uuid.UUID | None) -> int:
    return sum(1 for r in inbox(viewer_user, branch_id) if r.get("can_decide"))

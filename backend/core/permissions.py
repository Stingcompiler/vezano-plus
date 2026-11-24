"""مدخل واحد لقرار الصلاحية من مصفوفة الأدوار (ORG-02 · مراجعة 2026-11-22 O-01/O-02 · 0005 §٢٩٢).

كل موضع يقرّر «هل يحقّ لهذا الدور هذا الفعل؟» يسأل `can(viewer, key, amount)` هنا، لا قيماً ثابتة
متفرّقة: خلية المصفوفة المحفوظة هي القرار، والافتراض المبذور هو قرارها للمنشآت التي لم تحرّرها.
المالك مسموح له دائماً (عموده مقفل في المصفوفة). القرار نفسه يُرسَل للويب والجوال
(`rules_payload`) فتعرض الشاشة ما يقرّره الخادم، ويُعاد استعماله عند رفع العمليات (المرحلة ٢:
`can_in_branch` بدور منفّذ العملية في فرعها).

القيم وأثرها:
- «نعم» و«بلا حد»: مسموح بلا حدّ.
- «لا»: ممنوع (`role_forbidden`) — و«لا» في الخصم تعني صفراً، لا الحدّ التجريبي (O-02).
- «حد مالي»: مسموح حتى الحدّ في فرع المستخدم؛ ما فوقه `over_limit`. صفر = لا شيء.
- «فرعه»: مسموح في فرع المستخدم وحده؛ غيره `other_branch`. بلا فرع محدّد = نطاق الفرع.
- «نقداً فقط»: مسموح نقداً؛ التحويل `cash_only`. والردّ (إخراج المال) يحتاج «نعم».
- «عميل البيع فقط»: لا قائمة ولا تقرير (`own_customer_only`)؛ يرى رصيد من يبيع له وقت البيع.
- «اقتراح فقط»: يقترح ولا يعتمد (`propose_only`).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from core import org

if TYPE_CHECKING:
    from core.home import Viewer
    from core.models import User

#: قيم تعني «مسموح بلا قيد»
UNRESTRICTED = frozenset({"yes", "unlimited"})


@dataclass(frozen=True)
class Decision:
    """قرار واحد: هل يُسمح، ولماذا لا، وما الخلية التي قرّرت (للعرض وللوسم في المرحلة ٢)."""

    key: str
    allowed: bool
    reason: str = ""
    value: str = ""
    limit_minor: int | None = None
    period: str = ""

    def __bool__(self) -> bool:
        return self.allowed

    @property
    def unrestricted(self) -> bool:
        """«نعم» أو «بلا حد» — لا حدّ ولا نطاق ولا وسيلة."""
        return self.allowed and self.value in UNRESTRICTED

    @property
    def branch_only(self) -> bool:
        return self.allowed and self.value == "branch"

    def denial(self, role_name: str = "") -> dict[str, Any]:
        """جسم 403 الموحّد: `permission_denied` بسببه وخليته — الشاشة تعرض السبب."""
        return {
            "detail": "permission_denied",
            "permission": self.key,
            "reason": self.reason,
            "limit_minor": None if self.limit_minor is None else str(self.limit_minor),
            "role_name": role_name,
        }


def _owner(key: str) -> Decision:
    spec = org.PERMISSION_BY_KEY[key]
    cell = spec.defaults["owner"]
    return Decision(key, True, value=cell.value if cell.value in UNRESTRICTED else "yes")


def decide_cell(
    key: str,
    cell: org.Cell,
    *,
    amount_minor: int | None = None,
    branch_id: uuid.UUID | None = None,
    own_branch_id: uuid.UUID | None = None,
    method: str | None = None,
) -> Decision:
    """قرار خلية بعينها — نواة `can` (يستعملها الخادم والاختبارات؛ ونظيرها في `sync-core`)."""
    v = cell.value

    def out(allowed: bool, reason: str = "", limit_minor: int | None = None) -> Decision:
        return Decision(key, allowed, reason, v, limit_minor, cell.period)

    if v in UNRESTRICTED:
        return out(True)
    if v == "limit":
        cap = cell.limit_minor or 0
        # الحدّ المالي يُمارَس في فرع المستخدم؛ «نعم» و«بلا حد» وحدهما يشملان كل الفروع
        if branch_id is not None and branch_id != own_branch_id:
            return out(False, "other_branch")
        if amount_minor is not None and amount_minor > cap:
            return out(False, "over_limit", cap)
        return out(True, limit_minor=cap)
    if v == "branch":
        if branch_id is not None and branch_id != own_branch_id:
            return out(False, "other_branch")
        return out(True)
    if v == "cash_only":
        if method not in (None, "", "cash"):
            return out(False, "cash_only")
        return out(True)
    if v == "own_customer":
        return out(False, "own_customer_only")
    if v == "propose":
        return out(False, "propose_only")
    return out(False, "role_forbidden")


def decide(
    role_code: str,
    is_owner: bool,
    key: str,
    *,
    amount_minor: int | None = None,
    branch_id: uuid.UUID | None = None,
    own_branch_id: uuid.UUID | None = None,
    method: str | None = None,
) -> Decision:
    if is_owner:
        return _owner(key)
    return decide_cell(
        key,
        org.cell_for(role_code or "", key),
        amount_minor=amount_minor,
        branch_id=branch_id,
        own_branch_id=own_branch_id,
        method=method,
    )


def can(
    viewer: Viewer,
    key: str,
    amount: int | None = None,
    *,
    branch_id: uuid.UUID | None = None,
    method: str | None = None,
) -> Decision:
    """هل يحقّ لصاحب الطلب هذا الفعل؟ — `amount` بالوحدة الصغرى، و`branch_id` فرع الشيء المعني."""
    return decide(
        viewer.role_code,
        viewer.is_owner,
        key,
        amount_minor=amount,
        branch_id=branch_id,
        own_branch_id=viewer.branch.id if viewer.branch is not None else None,
        method=method,
    )


def can_in_branch(
    user: User | None,
    branch_id: uuid.UUID,
    key: str,
    amount: int | None = None,
    *,
    method: str | None = None,
) -> Decision:
    """القرار بدور المستخدم في فرع بعينه — لعملية رُفعت من جهاز (البائع في فرع البيع)."""
    from core.models import UserBranchAccess

    if user is None:
        return Decision(key, False, "role_forbidden")
    if user.is_owner:
        return _owner(key)
    access = (
        UserBranchAccess.unscoped.filter(user=user, branch_id=branch_id, revoked_at__isnull=True)
        .select_related("role")
        .first()
    )
    return decide(
        access.role.code if access else "",
        False,
        key,
        amount_minor=amount,
        branch_id=branch_id,
        own_branch_id=branch_id if access else None,
        method=method,
    )


def limit_of(d: Decision) -> int | None:
    """سقف مالي من قرار بلا مبلغ: None = بلا حدّ؛ صفر = ممنوع (اعتماد الشراء، المرتجع، العجز)."""
    if not d.allowed:
        return 0
    return d.limit_minor


def rules_payload(viewer: Viewer) -> dict[str, dict[str, Any]]:
    """خلايا دور صاحب الطلب للمفاتيح الثلاثة عشر — تحملها الرئيسية وسياق الوردية ليقرّر الويب
    والجوال بالقاعدة نفسها (وبلا اتصال). المالك «نعم» في كل شيء."""
    if viewer.is_owner:
        return {
            p.key: {"value": _owner(p.key).value, "limit_minor": None, "period": ""}
            for p in org.PERMISSIONS
        }
    cells = org.cells_for_role(viewer.role_code or "")
    return {key: cell.as_dict() for key, cell in cells.items()}

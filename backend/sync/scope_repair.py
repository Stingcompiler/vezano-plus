"""إصلاح نطاق سجلات sync_log الفرعية المكتوبة بلا فرع (مراجعة 2026-10-26 بند 11).

قبل الإصلاح كان PUSH عبر HTTP لا يمرّر فرع الجهاز، و`log_reference` يكتب `scope_id` فارغاً — فلا
تصل تلك السجلات إلى سحب أي فرع. هنا تقرير أولاً (لا يكتب شيئاً)، ثم تطبيق صريح:
- عضو PUSH ← فرع الجهاز الذي رفع عمليته (`Operation.device`).
- مستند مكتوب خادمياً ← حقل فرعه في نموذجه.
- ما لا يُعرف فرعه يُعلن ولا يُخمَّن.
التطبيق يحجز لكل صف رقماً جديداً تحت قفل المستأجر: مؤشرات الأجهزة تجاوزت الرقم القديم، فبلا رقم
جديد لا ينزل الصف المصحَّح أبداً.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass

from core.models import Device
from core.tenancy import tenant_context
from sync.counter import lock_and_reserve
from sync.models import Member, Operation
from sync.models_log import SyncLog


def _doc_branch(model_path: str, field: str) -> Callable[[uuid.UUID], str | None]:
    def find(entity_id: uuid.UUID) -> str | None:
        from django.apps import apps

        app, name = model_path.split(".")
        model = apps.get_model(app, name)
        value = model._default_manager.filter(id=entity_id).values_list(field, flat=True).first()
        return str(value) if value else None

    return find


#: المستندات المكتوبة خادمياً بـ`log_reference` وحقل فرعها
DOCUMENT_BRANCH: dict[str, Callable[[uuid.UUID], str | None]] = {
    "sales.SaleReversal": _doc_branch("sales.SaleReversal", "branch_id"),
    "inventory.StockOpening": _doc_branch("inventory.StockOpening", "branch_id"),
    "inventory.StockAdjustment": _doc_branch("inventory.StockAdjustment", "branch_id"),
    "inventory.DamageRecord": _doc_branch("inventory.DamageRecord", "branch_id"),
    "inventory.StockTransfer": _doc_branch("inventory.StockTransfer", "branch_from_id"),
}


@dataclass(frozen=True)
class ScopeFix:
    entity: str
    entity_id: uuid.UUID
    branch_id: str | None
    source: str  # "device" | "document" | "unknown"


def find_unscoped(tenant_id: uuid.UUID) -> list[ScopeFix]:
    """كل صف فرعي بلا فرع مع الفرع المستنتج ومصدره — قراءة فقط."""
    out: list[ScopeFix] = []
    with tenant_context(tenant_id):
        rows = list(
            SyncLog.unscoped.filter(tenant_id=tenant_id, scope="branch", scope_id="").order_by(
                "server_seq"
            )
        )
        for r in rows:
            member = (
                Member.unscoped.filter(tenant_id=tenant_id, entity_id=r.entity_id)
                .select_related("operation")
                .first()
            )
            if member is not None:
                op: Operation = member.operation
                branch = (
                    Device.unscoped.filter(id=op.device).values_list("branch_id", flat=True).first()
                )
                out.append(
                    ScopeFix(
                        r.entity,
                        r.entity_id,
                        str(branch) if branch else None,
                        "device" if branch else "unknown",
                    )
                )
                continue
            find = DOCUMENT_BRANCH.get(r.entity)
            branch_id = find(r.entity_id) if find else None
            out.append(
                ScopeFix(r.entity, r.entity_id, branch_id, "document" if branch_id else "unknown")
            )
    return out


def apply_fixes(tenant_id: uuid.UUID, fixes: list[ScopeFix]) -> int:
    """يكتب الفرع المستنتج برقم جديد لكل صف معروف الفرع؛ المجهول يبقى كما هو. يعيد عدد المصحَّح."""
    known = [f for f in fixes if f.branch_id]
    if not known:
        return 0
    with tenant_context(tenant_id):
        _, first = lock_and_reserve(tenant_id, len(known))
        for offset, f in enumerate(known):
            SyncLog.unscoped.filter(
                tenant_id=tenant_id, entity=f.entity, entity_id=f.entity_id, scope_id=""
            ).update(scope_id=f.branch_id, server_seq=first + offset)
    return len(known)

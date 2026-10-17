"""PLT — سجل تدقيق المشغّلين (فحص 2026-10-17 VP13): كل فعل مشغّل مسجَّل في `OperatorAccessLog`
يُعرض في قسم واحد عبر الوحدات — من، ماذا، على أيّ مستأجر، ومتى — مع تصفية بالمشغّل والفئة
والمستأجر وصفحات بالمؤشّر. قراءة فقط: السجل لا يُعدَّل ولا يُحذف من الواجهة."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from django.db.models import Q
from django.utils.dateparse import parse_datetime

from core.models import User
from core.tenancy import platform_context
from stingops.models import OperatorAccessLog

PAGE = 50

# الفعل → تسمية عربية. ما لا تسمية له يُعرض برمزه (لا يُخفى فعلٌ لأنه جديد).
LABELS: dict[str, str] = {
    "login": "دخول",
    "logout": "خروج",
    "resume": "استئناف الجلسة",
    "operator.change_password": "تغيير كلمة المرور",
    "operator.create": "إنشاء مشغّل",
    "operator.enable": "تفعيل مشغّل",
    "operator.disable": "تعطيل مشغّل",
    "operator.reset_password": "إعادة تعيين كلمة مرور مشغّل",
    "operator.role": "تغيير دور مشغّل",
    "tenant_detail": "فتح سجل مستأجر",
    "plan.create": "إنشاء باقة",
    "entitlement_changed": "تغيير استحقاق",
    "flag_changed": "تغيير علم تشغيل",
    "m0_computed": "حساب مؤشّرات الشهر",
    "announcement_saved": "حفظ إعلان",
    "announcement_scheduled": "جدولة إعلان",
    "announcement_cancelled": "إلغاء إعلان",
    "proof_opened": "فتح إثبات دفع",
    "proof_image_viewed": "عرض صورة إثبات",
    "proof_approved": "اعتماد إثبات دفع",
    "proof_rejected": "رفض إثبات دفع",
    "proof_handover_requested": "طلب تسليم إثبات",
    "verification_doc_view": "عرض وثيقة تحقّق",
    "restore_drill": "تجربة استعادة معزولة",
    "live_restore_requested": "طلب استعادة حيّة",
    "live_restore_blocked": "استعادة حيّة مُنعت",
    "demo.update": "تحديث طلب جولة",
    "dispute_referred": "إحالة خلاف",
    "dispute_suggest": "اقتراح حلّ خلاف",
    "ledger_attempt_refused": "محاولة تعديل دفتر مرفوضة",
    "offer_suspended": "تعليق عرض",
    "report_closed": "إغلاق بلاغ",
}
PREFIX_LABELS: tuple[tuple[str, str], ...] = (
    ("plan.", "تعديل باقة"),
    ("subscription.", "إجراء اشتراك"),
    ("channel_", "حالة قناة إرسال"),
    ("verification_", "قرار تحقّق"),
    ("appeal_", "قرار اعتراض"),
)

# الفئات للتصفية — كل فئة مجموعة أفعال/بادئات
CATEGORIES: dict[str, tuple[str, tuple[str, ...]]] = {
    "session": ("الجلسات", ("login", "logout", "resume", "operator.change_password")),
    "tenants": ("المستأجرون والاشتراكات", ("tenant_detail", "subscription.")),
    "money": ("الدفع والتحقّق", ("proof_", "verification_")),
    "catalog": ("الباقات والاستحقاقات", ("plan.", "entitlement_changed", "flag_changed")),
    "market": ("السوق", ("dispute_", "offer_", "report_", "appeal_", "ledger_attempt_refused")),
    "ops": (
        "التشغيل",
        ("announcement_", "channel_", "restore_drill", "live_restore_", "m0_computed", "demo."),
    ),
    "operators": (
        "المشغّلون",
        (
            "operator.create",
            "operator.enable",
            "operator.disable",
            "operator.reset_password",
            "operator.role",
        ),
    ),
}


def action_label(action: str) -> str:
    if action in LABELS:
        return LABELS[action]
    for prefix, label in PREFIX_LABELS:
        if action.startswith(prefix):
            return label
    return action


def _category_q(code: str) -> Q | None:
    entry = CATEGORIES.get(code)
    if entry is None:
        return None
    q = Q()
    for part in entry[1]:
        q |= Q(action__startswith=part) if part.endswith((".", "_")) else Q(action=part)
    return q


def _uuid(raw: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(raw)
    except ValueError:
        return None


def audit_payload(params: dict[str, str]) -> dict[str, Any]:
    operator = params.get("operator", "")
    category = params.get("category", "")
    tenant = params.get("tenant", "")
    op_id, tenant_id = _uuid(operator), _uuid(tenant)
    # المؤشّر «وقت~معرّف»: فعلان في اللحظة نفسها لا يسقط أحدهما بين صفحتين
    at_raw, _, id_raw = params.get("before", "").partition("~")
    before: datetime | None = parse_datetime(at_raw) if at_raw else None
    before_id = _uuid(id_raw)
    with platform_context():
        rows = OperatorAccessLog.objects.select_related("operator", "tenant").order_by("-at", "-id")
        if operator:
            rows = rows.filter(operator_id=op_id) if op_id else rows.none()
        cq = _category_q(category)
        if cq is not None:
            rows = rows.filter(cq)
        if tenant:
            rows = rows.filter(tenant_id=tenant_id) if tenant_id else rows.none()
        if before is not None:
            tie = Q(at=before, id__lt=before_id) if before_id else Q(pk__in=[])
            rows = rows.filter(Q(at__lt=before) | tie)
        page = list(rows[: PAGE + 1])
        operators = list(
            User.objects.filter(is_platform_staff=True)
            .order_by("display_name")
            .values("id", "display_name")
        )
    more = len(page) > PAGE
    page = page[:PAGE]
    return {
        "entries": [
            {
                "id": str(r.id),
                "at": r.at.isoformat(),
                "operator_id": str(r.operator_id),
                "operator_name": r.operator.display_name,
                "tenant_id": str(r.tenant_id) if r.tenant_id else "",
                "tenant_name": r.tenant.name if r.tenant else "",
                "action": r.action,
                "action_label": action_label(r.action),
                "detail": r.detail,
                "ticket_ref": r.ticket_ref,
            }
            for r in page
        ],
        "next_before": f"{page[-1].at.isoformat()}~{page[-1].id}" if more and page else "",
        "operators": [{"id": str(o["id"]), "name": o["display_name"]} for o in operators],
        "categories": [{"code": k, "label": v[0]} for k, v in CATEGORIES.items()],
        "filters": {"operator": operator, "category": category, "tenant": tenant},
    }

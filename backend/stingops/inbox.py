"""الوارد وإشعارات فريق المنصة (0005 §١٩٠).

- **الرسائل**: رسائل الدعم التي يرسلها المالك من تطبيقه (`sync.SupportReport`، SYS-11) — كانت تُخزَّن
  ولا شاشة للمنصة تقرؤها. هنا تُقرأ عبر كل المنشآت (سياق المنصة) وتُفرز «جديدة/تمّت معالجتها».
- **الإشعارات**: `emit` يُنادى من نقاط وصول الأحداث (منشأة جديدة، إيصال، رسالة، طلب جولة، تحقّق،
  بلاغ). لا يكسر أبداً العملية الأصل: أي فشل يُسجَّل ويُتجاوز.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from django.utils import timezone

from core.models import Tenant
from core.tenancy import platform_context
from stingops.models import MessageTriage, OperatorNotice
from sync.models import SupportReport

log = logging.getLogger(__name__)

NOTICE_LIMIT = 100
MESSAGE_LIMIT = 100


class InboxRejected(Exception):
    def __init__(self, code: str, status: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def emit(
    kind: str, title: str, *, body: str = "", href: str = "", tenant_id: uuid.UUID | None = None
) -> None:
    """يُنشئ إشعاراً لفريق المنصة. لا يرفع استثناءً (الحدث الأصل أهم من إشعاره)."""
    try:
        with platform_context():
            OperatorNotice.objects.create(
                kind=kind,
                title=title[:200],
                body=body[:400],
                href=href[:200],
                tenant_id=tenant_id,
            )
    except Exception:  # noqa: BLE001 — الإشعار لا يكسر العملية الأصل
        log.exception("operator notice failed: %s", kind)


def _notice_row(n: OperatorNotice, tenant_names: dict[Any, str]) -> dict[str, Any]:
    return {
        "id": str(n.id),
        "kind": n.kind,
        "kind_label": OperatorNotice.Kind(n.kind).label,
        "title": n.title,
        "body": n.body,
        "href": n.href,
        "tenant_name": tenant_names.get(n.tenant_id, "") if n.tenant_id else "",
        "created_at": _iso(n.created_at),
        "read": n.read_at is not None,
        "read_by_name": n.read_by_name,
    }


def _new_messages_count() -> int:
    with platform_context():
        done = MessageTriage.objects.values_list("report_id", flat=True)
        return SupportReport.unscoped.exclude(id__in=done).count()


def notices_payload(*, unread_only: bool = False, limit: int = 50) -> dict[str, Any]:
    limit = max(1, min(limit, NOTICE_LIMIT))
    with platform_context():
        qs = OperatorNotice.objects.all()
        unread = qs.filter(read_at__isnull=True).count()
        if unread_only:
            qs = qs.filter(read_at__isnull=True)
        rows = list(qs.order_by("-created_at")[:limit])
        names = {
            t.id: t.name
            for t in Tenant.unscoped.filter(id__in={r.tenant_id for r in rows if r.tenant_id})
        }
    return {
        "unread": unread,
        "new_messages": _new_messages_count(),
        "notices": [_notice_row(r, names) for r in rows],
    }


def mark_read(*, ids: list[str] | None, by_name: str) -> dict[str, Any]:
    """يعلّم الإشعارات المذكورة (أو كلها إن لم تُذكر) مقروءة باسم المشغّل."""
    now = timezone.now()
    with platform_context():
        qs = OperatorNotice.objects.filter(read_at__isnull=True)
        if ids is not None:
            try:
                qs = qs.filter(id__in=[uuid.UUID(i) for i in ids])
            except ValueError:
                raise InboxRejected("ids_invalid") from None
        qs.update(read_at=now, read_by_name=by_name)
    return notices_payload()


def _report_row(
    r: SupportReport, tenants: dict[Any, str], handled: dict[Any, MessageTriage]
) -> dict[str, Any]:
    tri = handled.get(r.id)
    return {
        "id": str(r.id),
        "reference": r.reference,
        "tenant_name": tenants.get(r.tenant_id, ""),
        "from_name": r.user_name,
        "app_version": r.app_version,
        "note": r.note,
        "created_at": _iso(r.created_at),
        "handled": tri is not None,
        "handled_by_name": tri.handled_by_name if tri else "",
        "handled_at": _iso(tri.handled_at) if tri else "",
        "handled_note": tri.note if tri else "",
    }


def messages_payload(*, status_filter: str = "new") -> dict[str, Any]:
    if status_filter not in {"new", "handled", "all"}:
        status_filter = "new"
    with platform_context():
        reports = list(SupportReport.unscoped.order_by("-created_at")[: MESSAGE_LIMIT * 3])
        handled = {
            t.report_id: t
            for t in MessageTriage.objects.filter(report_id__in=[r.id for r in reports])
        }
        new_count = sum(1 for r in reports if r.id not in handled)
        if status_filter == "new":
            reports = [r for r in reports if r.id not in handled]
        elif status_filter == "handled":
            reports = [r for r in reports if r.id in handled]
        reports = reports[:MESSAGE_LIMIT]
        tenants = {
            t.id: t.name for t in Tenant.unscoped.filter(id__in={r.tenant_id for r in reports})
        }
    return {
        "filter": status_filter,
        "new_count": new_count,
        "messages": [_report_row(r, tenants, handled) for r in reports],
    }


def message_detail(report_id: uuid.UUID) -> dict[str, Any]:
    with platform_context():
        r = SupportReport.unscoped.filter(id=report_id).first()
        if r is None:
            raise InboxRejected("not_found", 404)
        handled = {t.report_id: t for t in MessageTriage.objects.filter(report_id=r.id)}
        tenants = {t.id: t.name for t in Tenant.unscoped.filter(id=r.tenant_id)}
    return {**_report_row(r, tenants, handled), "payload": r.payload}


def handle_message(report_id: uuid.UUID, *, note: str, by_name: str) -> dict[str, Any]:
    with platform_context():
        if not SupportReport.unscoped.filter(id=report_id).exists():
            raise InboxRejected("not_found", 404)
        _, created = MessageTriage.objects.get_or_create(
            report_id=report_id,
            defaults={"handled_by_name": by_name, "note": note.strip()[:300]},
        )
        if not created:
            raise InboxRejected("already_handled", 409)
    return message_detail(report_id)

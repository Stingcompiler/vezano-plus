"""«الملاحظات» في وارد فريق المنصة (0005 §٢٦٤) — قراءة ملاحظات التجار عبر كل المنشآت، وتغيير الحالة
(جديدة/قيد الدراسة/نُفّذت/لن تُنفّذ)، وردّ مكتوب يراه المرسل في «ملاحظاتي» مع تنبيه لجهازه."""

from __future__ import annotations

import logging
import uuid
from datetime import timedelta
from typing import Any

from django.utils import timezone

from core.models import Tenant
from core.tenancy import platform_context, tenant_context
from stingops.models import PublicFeedback
from sync.feedback import has_attachment, light
from sync.models import Feedback

log = logging.getLogger(__name__)

LIMIT = 300
REPLY_MAX = 600
FILTERS = {"open", "all", *Feedback.Status.values}


class FeedbackOpsRejected(Exception):
    def __init__(self, code: str, status: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def _row(f: Feedback, tenants: dict[Any, str]) -> dict[str, Any]:
    return {
        "id": str(f.id),
        "source": "merchant",
        "tenant_id": str(f.tenant_id),
        "tenant_name": tenants.get(f.tenant_id, ""),
        "reference": f.reference,
        "kind": f.kind,
        "kind_label": Feedback.Kind(f.kind).label,
        "text": f.text,
        "contact_ok": f.contact_ok,
        "contact_email": "",
        "from_name": f.user_name,
        "screen": f.screen,
        "platform": f.platform,
        "app_version": f.app_version,
        "status": f.status,
        "status_label": Feedback.Status(f.status).label,
        "reply": f.reply,
        "updated_by_name": f.updated_by_name,
        "updated_at": _iso(f.updated_at),
        "created_at": _iso(f.created_at),
        "has_attachment": has_attachment(f),
        "attachment_name": f.attachment_name,
        "emailed_at": "",
    }


def _public_row(f: PublicFeedback) -> dict[str, Any]:
    """ملاحظة زائر بشكل صفّ التاجر نفسه — `source=public`، بلا منشأة ولا جهاز."""
    return {
        "id": str(f.id),
        "source": "public",
        "tenant_id": "",
        "tenant_name": f.shop_name,
        "reference": f.reference,
        "kind": f.kind,
        "kind_label": PublicFeedback.Kind(f.kind).label,
        "text": f.text,
        "contact_ok": bool(f.contact_email),
        "contact_email": f.contact_email,
        "from_name": "",
        "screen": f.page,
        "platform": "public",
        "app_version": "",
        "status": f.status,
        "status_label": PublicFeedback.Status(f.status).label,
        "reply": f.reply,
        "updated_by_name": f.updated_by_name,
        "updated_at": _iso(f.updated_at),
        "created_at": _iso(f.created_at),
        "has_attachment": False,
        "attachment_name": "",
        "emailed_at": _iso(f.emailed_at),
    }


def _public_list(status_filter: str, kind: str) -> dict[str, Any]:
    with platform_context():
        qs = PublicFeedback.objects.all()
        counts = {s: qs.filter(status=s).count() for s in PublicFeedback.Status.values}
        if status_filter == "open":
            qs = qs.filter(status__in=[PublicFeedback.Status.NEW, PublicFeedback.Status.STUDYING])
        elif status_filter != "all":
            qs = qs.filter(status=status_filter)
        if kind in PublicFeedback.Kind.values:
            qs = qs.filter(kind=kind)
        rows = list(qs.order_by("-created_at")[:LIMIT])
    return {
        "source": "public",
        "filter": status_filter,
        "kind": kind if kind in PublicFeedback.Kind.values else "",
        "counts": counts,
        "items": [_public_row(r) for r in rows],
    }


SUMMARY_DAYS = 30


def summary() -> dict[str, dict[str, int]]:
    """0005 §٢٦٧: ما وصل في آخر 30 يوماً بالنوع — لكل مصدر. لا درجة ولا متوسط."""
    since = timezone.now() - timedelta(days=SUMMARY_DAYS)
    with platform_context():
        merchant = {
            k: Feedback.unscoped.filter(kind=k, created_at__gte=since).count()
            for k in Feedback.Kind.values
        }
        public = {
            k: PublicFeedback.objects.filter(kind=k, created_at__gte=since).count()
            for k in PublicFeedback.Kind.values
        }
    return {"merchant": merchant, "public": public}


def new_counts() -> dict[str, int]:
    with platform_context():
        return {
            "merchant": Feedback.unscoped.filter(status=Feedback.Status.NEW).count(),
            "public": PublicFeedback.objects.filter(status=PublicFeedback.Status.NEW).count(),
        }


def list_payload(
    *, status_filter: str = "open", kind: str = "", source: str = "merchant"
) -> dict[str, Any]:
    """`open` = جديدة + قيد الدراسة (الافتراضي). `source`: التجار (افتراضياً) أو الزوار (§٢٦٦)."""
    if status_filter not in FILTERS:
        status_filter = "open"
    if source == "public":
        return {**_public_list(status_filter, kind), "new": new_counts(), "summary": summary()}
    with platform_context():
        # 0005 §٢٧٣: القائمة بلا عمود اللقطة — تُطلب عند الفتح (`attachment`)
        qs = light(Feedback.unscoped.all())
        counts = {s: qs.filter(status=s).count() for s in Feedback.Status.values}
        if status_filter == "open":
            qs = qs.filter(status__in=[Feedback.Status.NEW, Feedback.Status.STUDYING])
        elif status_filter != "all":
            qs = qs.filter(status=status_filter)
        if kind in Feedback.Kind.values:
            qs = qs.filter(kind=kind)
        rows = list(qs.order_by("-created_at")[:LIMIT])
        tenants = {t.id: t.name for t in Tenant.unscoped.filter(id__in={r.tenant_id for r in rows})}
    return {
        "source": "merchant",
        "filter": status_filter,
        "kind": kind if kind in Feedback.Kind.values else "",
        "counts": counts,
        "items": [_row(r, tenants) for r in rows],
        "new": new_counts(),
        "summary": summary(),
    }


def update(
    tenant_id: uuid.UUID, feedback_id: uuid.UUID, *, status: str, reply: str, by_name: str
) -> dict[str, Any]:
    if status not in Feedback.Status.values:
        raise FeedbackOpsRejected("status_invalid")
    reply = reply.strip()
    if len(reply) > REPLY_MAX:
        raise FeedbackOpsRejected("reply_too_long")
    with platform_context():
        f = light(Feedback.unscoped.filter(tenant_id=tenant_id, id=feedback_id)).first()
        if f is None:
            raise FeedbackOpsRejected("not_found", 404)
        if f.status == status and f.reply == reply:
            raise FeedbackOpsRejected("unchanged", 409)
        f.status = status
        f.reply = reply
        f.updated_by_name = by_name[:200]
        f.updated_at = timezone.now()
        f.save(update_fields=["status", "reply", "updated_by_name", "updated_at"])
        tenants = {t.id: t.name for t in Tenant.unscoped.filter(id=f.tenant_id)}
    if f.device:
        _notify(f.tenant_id, f.device)
    return _row(f, tenants)


def _notify(tenant_id: uuid.UUID, device_id: uuid.UUID) -> None:
    """تنبيه لجهاز المرسل — لا يكسر الحفظ أبداً."""
    from core import push

    try:
        with tenant_context(tenant_id):
            push.notify_device(device_id, "feedback_reply")
    except Exception:  # noqa: BLE001 — التنبيه أقل أهمية من الردّ نفسه
        log.exception("feedback push failed")


def attachment(tenant_id: uuid.UUID, feedback_id: uuid.UUID) -> dict[str, Any]:
    """لقطة الشاشة المرفقة (§٢٦٧) — تُطلب عند الفتح لا مع القائمة."""
    with platform_context():
        f = Feedback.unscoped.filter(tenant_id=tenant_id, id=feedback_id).first()
    if f is None or not f.attachment:
        raise FeedbackOpsRejected("not_found", 404)
    return {"data_url": f.attachment, "name": f.attachment_name}


def _email_reply(f: PublicFeedback) -> str:
    """الردّ إلى بريد الزائر (§٢٦٧): نصّ بسيط — المرجع وردّ الفريق، بلا نصّ ملاحظته ولا روابط.
    يعيد `sent` أو `not_configured` أو `failed`."""
    import os

    sender = os.environ.get("STING_EMAIL_FROM", "")
    if not sender:
        return "not_configured"
    from django.core.mail import EmailMessage

    body = (
        f"شكراً لملاحظتك ({f.reference}).\n\n{f.reply}\n\n— فريق فيزانو بلص\n"
        "وصلتك هذه الرسالة لأنك تركت بريدك مع ملاحظتك في موقع فيزانو بلص."
    )
    try:
        EmailMessage(
            f"فيزانو بلص — ردّ على ملاحظتك {f.reference}", body, sender, [f.contact_email]
        ).send(fail_silently=False)
    except Exception:  # noqa: BLE001 — فشل البريد لا يُسقط حفظ الحالة
        log.warning("public feedback email failed", exc_info=True)
        return "failed"
    return "sent"


def update_public(
    feedback_id: uuid.UUID,
    *,
    status: str,
    reply: str,
    by_name: str,
    email_reply: bool = False,
) -> dict[str, Any]:
    """الحالة وردّ الفريق على ملاحظة زائر. `email_reply` يرسل الردّ إلى بريده إن تركه (§٢٦٧)؛ بدونه
    يبقى الردّ ملاحظة داخلية."""
    if status not in PublicFeedback.Status.values:
        raise FeedbackOpsRejected("status_invalid")
    reply = reply.strip()
    if len(reply) > REPLY_MAX:
        raise FeedbackOpsRejected("reply_too_long")
    with platform_context():
        f = PublicFeedback.objects.filter(id=feedback_id).first()
        if f is None:
            raise FeedbackOpsRejected("not_found", 404)
        if email_reply and not f.contact_email:
            raise FeedbackOpsRejected("no_email")
        if email_reply and not reply:
            raise FeedbackOpsRejected("reply_required")
        if f.status == status and f.reply == reply and not email_reply:
            raise FeedbackOpsRejected("unchanged", 409)
        f.status = status
        f.reply = reply
        f.updated_by_name = by_name[:200]
        f.updated_at = timezone.now()
        f.save(update_fields=["status", "reply", "updated_by_name", "updated_at"])
    email = ""
    if email_reply:
        email = _email_reply(f)
        if email == "sent":
            with platform_context():
                f.emailed_at = timezone.now()
                f.save(update_fields=["emailed_at"])
    return {**_public_row(f), "email": email}

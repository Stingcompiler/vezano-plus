"""0005 §٢١٦ — الإشعارات الفورية لفريق المنصة: متصفح المشغّل يشترك في Web Push، وكل إشعار يصل
صندوق الفريق (`inbox.emit`: منشأة بانتظار الاعتماد، إيصال، رسالة، طلب جولة، تحقّق، بلاغ) يُدفع
فوراً لكل متصفح مشترك لمشغّل نشط — بدل انتظار تحديث القائمة كل دقيقة. العنوان نوع الحدث وحده،
بلا اسم منشأة ولا مبلغ."""

from __future__ import annotations

import hashlib
from typing import Any

from django.utils import timezone

from core import push
from core.models import User
from core.push_dispatch import settled
from core.tenancy import platform_context
from stingops.models import OperatorNotice, OperatorPushEndpoint

MAX_AGE_HOURS = 6


def _sha(endpoint: str) -> str:
    return hashlib.sha256(endpoint.encode("utf-8")).hexdigest()


def status(user: User) -> dict[str, Any]:
    with platform_context():
        ep = OperatorPushEndpoint.objects.filter(user=user, expired_at__isnull=True).first()
    return {
        "configured": push.push_configured(),
        "public_key": push.vapid_public_key(),
        "subscribed": ep is not None,
    }


def subscribe(
    user: User, *, endpoint: str, p256dh: str, auth: str, user_agent: str = ""
) -> dict[str, Any]:
    digest = _sha(endpoint)
    with platform_context():
        OperatorPushEndpoint.objects.update_or_create(
            endpoint_sha256=digest,
            defaults={
                "user": user,
                "endpoint": endpoint,
                "p256dh": p256dh,
                "auth": auth,
                "user_agent": user_agent[:300],
                "expired_at": None,
                "last_error": "",
            },
        )
    return status(user)


def unsubscribe(user: User, *, endpoint: str = "") -> dict[str, Any]:
    with platform_context():
        qs = OperatorPushEndpoint.objects.filter(user=user, expired_at__isnull=True)
        if endpoint:
            qs = qs.filter(endpoint_sha256=_sha(endpoint))
        qs.update(expired_at=timezone.now(), last_error="unsubscribed")
    return status(user)


def dispatch() -> int:
    """يرسل إشعارات الفريق التي لم تُرسل؛ القديم يوسم بلا إرسال."""
    now = timezone.now()
    sent = 0
    with platform_context():
        pending = list(OperatorNotice.objects.filter(pushed_at__isnull=True).order_by("created_at"))
        if not pending:
            return 0
        endpoints = list(
            OperatorPushEndpoint.objects.filter(
                expired_at__isnull=True, user__is_active=True, user__is_platform_staff=True
            )
        )
        for n in pending:
            reasons: list[str] = []
            if endpoints and (now - n.created_at).total_seconds() <= MAX_AGE_HOURS * 3600:
                label = OperatorNotice.Kind(n.kind).label
                path = n.href if n.href.startswith("/platform") else "/platform/notices"
                for ep in endpoints:
                    out = push.deliver(
                        ep,
                        title=f"إدارة فيزانو — {label}",
                        body="وصل ما ينتظر نظر الفريق.",
                        path=path,
                        tag=f"plt-{n.id}",
                    )
                    sent += int(bool(out.get("sent")))
                    reasons.append("sent" if out.get("sent") else str(out.get("reason", "")))
            if not settled(reasons, n.created_at, now):
                continue  # فشل عابر عند المزوّد: يُعاد في الدورة التالية
            n.pushed_at = now
            n.save(update_fields=["pushed_at"])
    return sent

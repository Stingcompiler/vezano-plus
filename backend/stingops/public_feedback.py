"""ملاحظات الزوار (0005 §٢٦٦) — الموقع العام وصفحة المحل، بلا حساب، **خاصة بفريق فيزانو**.

- لا تُنشر ولا تُحوَّل إلى المحل؛ «ملاحظة عن محل» تحمل اسم المحل لسياق الفريق فقط؛
- لا يُحفظ عنوان الزائر — بصمته المجزّأة بسرّ الخادم (`visitor_key`) تكفي للحدّ؛
- الحدّ: 5 ملاحظات في الساعة للزائر و60 في الساعة للموقع كله؛ حقل فخّ مخفي (`website`) يُسقط
  البرامج الآلية بصمت (ردّ نجاح بلا حفظ) فلا تتعلّم الشرط؛
- النص حتى 600 حرف؛ ما يشبه رقم هاتف يُخفى والروابط تُحذف؛ البريد اختياري للردّ.
"""

from __future__ import annotations

import hashlib
import re
from datetime import timedelta
from typing import Any

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from core.tenancy import platform_context
from stingops.models import PublicFeedback
from sync.feedback import mask_phones

TEXT_MAX = 600
PER_VISITOR_PER_HOUR = 5
SITE_PER_HOUR = 60
LINK = "[رابط]"
_URL_RE = re.compile(
    r"(?:https?://|www\.)\S+|\b[\w-]+\.(?:com|net|org|io|app|sd|info|xyz)\S*", re.I
)
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_SLUG_RE = re.compile(r"^[a-z0-9-]{1,24}$")


class PublicFeedbackRejected(Exception):
    def __init__(self, code: str, status: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


def visitor_key(ip: str) -> str:
    return hashlib.sha256(f"{settings.SECRET_KEY}:pubfb:{ip}".encode()).hexdigest()


def clean_text(text: str) -> str:
    return mask_phones(_URL_RE.sub(LINK, text))


def _shop_name(slug: str) -> str:
    from core.models import PortalChannel, Tenant

    with platform_context():
        ch = PortalChannel.unscoped.filter(slug=slug).first()
        if ch is None:
            return ""
        t = Tenant.unscoped.filter(id=ch.tenant_id).first()
    return t.name if t else ""


def submit(data: dict[str, Any], *, ip: str) -> dict[str, Any]:
    if str(data.get("website") or "").strip():
        # فخّ: ردّ يشبه النجاح بلا حفظ ولا إشعار
        return {"reference": "PF-000000-0000", "created": False}
    kind = str(data.get("kind") or "")
    if kind not in PublicFeedback.Kind.values:
        raise PublicFeedbackRejected("kind_invalid")
    text = str(data.get("text") or "").strip()
    if not text:
        raise PublicFeedbackRejected("text_required")
    if len(text) > TEXT_MAX:
        raise PublicFeedbackRejected("text_too_long")
    email = str(data.get("email") or "").strip().lower()[:254]
    if email and not _EMAIL_RE.match(email):
        raise PublicFeedbackRejected("email_invalid")
    slug = str(data.get("shop") or "").strip().lower()
    if slug and not _SLUG_RE.match(slug):
        slug = ""
    shop_name = _shop_name(slug) if slug else ""
    if kind == PublicFeedback.Kind.SHOP and not shop_name:
        raise PublicFeedbackRejected("shop_unknown")
    page = str(data.get("page") or "").strip()[:200]
    if not page.startswith("/"):
        page = ""
    key = visitor_key(ip)
    now = timezone.now()
    since = now - timedelta(hours=1)
    with platform_context():
        recent = PublicFeedback.objects.filter(created_at__gte=since)
        if recent.filter(visitor_key=key).count() >= PER_VISITOR_PER_HOUR:
            raise PublicFeedbackRejected("rate_limited", 429)
        if recent.count() >= SITE_PER_HOUR:
            raise PublicFeedbackRejected("rate_limited", 429)
        seq = PublicFeedback.objects.filter(created_at__date=now.date()).count() + 1
        f: PublicFeedback | None = None
        for attempt in range(5):
            try:
                with transaction.atomic():
                    f = PublicFeedback.objects.create(
                        reference=f"PF-{now:%y%m%d}-{seq + attempt:04d}",
                        kind=kind,
                        text=clean_text(text),
                        contact_email=email,
                        page=page,
                        shop_slug=slug if shop_name else "",
                        shop_name=shop_name,
                        visitor_key=key,
                        created_at=now,
                    )
                break
            except IntegrityError:  # زائران في اللحظة نفسها: الرقم التالي
                continue
        if f is None:
            raise PublicFeedbackRejected("server_busy", 503)
    from stingops.inbox import emit

    title = f"ملاحظة زائر {f.reference} · {PublicFeedback.Kind(kind).label}"
    if shop_name:
        title += f" · {shop_name}"
    emit("feedback", title, body=f.text[:200], href="/platform/feedback?source=public")
    return {"reference": f.reference, "created": True}

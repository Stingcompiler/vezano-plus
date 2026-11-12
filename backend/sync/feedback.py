"""ملاحظات التجار إلى فريق فيزانو (0005 §٢٦٣) — جانب المنشأة.

- يرسلها **أي دور** (لا تحمل بيانات المنشأة): نوع (اقتراح/مشكلة/رأي) ونصّ وخانة «يمكن للفريق التواصل
  معي»، ومعها تلقائياً الشاشة والمنصة وإصدار التطبيق؛
- ما يشبه رقم هاتف في النص يُخفى قبل الحفظ (لا أرقام زبائن تخرج من المنشأة)؛
- حدود: 5 ملاحظات يومياً لكل مستخدم و20 لكل منشأة؛
- `client_id` يجعل إعادة الإرسال من الطابور المحلي (بلا اتصال) آمنة: الإرسال الثاني يعيد الأولى؛
- كل مستخدم يرى ملاحظاته هو وحالتها وردّ الفريق في «ملاحظاتي»، و`unseen` = تحديثات لم يرها بعد.
"""

from __future__ import annotations

import re
import uuid
from datetime import timedelta
from typing import Any

from django.db import IntegrityError, transaction
from django.utils import timezone

from sync.models import Feedback

TEXT_MAX = 1000
PER_USER_PER_DAY = 5
PER_TENANT_PER_DAY = 20
PLATFORMS = {"web", "mobile", "desktop"}
MASK = "•••"

_DIGIT = "[0-9٠-٩۰-۹]"
# تسعة أرقام فأكثر، تفصلها مسافة أو شرطة أو نقطة اختيارياً، وقد تبدأ بـ«+»
PHONE_RE = re.compile(rf"\+?(?:{_DIGIT}[\s\-.]?){{8,}}{_DIGIT}")


class FeedbackRejected(Exception):
    def __init__(self, code: str, status: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


def mask_phones(text: str) -> str:
    return PHONE_RE.sub(MASK, text)


def _iso(dt: Any) -> str:
    return dt.isoformat().replace("+00:00", "Z") if dt else ""


def row(f: Feedback) -> dict[str, Any]:
    """ما يراه المرسل — بلا اسم المشغّل (الفريق يردّ باسم «فريق فيزانو»)."""
    return {
        "id": str(f.id),
        "client_id": str(f.client_id),
        "reference": f.reference,
        "kind": f.kind,
        "kind_label": Feedback.Kind(f.kind).label,
        "text": f.text,
        "contact_ok": f.contact_ok,
        "status": f.status,
        "status_label": Feedback.Status(f.status).label,
        "reply": f.reply,
        "created_at": _iso(f.created_at),
        "updated_at": _iso(f.updated_at),
        "unseen": bool(f.updated_at and (f.seen_at is None or f.seen_at < f.updated_at)),
    }


def submit(
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    user_name: str,
    device_id: uuid.UUID | None,
    client_id: uuid.UUID,
    kind: str,
    text: str,
    contact_ok: bool,
    screen: str,
    platform: str,
    app_version: str,
) -> tuple[Feedback, bool]:
    """يُنادى داخل `tenant_context`. يعيد (الملاحظة، أُنشئت الآن؟)."""
    existing = Feedback.objects.filter(client_id=client_id).first()
    if existing is not None:
        return existing, False
    if kind not in Feedback.Kind.values:
        raise FeedbackRejected("kind_invalid")
    text = text.strip()
    if not text:
        raise FeedbackRejected("text_required")
    if len(text) > TEXT_MAX:
        raise FeedbackRejected("text_too_long")
    since = timezone.now() - timedelta(days=1)
    recent = Feedback.objects.filter(created_at__gte=since)
    if recent.filter(user=user_id).count() >= PER_USER_PER_DAY:
        raise FeedbackRejected("rate_limited", 429)
    if recent.count() >= PER_TENANT_PER_DAY:
        raise FeedbackRejected("rate_limited", 429)
    now = timezone.now()
    seq = Feedback.objects.count() + 1
    try:
        with transaction.atomic():
            f = Feedback.objects.create(
                tenant_id=tenant_id,
                reference=f"FB-{now:%y%m%d}-{seq:04d}",
                client_id=client_id,
                kind=kind,
                text=mask_phones(text),
                contact_ok=contact_ok,
                screen=screen.strip()[:40],
                platform=platform if platform in PLATFORMS else "",
                app_version=app_version.strip()[:40],
                user=user_id,
                user_name=user_name[:200],
                device=device_id,
                created_at=now,
            )
    except IntegrityError:
        # إرسالان متزامنان بالمعرّف نفسه (طابور محلي + نقرة): الأول يكسب
        again = Feedback.objects.filter(client_id=client_id).first()
        if again is None:
            raise
        return again, False
    return f, True


def mine(user_id: uuid.UUID) -> dict[str, Any]:
    rows = [row(f) for f in Feedback.objects.filter(user=user_id).order_by("-created_at")[:50]]
    return {"items": rows, "unseen": sum(1 for r in rows if r["unseen"])}


def mark_seen(user_id: uuid.UUID) -> dict[str, Any]:
    Feedback.objects.filter(user=user_id, updated_at__isnull=False).update(seen_at=timezone.now())
    return mine(user_id)

"""ملاحظات التجار إلى فريق فيزانو (0005 §٢٦٤) — جانب المنشأة.

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
from django.db.models import BooleanField, Case, QuerySet, Value, When
from django.utils import timezone

from sync.models import Feedback

TEXT_MAX = 1000
PER_USER_PER_DAY = 5
PER_TENANT_PER_DAY = 20
PLATFORMS = {"web", "mobile", "desktop"}
MASK = "•••"
#: 0005 §٢٦٧: لقطة الشاشة — صورة فقط، حتى 1.5 ميغابايت (طول base64 ≈ 4/3 الحجم)
ATTACHMENT_MAX_CHARS = 2_000_000
_ATTACHMENT_RE = re.compile(r"^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$")

_DIGIT = "[0-9٠-٩۰-۹]"
# تسعة أرقام فأكثر، تفصلها مسافة أو شرطة أو نقطة اختيارياً، وقد تبدأ بـ«+»
PHONE_RE = re.compile(rf"\+?(?:{_DIGIT}[\s\-.]?){{8,}}{_DIGIT}")
# 0005 §٢٧٦: رقم الفاتورة أو المرتجع بصيغته (§٨.٢) — `INV-KRT-A2-26-000001` — ليس رقم هاتف
DOC_NUMBER_RE = re.compile(
    r"(?<![A-Za-z0-9])(?:INV|RET)-[A-Z0-9]{1,6}-[A-Z0-9]{1,6}-[0-9]{2}-[0-9]{6,8}(?![0-9])",
    re.IGNORECASE,
)
_MASKABLE_RE = re.compile(
    rf"(?P<doc>{DOC_NUMBER_RE.pattern})|(?P<num>{PHONE_RE.pattern})", re.IGNORECASE
)
_ASCII_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
#: بادئات هاتف دولية بلا «+» — لا تُعامل باركوداً ولو صحّت خانة تحققها
_PHONE_PREFIXES = ("00", "249")


class FeedbackRejected(Exception):
    def __init__(self, code: str, status: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


def light(qs: QuerySet[Feedback]) -> QuerySet[Feedback]:
    """للقوائم (0005 §٢٧٣): بلا عمود اللقطة (حتى 2 ميغابايت للصف) — يكفيها أن تعرف هل توجد لقطة."""
    return qs.defer("attachment").annotate(
        has_shot=Case(
            When(attachment="", then=Value(False)),
            default=Value(True),
            output_field=BooleanField(),
        )
    )


def has_attachment(f: Feedback) -> bool:
    flag = getattr(f, "has_shot", None)
    return bool(f.attachment) if flag is None else bool(flag)


def is_barcode(digits: str) -> bool:
    """باركود قياسي (UPC-A / EAN-13 / GTIN-14): 12–14 خانة متصلة تصحّ خانة تحققها (GS1).

    رقم الهاتف العشوائي لا يجتاز الخانة إلا مرة من عشر، ولا يكون بهذا الطول إلا ببادئة دولية —
    وتلك مستثناة — فالباب المفتوح ضيق: رقم أجنبي من 12–14 خانة كُتب متصلاً بلا «+» ولا «00»."""
    if not digits.isascii() or not digits.isdigit() or len(digits) not in (12, 13, 14):
        return False
    if digits.startswith(_PHONE_PREFIXES):
        return False
    body, check = digits[:-1], int(digits[-1])
    total = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(body)))
    return (10 - total % 10) % 10 == check


def mask_phones(text: str) -> str:
    """يخفي ما يشبه رقم هاتف، ويُبقي ما يحتاجه الفريق ليفهم البلاغ (0005 §٢٧٦): رقم الفاتورة
    بصيغته، والباركود القياسي المتصل. ما سوى ذلك من تسعة أرقام فأكثر يُخفى كما كان."""

    def swap(m: re.Match[str]) -> str:
        if m.group("doc"):
            return m.group(0)
        found = m.group(0)
        return found if is_barcode(found.translate(_ASCII_DIGITS)) else MASK

    return _MASKABLE_RE.sub(swap, text)


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
        "has_attachment": has_attachment(f),
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
    attachment: str = "",
    attachment_name: str = "",
) -> tuple[Feedback, bool]:
    """يُنادى داخل `tenant_context`. يعيد (الملاحظة، أُنشئت الآن؟)."""
    existing = light(Feedback.objects.filter(client_id=client_id)).first()
    if existing is not None:
        return existing, False
    if kind not in Feedback.Kind.values:
        raise FeedbackRejected("kind_invalid")
    text = text.strip()
    if not text:
        raise FeedbackRejected("text_required")
    if len(text) > TEXT_MAX:
        raise FeedbackRejected("text_too_long")
    if attachment and (
        len(attachment) > ATTACHMENT_MAX_CHARS or not _ATTACHMENT_RE.match(attachment)
    ):
        raise FeedbackRejected("attachment_invalid")
    since = timezone.now() - timedelta(days=1)
    recent = Feedback.objects.filter(created_at__gte=since)
    if recent.filter(user=user_id).count() >= PER_USER_PER_DAY:
        raise FeedbackRejected("rate_limited", 429)
    if recent.count() >= PER_TENANT_PER_DAY:
        raise FeedbackRejected("rate_limited", 429)
    now = timezone.now()
    seq = 0
    for _ in range(5):
        # ملاحظتان من المنشأة في اللحظة نفسها تحسبان الرقم نفسه: الخاسرة تأخذ التالي (0005 §٢٧٣)
        seq = max(Feedback.objects.count() + 1, seq + 1)
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
                    attachment=attachment,
                    attachment_name=attachment_name.strip()[:120] if attachment else "",
                    created_at=now,
                )
            return f, True
        except IntegrityError:
            # إرسالان متزامنان بالمعرّف نفسه (طابور محلي + نقرة): الأول يكسب
            again = light(Feedback.objects.filter(client_id=client_id)).first()
            if again is not None:
                return again, False
    raise FeedbackRejected("server_busy", 503)


def mine(user_id: uuid.UUID) -> dict[str, Any]:
    rows = [
        row(f) for f in light(Feedback.objects.filter(user=user_id)).order_by("-created_at")[:50]
    ]
    return {"items": rows, "unseen": sum(1 for r in rows if r["unseen"])}


def mark_seen(user_id: uuid.UUID) -> dict[str, Any]:
    Feedback.objects.filter(user=user_id, updated_at__isnull=False).update(seen_at=timezone.now())
    # من رأى الردّ في «ملاحظاتي» لا يبقى إشعاره في الوارد غير مقروء (0005 §٢٧٥)
    from core.models import Notification

    uid = str(user_id)
    for n in Notification.objects.filter(kind="feedback_reply", for_user=user_id):
        ids = [str(x) for x in (n.read_user_ids or [])]
        if uid not in ids:
            n.read_user_ids = [*ids, uid]
            n.save(update_fields=["read_user_ids"])
    return mine(user_id)

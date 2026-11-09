"""إيصال إعلانات المنصة إلى المتاجر (0005 §٢٣١).

- **الجمهور:** كل المتاجر، أو ذات السوق، أو باقة، أو حالة اشتراك، أو متجر واحد (`targets`).
- **الإيصال:** إشعار في صندوق كل متجر مستهدف (`notifications.emit` بمفتاح `ann:<id>` فلا تكرار)،
  والموزّع الفوري يرسله لمن فعّل فئته؛ إعلان بلا «فوري» يوسم مرسَلاً فلا يُدفع. والبريد لمالكي
  المتاجر إن اختاره المشغّل: لكل الأنواع لمن فعّل بريد «حسابي»، وللصيانة والتنبيه وتذكير الدفع دائماً.
- **التوقيت:** الصيانة تُبلَّغ فور جدولتها (إنذار مسبق)، والباقي عند بدء نافذته. `deliver_due`
  يُستدعى عند الجدولة ومن دورة الموزّع.
- **الإلغاء** يُنهي إشعارات الإعلان في الصناديق (`resolved_at`) فيختفي شريطه.
- **الشريط:** `active_for_tenant` يعيد ما وصل إلى هذا المتجر ولم تنتهِ نافذته ولم يُلغَ.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime
from typing import Any

from django.utils import timezone

from core.models import Notification, NotificationPreference, Tenant, TenantSubscription, User
from core.tenancy import platform_context, tenant_context
from stingops.models import PlatformAnnouncement

log = logging.getLogger(__name__)

KIND = PlatformAnnouncement.Kind
AUD = PlatformAnnouncement.Audience

#: فئة الإشعار لكل نوع: التشغيلي لا يُطفأ داخل التطبيق، و«حسابي» يُدفع افتراضياً
CATEGORY = {
    KIND.MAINTENANCE: "operational",
    KIND.ALERT: "operational",
    KIND.PAYMENT: "account",
    KIND.FEATURE: "account",
    KIND.OFFER: "account",
    KIND.NOTICE: "account",
}
#: أنواع تمسّ الخدمة نفسها: بريدها يصل المالك ولو أطفأ بريد «حسابي»
CRITICAL = frozenset({KIND.MAINTENANCE, KIND.ALERT, KIND.PAYMENT})
#: مجموعات حالة الاشتراك كما يحسبها `services.tenant_row`
STATUS_GROUPS: dict[str, frozenset[str]] = {
    "active": frozenset({"active", "sync_late"}),
    "trial": frozenset({"trial"}),
    "late": frozenset({"expired", "payment_pending"}),
    "suspended": frozenset({"suspended"}),
    "pending_approval": frozenset({"pending_approval"}),
}
STATUS_LABELS = {
    "active": "نشط",
    "trial": "تجريبي",
    "late": "متأخر الدفع أو منتهٍ",
    "suspended": "موقوف",
    "pending_approval": "بانتظار الاعتماد",
}
KIND_NOTIFY = "platform_announcement"


def targets(audience: str, value: str = "") -> set[uuid.UUID]:
    """معرّفات المتاجر المستهدفة. قيمة ناقصة أو غير معروفة تعني لا أحد، لا الكل."""
    from stingops.review import _market_tenant_ids

    with platform_context():
        all_ids = set(Tenant.unscoped.values_list("id", flat=True))
        if audience == AUD.ALL:
            return all_ids
        if audience == AUD.MARKET:
            return _market_tenant_ids() & all_ids
        if audience == AUD.TENANT:
            try:
                tid = uuid.UUID(value)
            except ValueError:
                return set()
            return {tid} & all_ids
        if audience == AUD.PLAN:
            if not value:
                return set()
            subs = dict(TenantSubscription.unscoped.values_list("tenant_id", "plan_code"))
            return {t for t in all_ids if subs.get(t, "trial") == value}
        if audience == AUD.STATUS:
            group = STATUS_GROUPS.get(value)
            if group is None:
                return set()
            from stingops.services import tenant_row

            now = timezone.now()
            return {t.id for t in Tenant.unscoped.all() if tenant_row(t, now)["status"] in group}
    return set()


def audience_value_label(audience: str, value: str) -> str:
    if audience == AUD.STATUS:
        return STATUS_LABELS.get(value, value)
    if audience == AUD.PLAN:
        from core.subscription import PLANS

        plan = PLANS.get(value)
        return plan.name if plan else value
    if audience == AUD.TENANT:
        try:
            tid = uuid.UUID(value)
        except ValueError:
            return ""
        with platform_context():
            t = Tenant.unscoped.filter(id=tid).first()
        return t.name if t else ""
    return ""


def _owner_emails(tenant_id: uuid.UUID, *, critical: bool) -> list[str]:
    """بريد مالكي المتجر: معرّف حسابه أو وجهة البريد في تفضيلاته؛ لغير الحرج من فعّل بريد «حسابي»."""
    out: list[str] = []
    with tenant_context(tenant_id):
        for u in User.objects.filter(is_owner=True, is_active=True).select_related("account"):
            p = NotificationPreference.objects.filter(user_id=u.id).first()
            wants = bool(p and (p.prefs or {}).get("account", {}).get("email"))
            if not critical and not wants:
                continue
            ident = u.account.identifier if u.account else ""
            email = (p.destination_email if p else "") or (ident if "@" in ident else "")
            if email:
                out.append(email)
    return out


def _send_mail(to: list[str], a: PlatformAnnouncement) -> int:
    """نصّ بسيط بلا قالب تسويقي: العنوان والنصّ والنافذة. بلا إعداد بريد على الخادم لا يُرسل شيء."""
    sender = os.environ.get("STING_EMAIL_FROM", "")
    if not to or not sender:
        return 0
    from django.core.mail import EmailMessage

    window = f"من {_local(a.starts_at)} إلى {_local(a.ends_at)} بتوقيت الخرطوم."
    text = f"{a.body}\n\n{window}\n\n— فريق فيزانو بلص"
    sent = 0
    for addr in to:
        try:
            EmailMessage(f"فيزانو بلص — {a.title}", text, sender, [addr]).send(fail_silently=False)
            sent += 1
        except Exception:  # noqa: BLE001 — بريد فاشل لا يوقف الإيصال داخل التطبيق
            log.warning("announcement email failed", exc_info=True)
    return sent


def _local(dt: datetime) -> str:
    from stingops.analytics import KHARTOUM

    return dt.astimezone(KHARTOUM).strftime("%Y-%m-%d %H:%M")


def deliver(a: PlatformAnnouncement, now: datetime | None = None) -> int:
    """يكتب الإعلان في صناديق جمهوره مرة واحدة. يعيد عدد المتاجر."""
    now = now or timezone.now()
    ids = targets(a.audience, a.audience_value)
    href = a.cta_url if a.cta_url.startswith("/") else "/notify/inbox"
    emailed = 0
    for tid in ids:
        try:
            with tenant_context(tid):
                from core import notifications

                n = notifications.emit(
                    kind=KIND_NOTIFY,
                    category=CATEGORY.get(PlatformAnnouncement.Kind(a.kind), "account"),
                    title=a.title,
                    body=a.body,
                    href=href,
                    screen="NOT-01",
                    needs_action=a.kind in {KIND.ALERT, KIND.PAYMENT},
                    dedupe_key=f"ann:{a.id}",
                    expires_at=a.ends_at,
                    occurred_at=now,
                )
                if not a.send_push and n.pushed_at is None:
                    n.pushed_at = now
                    n.save(update_fields=["pushed_at"])
            if a.send_email:
                emailed += _send_mail(_owner_emails(tid, critical=a.kind in CRITICAL), a)
        except Exception:  # noqa: BLE001 — متجر واحد لا يوقف البقية
            log.exception("announcement delivery failed for %s", tid)
    a.delivered_at = now
    a.delivered_count = len(ids)
    a.emailed_count = emailed
    a.save(update_fields=["delivered_at", "delivered_count", "emailed_count"])
    return len(ids)


def deliver_due(now: datetime | None = None) -> int:
    """ما حان إيصاله: مجدول لم يصل، نافذته لم تنتهِ، وصيانة (إنذار مسبق) أو بدأت نافذته."""
    now = now or timezone.now()
    due = PlatformAnnouncement.objects.filter(
        status=PlatformAnnouncement.Status.SCHEDULED, delivered_at__isnull=True, ends_at__gt=now
    )
    count = 0
    for a in due:
        if a.kind == KIND.MAINTENANCE or a.starts_at <= now:
            count += deliver(a, now)
    return count


def withdraw(a: PlatformAnnouncement, now: datetime | None = None) -> None:
    """إلغاء بعد الإيصال: يُنهي إشعارات الإعلان في كل الصناديق فيختفي شريطه."""
    now = now or timezone.now()
    for tid in targets(a.audience, a.audience_value):
        with tenant_context(tid):
            Notification.objects.filter(dedupe_key=f"ann:{a.id}", resolved_at__isnull=True).update(
                resolved_at=now
            )


def active_for_tenant(now: datetime | None = None) -> list[dict[str, Any]]:
    """الإعلانات النافذة لهذا المتجر (داخل سياقه): وصلت إليه، لم تنتهِ، ولم تُلغَ."""
    now = now or timezone.now()
    keys = list(
        Notification.objects.filter(
            kind=KIND_NOTIFY, resolved_at__isnull=True, expires_at__gt=now
        ).values_list("dedupe_key", flat=True)
    )
    ids = []
    for k in keys:
        try:
            ids.append(uuid.UUID(k.removeprefix("ann:")))
        except ValueError:
            continue
    rows = PlatformAnnouncement.objects.filter(
        id__in=ids, status=PlatformAnnouncement.Status.SCHEDULED, ends_at__gt=now
    ).order_by("starts_at")
    return [
        {
            "id": str(a.id),
            "kind": a.kind,
            "kind_label": PlatformAnnouncement.Kind(a.kind).label,
            "title": a.title,
            "body": a.body,
            "starts_at": a.starts_at.isoformat().replace("+00:00", "Z"),
            "ends_at": a.ends_at.isoformat().replace("+00:00", "Z"),
            "active": a.starts_at <= now,
            "cta_label": a.cta_label,
            "cta_url": a.cta_url,
        }
        for a in rows
    ]

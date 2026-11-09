"""الإشعارات الفورية (0005 §٢١٦): موزّع Web Push للتجار ولفريق المنصة.

- **لا إرسال داخل الطلب.** `notifications.emit` و`stingops.inbox.emit` يكتبان الإشعار فقط، والموزّع
  (`manage.py push_dispatch --loop` في حاوية العامل) يرسل ما لم يُرسل كل بضع ثوانٍ، ثم يوسمه
  `pushed_at` — مرة واحدة، لا عند كل إحياء بمفتاح التكرار.
- **التشغيلي يُشتقّ دورياً.** الوردية المهجورة والبنود المحجوزة لا تُكتب لحظة حدوثها بل حين يُشتقّ
  الصندوق (`notifications.refresh`)، فيشتقّه الموزّع لكل منشأة لها أجهزة مشتركة كل بضع دقائق.
- **من يستلم:** صاحب كل اشتراك فعّال (جهاز ومستخدمه)، ما دام نشطاً، والإشعار ظاهر له في صندوقه
  (ما يخصّ المالك للمالك وحده؛ ما يخصّ فرعاً لمن له وصول إليه)، وقناة «فوري» مفعّلة لفئته.
- **ساعات الهدوء** (اختيارية لكل مستخدم): 11 مساءً – 7 صباحاً بتوقيت الخرطوم، لا يُرسل إلا ما
  يحتاج تصرّفاً.
- **لا محتوى حساس:** عنوان ثابت لكل فئة بلا أسماء ولا مبالغ، والنقر يفتح الشاشة المعنية.
- **القديم لا يُرسل:** ما مضى عليه أكثر من `MAX_AGE` يوسم دون إرسال (جهاز عاد بعد انقطاع لا يُغرق).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from typing import Any

from django.utils import timezone

from core import notifications, push
from core.models import (
    Device,
    DeviceEndpoint,
    Notification,
    NotificationPreference,
    User,
    UserBranchAccess,
)
from core.tenancy import platform_context, tenant_context

log = logging.getLogger(__name__)

MAX_AGE = timedelta(hours=6)
#: مراجعة 2026-11-08: فشل عابر عند المزوّد (5xx/شبكة) يُعاد في الدورات التالية خلال هذه المدة؛
#: الانتهاء (404/410) ونجاح أي إرسال يوسمان فوراً. بعد النافذة يوسم الإشعار ولا يُعاد.
RETRY_WINDOW = timedelta(minutes=10)
PERMANENT = frozenset({"expired", "push_not_configured"})
#: توقيت الخرطوم ثابت (UTC+2، بلا توقيت صيفي)
KHARTOUM = dt_timezone(timedelta(hours=2))
QUIET_FROM, QUIET_TO = 23, 7

#: عنوان ثابت لكل فئة — بلا أسماء ولا مبالغ (ACC-113)
CATEGORY_PUSH: dict[str, dict[str, str]] = {
    "operational": {"title": "فيزانو بلص — تنبيه تشغيلي", "body": "أمر في متجرك يحتاج نظرك."},
    "account": {"title": "فيزانو بلص — حسابك", "body": "تحديث في اشتراكك أو حسابك."},
    "marketing": {"title": "فيزانو بلص", "body": "جديد من المنصة."},
}


def push_text(n: Notification) -> dict[str, str]:
    """عنوان الإشعار الفوري: ثابت لكل فئة (لا أسماء ولا مبالغ)، عدا إعلان المنصة — نصّ كتبه المشغّل
    للمتاجر كلها فلا سرّ فيه، فيظهر عنوانه ونصّه كما هما على الهاتف والتطبيق المثبَّت (0005 §٢٣٢)."""
    if n.kind == "platform_announcement":
        return {"title": f"فيزانو بلص — {n.title}"[:120], "body": n.body[:240]}
    return CATEGORY_PUSH.get(n.category, CATEGORY_PUSH["operational"])


def in_quiet_hours(now: datetime) -> bool:
    h = now.astimezone(KHARTOUM).hour
    return h >= QUIET_FROM or h < QUIET_TO


def _path(n: Notification) -> str:
    return n.href if n.href.startswith("/") and not n.href.startswith("//") else "/notify/inbox"


def _branches(user_ids: set[uuid.UUID]) -> dict[uuid.UUID, set[uuid.UUID]]:
    out: dict[uuid.UUID, set[uuid.UUID]] = {u: set() for u in user_ids}
    for uid, bid in UserBranchAccess.objects.filter(
        user_id__in=user_ids, revoked_at__isnull=True
    ).values_list("user_id", "branch_id"):
        out.setdefault(uid, set()).add(bid)
    return out


def _wants(
    n: Notification, user: User, branches: set[uuid.UUID], prefs: dict[str, Any], now: datetime
) -> bool:
    if n.owner_only and not user.is_owner:
        return False
    if n.branch_id is not None and not user.is_owner and n.branch_id not in branches:
        return False
    if not prefs["prefs"].get(n.category, {}).get("push", False):
        return False
    return not (prefs["quiet"] and in_quiet_hours(now) and not n.needs_action)


def dispatch_tenant(tenant_id: uuid.UUID, *, derive: bool, now: datetime | None = None) -> int:
    """يرسل ما لم يُرسل لمنشأة واحدة؛ يعيد عدد التنبيهات المرسلة."""
    now = now or timezone.now()
    sent = 0
    with tenant_context(tenant_id):
        # الجهاز المسحوب أو المجمَّد أو الممحو لا يستلم (جهاز مفقود لا تظهر عليه تنبيهات المتجر)
        endpoints = list(
            DeviceEndpoint.objects.filter(
                expired_at__isnull=True, device__status=Device.Status.ACTIVE
            )
        )
        if not endpoints:
            Notification.objects.filter(pushed_at__isnull=True).update(pushed_at=now)
            return 0
        if derive:
            try:
                notifications.refresh()
            except Exception:  # noqa: BLE001 — الاشتقاق لا يوقف إرسال ما وصل
                log.exception("push: refresh failed for %s", tenant_id)
        pending = list(Notification.objects.filter(pushed_at__isnull=True).order_by("occurred_at"))
        if not pending:
            return 0
        user_ids = {e.user for e in endpoints}
        users = {u.id: u for u in User.objects.filter(id__in=user_ids, is_active=True)}
        branches = _branches(set(users))
        prefs: dict[uuid.UUID, dict[str, Any]] = {}
        for uid in users:
            p = NotificationPreference.objects.filter(user_id=uid).first()
            prefs[uid] = {
                "prefs": notifications.effective_prefs(p)
                if p
                else {k: dict(v) for k, v in notifications.DEFAULT_PREFS.items()},
                "quiet": bool(p and p.quiet_hours),
            }
        for n in pending:
            fresh = n.resolved_at is None and now - n.occurred_at <= MAX_AGE
            reasons: list[str] = []
            if fresh:
                text = push_text(n)
                for ep in endpoints:
                    user = users.get(ep.user)
                    if user is None or not _wants(n, user, branches[user.id], prefs[user.id], now):
                        continue
                    # وسم فريد لكل إشعار: إشعاران من النوع نفسه لا يستبدل أحدهما الآخر على الجهاز
                    out = push.deliver(
                        ep, title=text["title"], body=text["body"], path=_path(n), tag=str(n.id)
                    )
                    sent += int(bool(out.get("sent")))
                    reasons.append("sent" if out.get("sent") else str(out.get("reason", "")))
            if not settled(reasons, n.occurred_at, now):
                continue  # فشل عابر: يُعاد في الدورة التالية
            n.pushed_at = now
            n.save(update_fields=["pushed_at"])
    return sent


def settled(reasons: list[str], occurred_at: datetime, now: datetime) -> bool:
    """يوسم الإشعار إن لم يكن له مستلم، أو نجح إرسال، أو كان كل فشل دائماً، أو انقضت
    نافذة الإعادة."""
    if not reasons or "sent" in reasons or all(r in PERMANENT for r in reasons):
        return True
    return now - occurred_at > RETRY_WINDOW


def tenants_with_endpoints(*, pending_only: bool = False) -> list[uuid.UUID]:
    """المنشآت ذات أجهزة فعّالة مشتركة. `pending_only` (دورات الإرسال بين الاشتقاقات): التي لها إشعار
    لم يُرسل فقط — استعلام واحد بدل معاملة لكل منشأة كل 15 ثانية (مراجعة 2026-11-08)."""
    with platform_context():
        tids = set(
            DeviceEndpoint.unscoped.filter(
                expired_at__isnull=True, device__status=Device.Status.ACTIVE
            )
            .values_list("tenant_id", flat=True)
            .distinct()
        )
        if pending_only and tids:
            tids &= set(
                Notification.unscoped.filter(tenant_id__in=tids, pushed_at__isnull=True)
                .values_list("tenant_id", flat=True)
                .distinct()
            )
        return list(tids)


def dispatch_all(*, derive: bool) -> dict[str, int]:
    """دورة واحدة: فريق المنصة ثم كل منشأة لها أجهزة مشتركة. خطأ منشأة لا يوقف غيرها."""
    from stingops import operator_push

    out = {"operator": 0, "tenants": 0, "announcements": 0}
    try:
        out["operator"] = operator_push.dispatch()
    except Exception:  # noqa: BLE001
        log.exception("push: operator dispatch failed")
    # إعلانات المنصة التي حان موعدها تُكتب في الصناديق أولاً، فيدفعها الموزّع في الدورة نفسها (§٢٣١)
    try:
        from stingops import announce

        out["announcements"] = announce.deliver_due()
    except Exception:  # noqa: BLE001
        log.exception("push: announcement delivery failed")
    for tid in tenants_with_endpoints(pending_only=not derive):
        try:
            out["tenants"] += dispatch_tenant(tid, derive=derive)
        except Exception:  # noqa: BLE001
            log.exception("push: tenant dispatch failed for %s", tid)
    return out

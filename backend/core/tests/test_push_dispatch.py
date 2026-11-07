"""0005 §٢١٦ — الإشعارات الفورية: الموزّع يرسل مرة واحدة لمن يرى الإشعار وفعّل «فوري» لفئته، ويحترم
ساعات الهدوء، ولا يرسل القديم، ولا يحمل محتوى حساساً؛ وفريق المنصة يشترك بمتصفحه ويستلم إشعاراته."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from core import notifications, push, push_dispatch
from core.models import DeviceEndpoint, Notification, NotificationPreference
from core.tenancy import platform_context, tenant_context
from core.tests.test_org import ctx  # noqa: F401
from stingops import inbox, operator_push
from stingops.models import OperatorNotice, OperatorPushEndpoint
from stingops.tests.test_operator import _operator_headers

pytestmark = pytest.mark.django_db(transaction=True)

Sent = list[dict[str, Any]]


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> Sent:
    calls: Sent = []

    def fake(ep: Any, *, title: str, body: str, path: str, tag: str) -> dict[str, Any]:
        calls.append({"endpoint": ep.endpoint, "title": title, "body": body, "path": path})
        return {"sent": True, "reason": ""}

    monkeypatch.setattr(push, "deliver", fake)
    return calls


def _subscribe(c: dict[str, Any], who: str) -> None:
    with tenant_context(c["tenant"].id):
        DeviceEndpoint.objects.create(
            tenant_id=c["tenant"].id,
            device_id=c["device_ids"][who],
            user=c["users"][who].id,
            endpoint=f"https://push.example/{who}",
            endpoint_sha256=who.ljust(64, "0"),
            p256dh="k",
            auth="a",
        )


def _emit(c: dict[str, Any], **kw: Any) -> Notification:
    defaults: dict[str, Any] = {
        "kind": "proof_reviewed",
        "category": "account",
        "title": "اعتُمد إيصال أحمد بمبلغ 45,000",
        "href": "/org/subscription",
    }
    with tenant_context(c["tenant"].id):
        return notifications.emit(**(defaults | kw))


def _dispatch(c: dict[str, Any], now: datetime | None = None) -> int:
    return push_dispatch.dispatch_tenant(c["tenant"].id, derive=False, now=now)


def test_sends_once_to_who_can_see_it_without_sensitive_text(
    ctx: dict[str, Any],  # noqa: F811
    sent: Sent,
) -> None:
    for who in ("owner", "manager", "cashier"):
        _subscribe(ctx, who)
    _emit(ctx, owner_only=True, dedupe_key="proof:1")
    assert _dispatch(ctx) == 1
    assert [s["endpoint"] for s in sent] == ["https://push.example/owner"]
    # عنوان ثابت للفئة: لا اسم ولا مبلغ، والنقر يفتح الشاشة
    assert sent[0]["title"] == "فيزانو بلص — حسابك" and "45" not in sent[0]["body"]
    assert sent[0]["path"] == "/org/subscription"
    # مرة واحدة: الإحياء بالمفتاح نفسه لا يعيد الإرسال
    _emit(ctx, owner_only=True, dedupe_key="proof:1", title="عنوان آخر")
    assert _dispatch(ctx) == 0
    # إشعار للجميع يصل الثلاثة
    _emit(ctx, kind="sync_hold", category="operational", href="/sync/review")
    assert _dispatch(ctx) == 3


def test_branch_scope_preferences_and_quiet_hours(
    ctx: dict[str, Any],  # noqa: F811
    sent: Sent,
) -> None:
    _subscribe(ctx, "owner")
    _subscribe(ctx, "cashier")
    # فرع آخر: المالك يراه، والكاشير بلا وصول إليه لا
    with platform_context():
        from core.models import Branch

        other = Branch.unscoped.filter(tenant=ctx["tenant"]).exclude(id=ctx["branch"].id).first()
    assert other is not None
    _emit(ctx, category="operational", branch_id=other.id, dedupe_key="b:1")
    assert _dispatch(ctx) == 1 and sent[-1]["endpoint"].endswith("/owner")
    # المالك أطفأ «فوري» للحسابي: لا يصله
    with tenant_context(ctx["tenant"].id):
        notifications.save_prefs(
            ctx["users"]["owner"], prefs={"account": {"push": False}}, email=None
        )
    _emit(ctx, owner_only=True, dedupe_key="acc:2")
    assert _dispatch(ctx) == 0
    # ساعات الهدوء: منتصف الليل بتوقيت الخرطوم (22:00 UTC) لا يصل إلا ما يحتاج تصرّفاً
    with tenant_context(ctx["tenant"].id):
        NotificationPreference.objects.filter(user=ctx["users"]["cashier"]).delete()
        notifications.save_prefs(ctx["users"]["cashier"], prefs={}, email=None, quiet_hours=True)
    night = timezone.now().replace(hour=22, minute=30)
    _emit(ctx, category="operational", dedupe_key="q:1", occurred_at=night)
    _emit(ctx, category="operational", dedupe_key="q:2", needs_action=True, occurred_at=night)
    before = len(sent)
    _dispatch(ctx, now=night)
    to_cashier = [s for s in sent[before:] if s["endpoint"].endswith("/cashier")]
    assert len(to_cashier) == 1
    assert push_dispatch.in_quiet_hours(night) is True


def test_old_and_unsubscribed_are_marked_not_sent(
    ctx: dict[str, Any],  # noqa: F811
    sent: Sent,
) -> None:
    # بلا اشتراكات: يوسم ولا يُرسل (لا طوفان حين يشترك أحد لاحقاً)
    _emit(ctx, dedupe_key="x:1")
    assert _dispatch(ctx) == 0
    _subscribe(ctx, "owner")
    assert _dispatch(ctx) == 0 and sent == []
    # القديم (أكثر من 6 ساعات) لا يُرسل
    _emit(ctx, dedupe_key="x:2", occurred_at=timezone.now() - timedelta(hours=7))
    assert _dispatch(ctx) == 0
    with tenant_context(ctx["tenant"].id):
        assert not Notification.objects.filter(pushed_at__isnull=True).exists()
    # الموزّع الكامل يمرّ بالمنشآت ذات الاشتراكات، ويشتقّ التشغيلي (تنبيهات الاشتراك ونحوها) فيرسله
    _emit(ctx, dedupe_key="x:3")
    assert push_dispatch.dispatch_all(derive=True)["tenants"] >= 1
    assert any(s["path"] == "/org/subscription" for s in sent)


def test_preferences_payload_has_push_and_quiet_hours(ctx: dict[str, Any]) -> None:  # noqa: F811
    from core.tests.test_org import _h

    c = Client()
    h = _h(ctx["tokens"]["owner"])
    got = c.get("/api/notifications/preferences", headers=h).json()
    assert got["prefs"]["operational"]["push"] is True and got["quiet_hours"] is False
    assert got["prefs"]["marketing"]["push"] is False
    r = c.put(
        "/api/notifications/preferences",
        {"prefs": {"account": {"push": False}}, "quiet_hours": True},
        content_type="application/json",
        headers=h,
    )
    assert r.status_code == 200, r.content
    assert r.json()["prefs"]["account"]["push"] is False and r.json()["quiet_hours"] is True


def test_operator_browser_subscribes_and_receives_team_notices(sent: Sent) -> None:
    c = Client()
    admin = _operator_headers("push-admin", "هدى — تشغيل")
    sub = {"endpoint": "https://push.example/op", "p256dh": "k", "auth": "a"}
    assert c.get("/api/platform/push", headers=admin).json()["subscribed"] is False
    r = c.post("/api/platform/push/subscribe", sub, content_type="application/json", headers=admin)
    assert r.status_code == 200 and r.json()["subscribed"] is True
    with platform_context():
        assert OperatorPushEndpoint.objects.count() == 1
    inbox.emit("proof", "إيصال من بقالة النيل بمبلغ 45,000", href="/platform/proofs")
    assert operator_push.dispatch() == 1
    assert sent[-1]["title"] == "إدارة فيزانو — إيصال دفع"
    assert "النيل" not in sent[-1]["body"] and sent[-1]["path"] == "/platform/proofs"
    assert operator_push.dispatch() == 0
    with platform_context():
        assert not OperatorNotice.objects.filter(pushed_at__isnull=True).exists()
    # الإلغاء: لا يصل بعده
    c.post("/api/platform/push/unsubscribe", {}, content_type="application/json", headers=admin)
    inbox.emit("demo", "طلب جولة")
    assert operator_push.dispatch() == 0
    # الدعم يشترك بمتصفحه أيضاً (ليس تغييراً في المنصة)
    from stingops.tests.test_roles import _support_headers

    support = _support_headers()
    sub2 = {**sub, "endpoint": "https://push.example/sup"}
    r = c.post(
        "/api/platform/push/subscribe", sub2, content_type="application/json", headers=support
    )
    assert r.status_code == 200

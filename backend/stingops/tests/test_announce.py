"""إعلانات المنصة إلى المتاجر (0005 §٢٣١): الأنواع والجماهير، والإيصال إلى الصندوق والشريط، والفوري
اختياري، والبريد للمالك، والإلغاء يسحبها."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from django.core import mail
from django.test import Client
from django.utils import timezone

from core.models import Notification, Tenant
from core.tenancy import platform_context, tenant_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from stingops import announce
from stingops.models import PlatformAnnouncement
from stingops.tests.test_operator import _operator_headers

pytestmark = pytest.mark.django_db(transaction=True)
API = "/api/platform/announcements"


def _window(start_h: float, end_h: float) -> dict[str, str]:
    now = timezone.now()
    return {
        "starts_at": (now + timedelta(hours=start_h)).isoformat(),
        "ends_at": (now + timedelta(hours=end_h)).isoformat(),
    }


def _other_tenant(mine: Tenant) -> Tenant:
    with platform_context():
        other = Tenant.unscoped.exclude(id=mine.id).order_by("created_at").first()
    assert other is not None
    return other


def test_maintenance_to_one_store_reaches_inbox_and_banner_then_cancel_withdraws(
    ctx: dict[str, Any],  # noqa: F811
) -> None:
    c, op = Client(), _operator_headers("ann-op", "هدى — تشغيل")
    tid = str(ctx["tenant"].id)
    body = {
        "title": "صيانة الخادم ليلة الجمعة",
        "body": "قد تتأخّر المزامنة نحو نصف ساعة.",
        "kind": "maintenance",
        "audience": "tenant",
        "audience_value": tid,
        "cta_label": "حالة الخدمة",
        "cta_url": "/status",
        **_window(5, 6),
    }
    pv = _post(c, op, f"{API}/preview", body).json()
    assert pv["targeted"] == 1 and pv["segments"][0]["label"].endswith(ctx["tenant"].name)
    a = _post(c, op, API, body).json()["announcement"]
    assert a["audience_value_label"] == ctx["tenant"].name and a["send_push"] is True
    s = _post(c, op, f"{API}/{a['id']}/schedule").json()["announcement"]
    # الصيانة إنذار مسبق: تصل فور الجدولة إلى المتجر المستهدف وحده
    assert s["delivered_count"] == 1 and s["delivered_at"]
    with tenant_context(ctx["tenant"].id):
        n = Notification.objects.get(dedupe_key=f"ann:{a['id']}")
        assert n.category == "operational" and n.href == "/status" and n.pushed_at is None
    other = _other_tenant(ctx["tenant"])
    with tenant_context(other.id):
        assert not Notification.objects.filter(dedupe_key=f"ann:{a['id']}").exists()
    owner = _h(ctx["tokens"]["owner"])
    bar = c.get("/api/org/announcements", headers=owner).json()["announcements"]
    assert [b["title"] for b in bar] == ["صيانة الخادم ليلة الجمعة"]
    assert bar[0]["active"] is False and bar[0]["cta_url"] == "/status"
    # لا يصل تكراراً من دورة الموزّع
    assert announce.deliver_due() == 0
    # الإلغاء يسحب الشريط
    _post(c, op, f"{API}/{a['id']}/cancel")
    assert c.get("/api/org/announcements", headers=owner).json()["announcements"] == []


def test_feature_waits_for_window_and_push_is_optional(ctx: dict[str, Any]) -> None:  # noqa: F811
    c, op = Client(), _operator_headers("ann-op2", "سارة — تشغيل")
    body = {
        "title": "جديد: تقارير الهامش",
        "body": "تقرير الهامش لكل صنف صار في التقارير.",
        "kind": "feature",
        "audience": "all",
        "send_push": False,
        **_window(1, 48),
    }
    a = _post(c, op, API, body).json()["announcement"]
    s = _post(c, op, f"{API}/{a['id']}/schedule").json()["announcement"]
    assert s["delivered_at"] == "" and s["delivered_count"] == 0
    later = timezone.now() + timedelta(hours=2)
    assert announce.deliver_due(later) >= 2
    with tenant_context(ctx["tenant"].id):
        n = Notification.objects.get(dedupe_key=f"ann:{a['id']}")
        # بلا «فوري»: موسوم مرسَلاً فلا يدفعه الموزّع
        assert n.pushed_at is not None and n.category == "account"


def test_validation_and_email_to_owner(
    ctx: dict[str, Any],  # noqa: F811
    monkeypatch: Any,
    settings: Any,
) -> None:
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    monkeypatch.setenv("STING_EMAIL_FROM", "plus@vezano.app")
    monkeypatch.setattr(announce, "_owner_emails", lambda tid, critical: ["owner@shop.example"])
    c, op = Client(), _operator_headers("ann-op3", "هدى — تشغيل")
    base = {
        "title": "تذكير",
        "body": "اشتراكك ينتهي قريباً.",
        "kind": "payment",
        **_window(0.01, 24),
    }
    bad = [
        ({"audience": "plan", "audience_value": "nope"}, "audience_value_invalid"),
        ({"audience": "status", "audience_value": "x"}, "audience_value_invalid"),
        ({"audience": "all", "cta_label": "ادفع"}, "cta_incomplete"),
        ({"audience": "all", "cta_label": "ادفع", "cta_url": "javascript:x"}, "cta_url_invalid"),
        ({"audience": "all", "kind": "spam"}, "kind_invalid"),
    ]
    for extra, code in bad:
        r = _post(c, op, API, {**base, **extra})
        assert (r.status_code, r.json()["detail"]) == (400, code), extra
    a = _post(
        c,
        op,
        API,
        {
            **base,
            "audience": "tenant",
            "audience_value": str(ctx["tenant"].id),
            "send_email": True,
            "cta_label": "ادفع الآن",
            "cta_url": "/org/subscription",
        },
    ).json()["announcement"]
    assert a["send_email"] is True
    PlatformAnnouncement.objects.filter(id=a["id"]).update(starts_at=timezone.now())
    PlatformAnnouncement.objects.filter(id=a["id"]).update(status="scheduled")
    assert announce.deliver_due() == 1
    assert len(mail.outbox) == 1 and mail.outbox[0].to == ["owner@shop.example"]
    assert "اشتراكك ينتهي قريباً." in str(mail.outbox[0].body)
    assert PlatformAnnouncement.objects.get(id=a["id"]).emailed_count == 1


def test_status_targets_use_subscription_state(ctx: dict[str, Any]) -> None:  # noqa: F811
    groups = {k: announce.targets("status", k) for k in announce.STATUS_GROUPS}
    assert announce.targets("status", "bogus") == set()
    # كل متجر في مجموعة واحدة على الأكثر
    seen: set[Any] = set()
    for ids in groups.values():
        assert not (ids & seen)
        seen |= ids

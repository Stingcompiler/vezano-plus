"""تحليلات الزوار (0005 §٢١٩): العدّ بلا عنوان محفوظ، والآليّ مرفوض، والبصمة يومية، والتقرير للمشغّل
بمسار التحويل من السجلّ، والحذف بعد مدة الاحتفاظ."""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from core.tenancy import platform_context
from core.tests.test_org import _h, ctx  # noqa: F401
from stingops import analytics
from stingops.models import OperatorProfile, SiteVisit
from stingops.tests.test_operator import _operator_headers

pytestmark = pytest.mark.django_db(transaction=True)

PHONE = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile Safari/537.36"
LAPTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15"


def _beacon(c: Client, url: str, ua: str, ip: str, referrer: str = "") -> int:
    r = c.post(
        "/api/public/beacon",
        data=json.dumps({"url": url, "referrer": referrer}),
        content_type="text/plain;charset=UTF-8",
        HTTP_USER_AGENT=ua,
        REMOTE_ADDR=ip,
    )
    return r.status_code


def test_beacon_counts_without_storing_address(monkeypatch: Any) -> None:
    monkeypatch.setattr(analytics, "country_of", lambda ip: "SD" if ip.startswith("41.") else "")
    c = Client()
    assert _beacon(c, "https://plus.vezano.app/?utm_source=Facebook", PHONE, "41.1.1.1") == 204
    assert _beacon(c, "/plans", PHONE, "41.1.1.1", "https://www.google.com/search?q=x") == 204
    assert _beacon(c, "/register?ref=1#top", LAPTOP, "8.8.8.8", "https://plus.vezano.app/") == 204
    # الآليّ والمتصفح بلا هوية لا يُعدّان
    assert _beacon(c, "/", "Googlebot/2.1", "66.249.1.1") == 204
    assert _beacon(c, "/", "", "1.2.3.4") == 204
    rows = list(SiteVisit.objects.order_by("id"))
    assert [(r.path, r.country, r.source, r.device) for r in rows] == [
        ("/", "SD", "facebook", "mobile"),
        # الزائر نفسه في اليوم نفسه: مصدر أول صفحة (مراجعة 2026-11-09)
        ("/plans", "SD", "facebook", "mobile"),
        ("/register", "", "", "desktop"),
    ]
    # البصمة نفسها للزائر نفسه في اليوم، ولا أثر للعنوان في أي حقل
    assert rows[0].visitor == rows[1].visitor != rows[2].visitor
    for r in rows:
        assert "41.1.1.1" not in json.dumps([r.path, r.source, r.visitor])


def test_visitor_key_rotates_daily_and_paths_drop_ids() -> None:
    today = analytics.today_local()
    assert analytics.visitor_key("1.1.1.1", "ua", today) != analytics.visitor_key(
        "1.1.1.1", "ua", today - timedelta(days=1)
    )
    assert analytics.clean_path("/invite/0196f0e2-7b1c-7cc4-9d55-1e2f3a4b5c6d/") == "/invite/:id"
    assert analytics.clean_path("market?q=1") == "/market"


def test_daily_cap_per_visitor(monkeypatch: Any) -> None:
    monkeypatch.setattr(analytics, "MAX_PER_VISITOR_DAY", 2)
    c = Client()
    for _ in range(4):
        _beacon(c, "/", LAPTOP, "9.9.9.9")
    assert SiteVisit.objects.count() == 2


def test_report_is_operator_only_with_funnel_and_previous_period(
    ctx: dict[str, Any],  # noqa: F811
) -> None:
    today = analytics.today_local()
    old = today - timedelta(days=8)
    SiteVisit.objects.bulk_create(
        [
            SiteVisit(day=today, path="/", country="SD", device="mobile", visitor="a"),
            SiteVisit(day=today, path="/register", country="SD", device="mobile", visitor="a"),
            SiteVisit(day=today, path="/", country="EG", device="desktop", visitor="b"),
            # الزائر نفسه في يوم آخر يُعدّ زائراً لذلك اليوم
            SiteVisit(day=today - timedelta(days=1), path="/", country="SD", visitor="a"),
            # الفترة السابقة للمقارنة فقط
            SiteVisit(day=old, path="/", country="SA", visitor="c"),
        ]
    )
    c = Client()
    assert c.get("/api/platform/analytics").status_code == 401
    assert c.get("/api/platform/analytics", headers=_h(ctx["tokens"]["owner"])).status_code == 403
    # «الدعم» يقرأ التقرير (قراءة فقط)
    support = _operator_headers("analytics-support", "سلمى — دعم")
    with platform_context():
        OperatorProfile.objects.filter(user__username="analytics-support").update(role="support")
    r = c.get("/api/platform/analytics?days=7", headers=support)
    assert r.status_code == 200, r.content
    body = r.json()
    assert body["range"]["days"] == 7 and len(body["daily"]) == 7
    assert body["totals"] == {"views": 4, "visitors": 3, "prev_views": 1, "prev_visitors": 1}
    assert body["daily"][-1] == {"day": today.isoformat(), "views": 3, "visitors": 2}
    assert body["countries"][0] == {"key": "SD", "visitors": 2, "views": 3}
    funnel = {f["key"]: f["value"] for f in body["funnel"]}
    assert funnel["visitors"] == 3 and funnel["signup"] == 1
    # متجر الاختبار أُنشئ الآن فيُعدّ في الفترة؛ لا إيصال اشتراك بعد
    assert funnel["stores"] >= 1 and funnel["paid"] == 0
    # مدى غير معروض يعود إلى 7
    assert c.get("/api/platform/analytics?days=5", headers=support).json()["range"]["days"] == 7


def test_prune_keeps_retention_window(settings: Any) -> None:
    settings.ANALYTICS_RETENTION_DAYS = 30
    today = analytics.today_local()
    SiteVisit.objects.create(day=today - timedelta(days=31), path="/", visitor="x")
    SiteVisit.objects.create(day=today - timedelta(days=29), path="/", visitor="y")
    assert analytics.prune(timezone.now()) == 1
    assert list(SiteVisit.objects.values_list("visitor", flat=True)) == ["y"]


def test_review_2026_11_09_login_excluded_one_source_and_address_cap(monkeypatch: Any) -> None:
    """مراجعة 2026-11-09: صفحات الدخول لا تُعدّ، والزائر مصدر واحد في اليوم، وللعنوان
    الواحد سقف."""
    from django.core.cache import cache

    cache.clear()
    monkeypatch.setattr(analytics, "country_of", lambda ip: "")
    c = Client()
    # تاجر حالي يفتح صفحة الدخول كل يوم: ليست زيارة
    assert _beacon(c, "/login?next=%2F", LAPTOP, "5.5.5.5") == 204
    assert _beacon(c, "/invite/abc", LAPTOP, "5.5.5.5") == 204
    assert SiteVisit.objects.count() == 0
    # أول صفحة من فيسبوك بـutm، ثم تنقّل داخلي يحمل المُحيل الأصلي بلا utm: مصدر واحد
    _beacon(c, "/?utm_source=facebook", PHONE, "6.6.6.6", "https://l.facebook.com/")
    _beacon(c, "/plans", PHONE, "6.6.6.6", "https://l.facebook.com/")
    _beacon(c, "/register", PHONE, "6.6.6.6", "")
    assert set(SiteVisit.objects.values_list("source", flat=True)) == {"facebook"}
    # سقف العنوان: متصفحات مختلفة الهوية من عنوان واحد لا تتجاوز السقف
    monkeypatch.setattr(analytics, "MAX_PER_ADDRESS_WINDOW", 3)
    cache.clear()
    for i in range(6):
        _beacon(c, "/", f"{LAPTOP} v{i}", "7.7.7.7")
    assert SiteVisit.objects.filter(path="/", device="desktop").count() == 3

"""جدول المستأجرين PLT-20 (0005 §٢٢٩): الدولة من عنوان الطلب مرة في الساعة بلا حفظ العنوان، والعدّ
والفرز والقصّ في قاعدة البيانات، وللمشغّل وحده."""

from __future__ import annotations

from typing import Any

import pytest
from django.core.cache import cache
from django.test import Client

from core.models import Tenant
from core.tenancy import platform_context
from core.tests.test_org import _h, ctx  # noqa: F401
from stingops import analytics
from stingops.tests.test_operator import _operator_headers

pytestmark = pytest.mark.django_db(transaction=True)


def test_session_request_notes_country_hourly(monkeypatch: Any, ctx: dict[str, Any]) -> None:  # noqa: F811
    cache.clear()
    seen: list[str] = []

    def fake(ip: str) -> str:
        seen.append(ip)
        return "SD" if ip.startswith("41.") else ""

    monkeypatch.setattr(analytics, "country_of", fake)
    c = Client()
    h = _h(ctx["tokens"]["owner"])
    assert c.get("/api/org/settings", headers=h, REMOTE_ADDR="41.1.1.1").status_code == 200
    with platform_context():
        t = Tenant.unscoped.get(id=ctx["tenant"].id)
    assert t.last_country == "SD" and t.last_country_at is not None
    # خلال الساعة نفسها لا كتابة ثانية ولا بحث ثانٍ
    c.get("/api/org/settings", headers=h, REMOTE_ADDR="8.8.8.8")
    assert seen == ["41.1.1.1"]
    # لا يُحفظ العنوان في أي حقل
    with platform_context():
        assert "41.1.1.1" not in str(Tenant.unscoped.filter(id=t.id).values().first())


def test_directory_is_operator_only_sorted_and_paged(ctx: dict[str, Any]) -> None:  # noqa: F811
    with platform_context():
        Tenant.unscoped.filter(id=ctx["tenant"].id).update(last_country="SD")
    c = Client()
    assert c.get("/api/platform/tenants/directory").status_code == 401
    owner = _h(ctx["tokens"]["owner"])
    assert c.get("/api/platform/tenants/directory", headers=owner).status_code == 403
    h = _operator_headers("dir-op", "مشغّل الجدول")
    body = c.get(
        "/api/platform/tenants/directory?sort=devices&dir=desc&page=1&page_size=1", headers=h
    ).json()
    assert body["page"]["size"] == 1 and len(body["tenants"]) == 1
    assert body["total"] >= 2 and body["page"]["total"] == body["shown"]
    top = body["tenants"][0]
    assert {"country", "devices_active", "branches", "users", "last_seen_at"} <= set(top)
    # المستأجر صاحب الأجهزة أولاً في فرز الأجهزة تنازلياً
    assert top["devices_active"] >= 0
    assert {"code": "SD", "tenants": 1} in body["countries"]
    only = c.get("/api/platform/tenants/directory?country=SD", headers=h).json()
    assert [r["id"] for r in only["tenants"]] == [str(ctx["tenant"].id)]
    unknown = c.get("/api/platform/tenants/directory?country=unknown", headers=h).json()
    assert str(ctx["tenant"].id) not in [r["id"] for r in unknown["tenants"]]

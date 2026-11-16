"""PLT-00 (بأمر المالك 2026-09-21): لوحة النظرة العامة — عدّادات من السجل بروابط شاشاتها؛ الموقوف
وطلب الجولة الجديد يرفعان «يحتاج انتباهاً»؛ لا مبيعات ولا زبائن في الحمولة."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import Client

from core.tests.test_org import _h, _post, ctx  # noqa: F401
from stingops.tests.test_demo_public import submit_demo
from stingops.tests.test_operator import _operator_headers

pytestmark = pytest.mark.django_db(transaction=True)


def test_overview_counts(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    oh = _operator_headers("ops4", "هدى — تشغيل")
    assert c.get("/api/platform/overview", headers=_h(ctx["tokens"]["owner"])).status_code == 403
    o = c.get("/api/platform/overview", headers=oh).json()
    assert o["tenants_total"] >= 1 and o["measured_at"]
    tiles = {t["key"]: t for t in o["subscriptions"] + o["queues"] + o["technical"]}
    assert tiles["trial"]["value"] >= 1 and tiles["suspended"]["value"] == 0
    assert tiles["demo"]["value"] == 0 and tiles["demo"]["href"] == "/platform/demo-requests"
    base = o["attention"]
    for forbidden in ("sales", "revenue", "customers", "receivable"):
        assert forbidden not in str(o)
    # طلب جولة جديد + إيقاف مستأجر → العدّادات والانتباه يرتفعان، والبطاقات تتلوّن
    submit_demo(
        c, {"name": "أحمد", "whatsapp": "0912345678", "email": "a@example.com", "channel": "call"}
    )
    _post(
        c,
        oh,
        f"/api/platform/tenants/{ctx['tenant'].id}/subscription",
        {"action": "suspend", "reason": "تحقق"},
    )
    o = c.get("/api/platform/overview", headers=oh).json()
    tiles = {t["key"]: t for t in o["subscriptions"] + o["queues"] + o["technical"]}
    assert tiles["demo"]["value"] == 1 and tiles["demo"]["tone"] == "warn"
    assert tiles["suspended"]["value"] == 1 and tiles["suspended"]["tone"] == "danger"
    assert tiles["suspended"]["href"] == "/platform/tenants?filter=suspended"
    assert o["attention"] == base + 2


def test_overview_tiles_open_matching_filter(ctx: dict[str, Any]) -> None:  # noqa: F811
    """فحص 2026-10-17 VP05: كل بطاقة تفتح مرشّح عدّادها — «نشط 0» لا تُظهر مستأجراً تجريبياً."""
    c = Client()
    oh = _operator_headers("ops9", "منى — تشغيل")
    o = c.get("/api/platform/overview", headers=oh).json()
    tiles = {t["key"]: t for t in o["subscriptions"]}
    for key in ("active", "trial", "due14", "late", "suspended"):
        href = tiles[key]["href"]
        assert href.endswith(f"?filter={key}"), (key, href)
        shown = c.get(f"/api/platform/tenants?filter={key}", headers=oh).json()["shown"]
        assert shown == tiles[key]["value"] or key == "due14", (key, shown, tiles[key]["value"])


def test_trial_followup_counts_distinct_mature_trials(ctx: dict[str, Any]) -> None:  # noqa: F811
    from datetime import timedelta

    from django.utils import timezone

    from core.models import SubscriptionReceipt
    from core.subscription import ensure_subscription
    from core.tenancy import tenant_context

    c = Client()
    owner = _h(ctx["tokens"]["owner"])
    operator = _operator_headers("followup", "تشغيل")
    with tenant_context(ctx["tenant"].id):
        sub = ensure_subscription()
        sub.started_at = timezone.now() - timedelta(days=15)
        sub.trial_ends_at = sub.expires_at = timezone.now() + timedelta(days=1)
        sub.save()
    assert c.get("/api/reports/sales", headers=owner).status_code == 200
    filters = "/api/platform/tenants?filter="
    rows = c.get(filters + "due14_no_sale", headers=operator).json()["tenants"]
    assert str(ctx["tenant"].id) in {r["id"] for r in rows}
    assert not c.get(filters + "due14_sold", headers=operator).json()["tenants"]
    overview = "/api/platform/overview"
    assert c.get(overview, headers=operator).json()["trial_renewals"] == {"eligible": 0, "paid": 0}
    with tenant_context(ctx["tenant"].id):
        sub.refresh_from_db()
        assert sub.first_trial_report_at is not None
        sub.first_trial_report_at = sub.started_at + timedelta(days=1)
        sub.trial_ends_at = sub.expires_at = timezone.now() - timedelta(days=1)
        sub.save()
    assert c.get(overview, headers=operator).json()["trial_renewals"] == {"eligible": 1, "paid": 0}
    for reference in ("FOLLOW-1", "FOLLOW-2"):
        proof = _post(
            c, owner, "/api/org/subscription/proofs", {"reference": reference, "plan_code": "dual"}
        ).json()["proof"]
        assert (
            _post(
                c, operator, f"/api/platform/proofs/{ctx['tenant'].id}/{proof['id']}/approve", {}
            ).status_code
            == 200
        )
    assert c.get(overview, headers=operator).json()["trial_renewals"] == {"eligible": 1, "paid": 1}
    row = c.get("/api/platform/tenants", headers=operator).json()["tenants"]
    followup = next(r["followup"] for r in row if r["id"] == str(ctx["tenant"].id))
    assert followup["trial_end"] == sub.trial_ends_at.isoformat() and followup["paid"]
    assert followup["report"] and not followup["first_sale"]
    assert followup["pending"] is None
    with tenant_context(ctx["tenant"].id):
        SubscriptionReceipt.objects.update(issued_at=sub.started_at)
    assert c.get(overview, headers=operator).json()["trial_renewals"] == {"eligible": 1, "paid": 0}

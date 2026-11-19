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
    # مراجعة 2026-11-18: تجربة انتهت بلا دفع تبقى «تجريبي» ولا تدخل «متأخرو السداد»
    late = c.get(filters + "late", headers=operator).json()["tenants"]
    assert str(ctx["tenant"].id) not in {r["id"] for r in late}
    # مراجعة 2026-11-19: ولا تُعدّ في «تجريبي» (التجارب الجارية) — صفّها «تجريبي» بسطر «انتهت قبل»
    trial = c.get(filters + "trial", headers=operator).json()["tenants"]
    assert str(ctx["tenant"].id) not in {r["id"] for r in trial}
    every = c.get("/api/platform/tenants", headers=operator).json()["tenants"]
    assert next(r for r in every if r["id"] == str(ctx["tenant"].id))["status"] == "trial"
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
    # مراجعة 2026-11-18: من دفع أثناء التجربة اشترك أيضاً؛ إيصال قبل بداية التجربة لا يُحسب
    with tenant_context(ctx["tenant"].id):
        SubscriptionReceipt.objects.update(issued_at=sub.started_at + timedelta(days=1))
    assert c.get(overview, headers=operator).json()["trial_renewals"] == {"eligible": 1, "paid": 1}
    with tenant_context(ctx["tenant"].id):
        SubscriptionReceipt.objects.update(issued_at=sub.started_at - timedelta(days=1))
    assert c.get(overview, headers=operator).json()["trial_renewals"] == {"eligible": 1, "paid": 0}


def test_backfill_trial_end_for_stores_that_already_subscribed(ctx: dict[str, Any]) -> None:  # noqa: F811
    """0046: متجر جرّب ثم اشترك قبل 0045 يأخذ نهاية تجربته من بداية أول فترة تجديد مدفوعة."""
    import importlib

    from django.db import connection

    from core.models import SubscriptionReceipt, TenantSubscription
    from core.subscription import ensure_subscription
    from core.tenancy import platform_context, tenant_context

    c = Client()
    owner = _h(ctx["tokens"]["owner"])
    operator = _operator_headers("followup", "تشغيل")
    with tenant_context(ctx["tenant"].id):
        ensure_subscription()
    proof = _post(
        c, owner, "/api/org/subscription/proofs", {"reference": "BACKFILL-1", "plan_code": "dual"}
    ).json()["proof"]
    approve = f"/api/platform/proofs/{ctx['tenant'].id}/{proof['id']}/approve"
    assert _post(c, operator, approve, {}).status_code == 200
    with platform_context():
        TenantSubscription.unscoped.filter(tenant_id=ctx["tenant"].id).update(trial_ends_at=None)
        sub = TenantSubscription.unscoped.get(tenant_id=ctx["tenant"].id)
        receipt = SubscriptionReceipt.unscoped.get(tenant_id=ctx["tenant"].id)
    assert sub.plan_code != "trial"
    sql = importlib.import_module("core.migrations.0046_trial_end_for_converted").SQL
    with connection.cursor() as cur:
        cur.execute(sql)
    with platform_context():
        sub.refresh_from_db()
    assert sub.trial_ends_at == receipt.period_from


def test_undo_trial_end_for_stores_that_never_trialled(ctx: dict[str, Any]) -> None:  # noqa: F811
    """مراجعة 2026-11-19: منشأة اعتُمد لها دفع قبل اعتماد تجربتها لم تجرّب — 0026 يفرغ نهاية التجربة
    التي كتبها 0046؛ ومن له حدث «اعتماد التجربة» تبقى نهايته."""
    import importlib

    from django.db import connection

    from core.models import TenantSubscription
    from core.subscription import ensure_subscription
    from core.tenancy import platform_context, tenant_context
    from stingops.models import SubscriptionEvent

    c = Client()
    owner = _h(ctx["tokens"]["owner"])
    operator = _operator_headers("undo-trial", "تشغيل")
    with tenant_context(ctx["tenant"].id):
        ensure_subscription()
    proof = _post(
        c, owner, "/api/org/subscription/proofs", {"reference": "UNDO-1", "plan_code": "dual"}
    ).json()["proof"]
    approve = f"/api/platform/proofs/{ctx['tenant'].id}/{proof['id']}/approve"
    assert _post(c, operator, approve, {}).status_code == 200
    subs = TenantSubscription.unscoped.filter(tenant_id=ctx["tenant"].id)
    sql = importlib.import_module("stingops.migrations.0026_undo_trial_end_without_trial").SQL
    with platform_context():
        assert subs.get().trial_ends_at is not None
        SubscriptionEvent.objects.create(
            tenant_id=ctx["tenant"].id, kind="trial_approved", by_name="تشغيل"
        )
    with connection.cursor() as cur:
        cur.execute(sql)
    with platform_context():
        assert subs.get().trial_ends_at is not None
        SubscriptionEvent.objects.filter(kind="trial_approved").delete()
    with connection.cursor() as cur:
        cur.execute(sql)
    with platform_context():
        assert subs.get().trial_ends_at is None


def test_trial_tile_counts_running_trials_only(ctx: dict[str, Any]) -> None:  # noqa: F811
    """مراجعة 2026-11-19: تجربة انتهت بلا دفع تبقى «تجريبي» في صفّها لكنها خارج بطاقة التجارب
    الجارية ومرشّحها."""
    from datetime import timedelta

    from django.utils import timezone

    from core.models import TenantSubscription
    from core.subscription import ensure_subscription
    from core.tenancy import platform_context, tenant_context

    c = Client()
    oh = _operator_headers("trial-tile", "تشغيل")
    with tenant_context(ctx["tenant"].id):
        ensure_subscription()

    def trial_tile() -> int:
        o = c.get("/api/platform/overview", headers=oh).json()
        return int(next(t["value"] for t in o["subscriptions"] if t["key"] == "trial"))

    def shown() -> int:
        return int(c.get("/api/platform/tenants?filter=trial", headers=oh).json()["shown"])

    before = trial_tile()
    assert before >= 1 and shown() == before
    with platform_context():
        TenantSubscription.unscoped.filter(tenant_id=ctx["tenant"].id).update(
            state="trial", expires_at=timezone.now() - timedelta(days=3)
        )
    assert trial_tile() == before - 1 and shown() == before - 1
    rows = c.get("/api/platform/tenants", headers=oh).json()["tenants"]
    row = next(r for r in rows if r["id"] == str(ctx["tenant"].id))
    assert row["status"] == "trial" and "انتهت قبل" in row["due_line"]

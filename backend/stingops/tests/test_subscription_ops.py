"""PLT-13 (بأمر المالك 2026-09-21): تصرّف المشغّل في اشتراك مستأجر — تمديد/تغيير باقة/إيقاف/
استئناف/ملاحظة، كلٌّ بسبب مسجَّل في الخط الزمني وفي تدقيق المستأجر؛ الإيقاف يوقف الميزات المدفوعة
ولا يحجب الدفتر ولا البيع النقدي."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from core.models import AuditEvent, TenantSubscription
from core.subscription import ensure_subscription, has_feature
from core.tenancy import platform_context, tenant_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from stingops.models import OperatorAccessLog, SubscriptionEvent
from stingops.tests.test_operator import _operator_headers

pytestmark = pytest.mark.django_db(transaction=True)


def test_operator_subscription_actions(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    oh = _operator_headers("ops2", "هدى — تشغيل")
    tid = ctx["tenant"].id
    url = f"/api/platform/tenants/{tid}/subscription"
    # المالك لا يملك المسار
    assert _post(c, _h(ctx["tokens"]["owner"]), url, {"action": "note"}).status_code == 403
    # بلا سبب: مرفوض
    r = _post(c, oh, url, {"action": "extend", "days": 30})
    assert r.status_code == 400 and r.json()["detail"] == "reason_required"
    r = _post(c, oh, url, {"action": "extend", "days": 400, "reason": "x"})
    assert r.json()["detail"] == "days_out_of_range"
    # تمديد 30 يوماً من تاريخ الانتهاء القائم
    with tenant_context(tid):
        before = ensure_subscription().expires_at
    r = _post(c, oh, url, {"action": "extend", "days": 30, "reason": "دفع نقدي في المكتب"})
    assert r.status_code == 200
    with tenant_context(tid):
        sub = TenantSubscription.objects.get()
        assert sub.expires_at == before + timedelta(days=30)
        assert AuditEvent.objects.filter(kind="subscription.extended").exists()
    t = r.json()["tenant"]
    assert t["timeline"][0]["kind"] == "extend" and t["timeline"][0]["days"] == 30
    assert t["timeline"][-1]["kind"] == "start"
    # تغيير الباقة: تجريبية → فرعان؛ الميزة تتغيّر فوراً؛ نفس الباقة مرفوض
    with tenant_context(tid):
        assert has_feature("multi_branch") is False
    r = _post(c, oh, url, {"action": "plan", "plan_code": "dual", "reason": "ترقية باتفاق"})
    assert r.status_code == 200 and r.json()["tenant"]["entitlement"]["plan_code"] == "dual"
    with tenant_context(tid):
        assert has_feature("multi_branch") is True
        assert TenantSubscription.objects.get().state == TenantSubscription.State.ACTIVE
    same = _post(c, oh, url, {"action": "plan", "plan_code": "dual", "reason": "x"})
    assert same.status_code == 409
    assert (
        _post(c, oh, url, {"action": "plan", "plan_code": "trial", "reason": "x"}).json()["detail"]
        == "trial_not_reassignable"
    )
    # الإيقاف: الميزات المدفوعة تتوقف، pos_core لا، والحالة «موقوف» في القائمة والمالك يرى السبب
    r = _post(c, oh, url, {"action": "suspend", "reason": "بلاغ احتيال قيد التحقق"})
    assert r.status_code == 200 and r.json()["tenant"]["status"] == "suspended"
    assert "بلاغ احتيال" in r.json()["tenant"]["due_line"]
    with tenant_context(tid):
        assert has_feature("multi_branch") is False and has_feature("pos_core") is True
    lst = c.get("/api/platform/tenants?filter=suspended", headers=oh).json()
    assert lst["shown"] == 1 and lst["tenants"][0]["status_label"] == "موقوف"
    exp = c.get("/api/org/subscription/expiry", headers=_h(ctx["tokens"]["owner"])).json()
    assert exp["state"] == "suspended" and exp["suspended_reason"] == "بلاغ احتيال قيد التحقق"
    assert _post(c, oh, url, {"action": "suspend", "reason": "x"}).status_code == 409
    # الاستئناف يعيد الميزات
    r = _post(c, oh, url, {"action": "resume", "reason": "انتهى التحقق — لا مخالفة"})
    assert r.status_code == 200 and r.json()["tenant"]["status"] == "active"
    with tenant_context(tid):
        assert has_feature("multi_branch") is True
    # ملاحظة في الخط الزمني فقط
    r = _post(c, oh, url, {"action": "note", "reason": "اتصل المالك بخصوص فرع ثالث"})
    assert r.status_code == 200
    kinds = [e["kind"] for e in r.json()["tenant"]["timeline"]]
    assert kinds[:5] == ["note", "resume", "suspend", "plan_change", "extend"]
    with platform_context():
        assert SubscriptionEvent.objects.filter(tenant_id=tid).count() == 5
        assert OperatorAccessLog.objects.filter(action__startswith="subscription.").count() == 5
    bogus = _post(c, oh, url, {"action": "bogus", "reason": "x"})
    assert bogus.json()["detail"] == "unknown_action"
    # الوقت لا يُلمس بالإيقاف: ما زال حتى التاريخ الممدَّد
    with tenant_context(tid):
        assert TenantSubscription.objects.get().expires_at > timezone.now() + timedelta(days=20)


def test_start_line_survives_upgrade_by_proof(ctx: dict[str, Any]) -> None:  # noqa: F811
    """مراجعة 2026-10-19 (بند 9): سطر البداية لا يتبدّل باسم الباقة الحالية بعد ترقية بإثبات."""
    c = Client()
    owner = _h(ctx["tokens"]["owner"])
    oh = _operator_headers("ops10", "هدى — تشغيل")
    tid = ctx["tenant"].id
    url = f"/api/platform/tenants/{tid}/subscription"
    with tenant_context(tid):
        ensure_subscription()
    first = _post(c, oh, url, {"action": "note", "reason": "ملاحظة"}).json()["tenant"]["timeline"]
    assert first[-1]["kind_label"] == "بدء التجريبية"
    proofs = "/api/org/subscription/proofs"
    pr = _post(c, owner, proofs, {"reference": "TRX-9", "plan_code": "dual"})
    pid = pr.json()["proof"]["id"]
    assert _post(c, oh, f"/api/platform/proofs/{tid}/{pid}/approve", {}).status_code == 200
    after = _post(c, oh, url, {"action": "note", "reason": "ملاحظة ثانية"}).json()["tenant"]
    start = after["timeline"][-1]
    assert start["kind"] == "start"
    assert start["kind_label"] == "بدء التجريبية" and start["to_plan"] == "تجريبية"


def test_concurrent_extensions_keep_both(ctx: dict[str, Any]) -> None:  # noqa: F811
    """فحص 2026-11-07: تمديدان متزامنان من 10 و20 يوماً يضيفان 30 يوماً، بحدث لكل منهما."""
    import threading

    from django.db import connections

    from stingops.subscriptions import extend

    tenant = ctx["tenant"]
    with tenant_context(tenant.id):
        sub = ensure_subscription()
        sub.state = TenantSubscription.State.ACTIVE
        sub.expires_at = timezone.now() + timedelta(days=5)
        sub.save()
        before = sub.expires_at
    barrier = threading.Barrier(2)
    errors: list[BaseException] = []

    def worker(days: int) -> None:
        barrier.wait()
        try:
            extend(tenant, days=days, reason="دفع نقدي", by_name="هدى")
        except BaseException as e:  # pragma: no cover — يظهر في التأكيد أدناه
            errors.append(e)
        finally:
            connections.close_all()

    threads = [threading.Thread(target=worker, args=(d,)) for d in (10, 20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    with tenant_context(tenant.id):
        assert TenantSubscription.objects.get().expires_at == before + timedelta(days=30)
    with platform_context():
        days = sorted(
            SubscriptionEvent.objects.filter(tenant_id=tenant.id, kind="extend").values_list(
                "days", flat=True
            )
        )
    assert days == [10, 20]


def test_plan_change_prices_current_cycle_and_rejects_archived(ctx: dict[str, Any]) -> None:  # noqa: F811
    """فحص 2026-11-07: مبلغ التجديد بسعر دورة الاشتراك القائمة، والباقة المؤرشفة لا تُسنَد."""
    from core.models import PlanCatalog
    from core.subscription import PLANS

    c = Client()
    oh = _operator_headers("ops11", "هدى — تشغيل")
    tid = ctx["tenant"].id
    url = f"/api/platform/tenants/{tid}/subscription"
    with tenant_context(tid):
        sub = ensure_subscription()
        sub.plan_code = "dual"
        sub.state = TenantSubscription.State.ACTIVE
        sub.cycle = "yearly"
        sub.expires_at = timezone.now() + timedelta(days=200)
        sub.save()
        expires = sub.expires_at
    with platform_context():
        PlanCatalog.objects.filter(code="single").update(price_yearly_minor=48000000)
    PLANS.refresh()
    r = _post(c, oh, url, {"action": "plan", "plan_code": "single", "reason": "تخفيض باتفاق"})
    assert r.status_code == 200
    assert r.json()["tenant"]["entitlement"]["renewal_amount_minor"] == "48000000"
    with tenant_context(tid):
        sub = TenantSubscription.objects.get()
        assert sub.renewal_amount_minor == 48000000
        assert sub.expires_at == expires and sub.cycle == "yearly"
    # دورة لا تعرضها الباقة الجديدة: رفض صريح، والاشتراك كما هو
    with platform_context():
        PlanCatalog.objects.filter(code="dual").update(price_yearly_minor=0)
    PLANS.refresh()
    r = _post(c, oh, url, {"action": "plan", "plan_code": "dual", "reason": "ترقية"})
    assert r.status_code == 409 and r.json()["detail"] == "cycle_unavailable"
    with tenant_context(tid):
        assert TenantSubscription.objects.get().plan_code == "single"
    # الباقة المؤرشفة: لا تُسنَد، ومن عليها يبقى مقروءاً
    with platform_context():
        PlanCatalog.objects.filter(code="dual").update(price_yearly_minor=90000000)
    _post(c, oh, "/api/platform/plans/dual/update", {"is_active": False, "reason": "توقّف"})
    PLANS.refresh()
    r = _post(c, oh, url, {"action": "plan", "plan_code": "dual", "reason": "ترقية"})
    assert r.status_code == 409 and r.json()["detail"] == "plan_archived"
    with tenant_context(tid):
        sub = TenantSubscription.objects.get()
        sub.plan_code = "dual"
        sub.save(update_fields=["plan_code"])
    note = _post(c, oh, url, {"action": "note", "reason": "مستأجر على باقة مؤرشفة"})
    assert note.status_code == 200
    assert note.json()["tenant"]["entitlement"]["plan_code"] == "dual"


def test_free_monthly_plan_can_be_assigned(ctx: dict[str, Any]) -> None:  # noqa: F811
    """مراجعة 2026-11-08: باقة شهرية مجانية تُسنَد؛ صفر الربعي/السنوي وحده يعني «غير معروضة»."""
    from core.models import PlanCatalog
    from core.subscription import PLANS

    c = Client()
    oh = _operator_headers("ops12", "هدى — تشغيل")
    tid = ctx["tenant"].id
    PLANS.ensure_seeded()  # الكتالوج يُبذر كسولاً — التحديث قبل البذر لا يمسّ شيئاً
    with platform_context():
        assert PlanCatalog.objects.filter(code="single").update(price_monthly_minor=0) == 1
    PLANS.refresh()
    r = _post(
        c,
        oh,
        f"/api/platform/tenants/{tid}/subscription",
        {"action": "plan", "plan_code": "single", "reason": "شريك"},
    )
    assert r.status_code == 200, r.content
    assert r.json()["tenant"]["entitlement"]["renewal_amount_minor"] == "0"

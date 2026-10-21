"""مراجعة منطق الاشتراكات (0005 §١٨٧): لا تفعيل لباقة ولا إضافة ولا تمديد بلا اعتماد مدير المنصة.

- الرفع من المالك (تجديد/ترقية/إضافة) لا يغيّر الباقة ولا الحدود ولا تاريخ الانتهاء؛
- الاعتماد لمدير المنصة وحده: لا المالك ولا مشغّل «الدعم» ولا غير الموثَّق، على المسارين؛
- رقم العملية المعتمد لمستأجر لا يُعتمد ثانيةً لآخر — على المسارين (القديم لم يفحصه).
"""

from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from core import subscription
from core.models import Tenant, TenantSubscription
from core.tenancy import platform_context, tenant_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from stingops.models import OperatorProfile
from stingops.tests.test_operator import _operator_headers

pytestmark = pytest.mark.django_db(transaction=True)

PROOFS = "/api/org/subscription/proofs"


def _snapshot(tenant_id: Any) -> dict[str, Any]:
    with tenant_context(tenant_id):
        sub = TenantSubscription.objects.get()
        return {
            "plan": sub.plan_code,
            "state": sub.state,
            "expires_at": sub.expires_at,
            "addons": (sub.addon_branches, sub.addon_devices, sub.addon_users),
            "limits": subscription.effective_limits(sub),
        }


def _paid_active(tenant_id: Any) -> None:
    with tenant_context(tenant_id):
        sub = subscription.ensure_subscription()
        sub.plan_code = "single"
        sub.state = TenantSubscription.State.ACTIVE
        sub.expires_at = timezone.now() + timedelta(days=15, hours=1)
        sub.save()


def _support_headers() -> dict[str, str]:
    h = _operator_headers("gate-sup", "طيب — دعم")
    with platform_context():
        OperatorProfile.objects.filter(user__username="gate-sup").update(role="support")
    return h


def test_nothing_activates_before_admin_approval(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    owner = _h(ctx["tokens"]["owner"])
    _paid_active(ctx["tenant"].id)
    before = _snapshot(ctx["tenant"].id)
    ids = []
    for body in (
        {"reference": "G-RENEW", "plan_code": "dual"},
        {"reference": "G-UP", "plan_code": "dual", "kind": "upgrade"},
        {
            "reference": "G-ADD",
            "plan_code": "single",
            "kind": "addon",
            "addon_kind": "devices",
            "addon_qty": 2,
        },
    ):
        r = _post(c, owner, PROOFS, body)
        assert r.status_code == 201, r.content
        assert r.json()["proof"]["status"] == "pending"
        ids.append(r.json()["proof"]["id"])
    # الرفع لا يفعّل شيئاً
    assert _snapshot(ctx["tenant"].id) == before
    # لا مالك ولا دعم ولا بلا جلسة يعتمد — على المسارين
    sup = _support_headers()
    for pid in ids:
        strict = f"/api/platform/proofs/{ctx['tenant'].id}/{pid}/approve"
        legacy = f"/api/platform/tenants/{ctx['tenant'].id}/subscription-proofs/{pid}/review"
        for headers in (owner, sup, {}):
            assert c.post(
                strict, {}, content_type="application/json", headers=headers
            ).status_code in {401, 403}
            assert c.post(
                legacy, {"decision": "approve"}, content_type="application/json", headers=headers
            ).status_code in {401, 403}
    assert _snapshot(ctx["tenant"].id) == before
    # مدير المنصة يعتمد فتسري الإضافة الآن
    admin = _operator_headers("gate-adm", "هدى — مديرة")
    r = c.post(
        f"/api/platform/proofs/{ctx['tenant'].id}/{ids[2]}/approve",
        {},
        content_type="application/json",
        headers=admin,
    )
    assert r.status_code == 200, r.content
    assert _snapshot(ctx["tenant"].id)["addons"] == (0, 2, 0)


def _other_tenant_pending_proof(reference: str) -> tuple[Tenant, str]:
    with platform_context():
        other = Tenant.unscoped.create(
            name="منشأة أخرى", base_currency="SDG", base_currency_exponent=2
        )
    with tenant_context(other.id):
        subscription.ensure_subscription()
        p = subscription.submit_proof(
            actor=SimpleNamespace(display_name="مالك آخر"),  # type: ignore[arg-type]
            reference=reference,
            plan_code="dual",
        )
    return other, str(p.id)


@pytest.mark.parametrize("path", ["strict", "legacy"])
def test_approved_reference_cannot_approve_another_tenant(
    ctx: dict[str, Any],  # noqa: F811
    path: str,
) -> None:
    c = Client()
    owner = _h(ctx["tokens"]["owner"])
    admin = _operator_headers("gate-adm2", "هدى — مديرة")
    r = _post(c, owner, PROOFS, {"reference": "BANK-777", "plan_code": "single"})
    assert r.status_code == 201
    first = r.json()["proof"]["id"]
    assert (
        c.post(
            f"/api/platform/proofs/{ctx['tenant'].id}/{first}/approve",
            {},
            content_type="application/json",
            headers=admin,
        ).status_code
        == 200
    )
    # المنشأة الأخرى ترفع الرقم نفسه (الفريدة داخل المنشأة وحدها)
    other, pid = _other_tenant_pending_proof("BANK-777")
    before = _snapshot(other.id)
    if path == "strict":
        url = f"/api/platform/proofs/{other.id}/{pid}/approve"
        body: dict[str, Any] = {}
    else:
        url = f"/api/platform/tenants/{other.id}/subscription-proofs/{pid}/review"
        body = {"decision": "approve"}
    r = c.post(url, body, content_type="application/json", headers=admin)
    assert r.status_code == 400 and r.json()["detail"] == "reference_used", r.content
    assert _snapshot(other.id) == before

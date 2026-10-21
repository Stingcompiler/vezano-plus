"""0005 §١٨٧: المنشأة الجديدة بانتظار اعتماد مدير المنصة — لا تجربة ولا جهاز ولا ميزات قبله.
المنشآت السابقة (بلا صف اشتراك) تبقى تجريبية كسولاً فلا يتأثر وضعها."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from core import subscription
from core.auth.accounts import create_account
from core.auth.memberships import create_tenant
from core.models import Tenant, TenantSubscription
from core.tenancy import platform_context, tenant_context
from stingops.models import OperatorProfile, SubscriptionEvent
from stingops.tests.test_operator import _operator_headers

pytestmark = pytest.mark.django_db(transaction=True)

PASSWORD = "Sting-demo-2026!"  # noqa: S105 — كلمة مرور اختبار


def _new_tenant(identifier: str = "0912447002") -> tuple[Tenant, str]:
    account = create_account(identifier, PASSWORD, "المالك")
    result = create_tenant(
        account,
        client_request_id=uuid.uuid4(),
        name="منشأة جديدة",
        sector="grocery",
        currency="SDG",
        first_branch_name="الرئيسي",
    )
    c = Client()
    r = c.post(
        "/api/auth/account/login",
        {"identifier": identifier, "password": PASSWORD},
        content_type="application/json",
    )
    assert r.status_code == 200, r.content
    with platform_context():
        tenant = Tenant.unscoped.get(id=result.creation.tenant_id)
    return tenant, str(r.json()["access"])


def _support_headers() -> dict[str, str]:
    h = _operator_headers("trial-sup", "طيب — دعم")
    with platform_context():
        OperatorProfile.objects.filter(user__username="trial-sup").update(role="support")
    return h


def test_new_tenant_is_pending_and_gated() -> None:
    tenant, access = _new_tenant()
    with tenant_context(tenant.id):
        sub = TenantSubscription.objects.get()
        assert sub.state == "pending" and subscription.status_of(sub) == "pending_approval"
        assert subscription.has_feature("pos_core") is True  # الأساسيات لا تُحجب
        assert subscription.has_feature("multi_branch") is False
        assert subscription.can_register_device() == (False, "approval_pending")
        assert subscription.can_add_branch() == (False, "approval_pending")
        assert subscription.can_add_user() == (False, "approval_pending")
        payload = subscription.entitlements_payload(viewer_is_owner=True)
        assert payload["plan"]["state"] == "pending_approval"
        assert all(f["status"] in {"open", "locked"} for f in payload["features"])
        assert [f["status"] for f in payload["features"] if f["code"] == "multi_branch"] == [
            "locked"
        ]
    # تسجيل جهاز يُرفض بسبب صريح
    r = Client().post(
        "/api/devices/register",
        {"name": "تابلت"},
        content_type="application/json",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert r.status_code == 403 and r.json()["detail"] == "approval_pending"


def test_only_platform_admin_approves_and_trial_starts_at_approval() -> None:
    tenant, access = _new_tenant("0912447003")
    c = Client()
    url = f"/api/platform/tenants/{tenant.id}/subscription"
    body = {"action": "approve_trial", "reason": "طلب موثَّق"}
    # لا المالك ولا الدعم ولا بلا جلسة
    for headers in (
        {"Authorization": f"Bearer {access}"},
        _support_headers(),
        {},
    ):
        r = c.post(url, body, content_type="application/json", headers=headers)
        assert r.status_code in {401, 403}, r.content
    with tenant_context(tenant.id):
        assert TenantSubscription.objects.get().state == "pending"
    # يمرّ مدير المنصة: تبدأ التجربة من لحظة الاعتماد
    admin = _operator_headers("trial-adm", "هدى — مديرة")
    before = timezone.now()
    r = c.post(url, body, content_type="application/json", headers=admin)
    assert r.status_code == 200, r.content
    with tenant_context(tenant.id):
        sub = TenantSubscription.objects.get()
        assert sub.state == "trial" and sub.plan_code == "trial"
        assert sub.expires_at - before > timedelta(days=subscription.trial_days() - 1)
        assert subscription.status_of(sub) == "trial"
        assert subscription.can_register_device() == (True, "")
        assert subscription.has_feature("multi_branch") is False  # ميزات التجريبية كما كانت
    with platform_context():
        assert SubscriptionEvent.objects.filter(
            tenant=tenant, kind="trial_approved", by_name="هدى — مديرة"
        ).exists()
    # الجهاز يُسجَّل الآن
    r = Client().post(
        "/api/devices/register",
        {"name": "تابلت"},
        content_type="application/json",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert r.status_code == 201, r.content
    # لا اعتماد ثانٍ
    r = c.post(url, body, content_type="application/json", headers=admin)
    assert r.status_code == 409 and r.json()["detail"] == "not_pending_approval"


def test_platform_list_shows_pending_and_filters() -> None:
    tenant, _ = _new_tenant("0912447004")
    c = Client()
    admin = _operator_headers("trial-adm2", "هدى — مديرة")
    rows: Any = c.get("/api/platform/tenants?filter=pending_approval", headers=admin).json()
    mine = [t for t in rows["tenants"] if t["id"] == str(tenant.id)]
    assert mine and mine[0]["status"] == "pending_approval"
    assert mine[0]["status_label"] == "بانتظار الاعتماد"


def test_legacy_tenant_without_subscription_row_stays_trial() -> None:
    with platform_context():
        legacy = Tenant.unscoped.create(
            name="منشأة سابقة", base_currency="SDG", base_currency_exponent=2
        )
    with tenant_context(legacy.id):
        sub = subscription.ensure_subscription()
        assert sub.state == "trial" and subscription.status_of(sub) == "trial"

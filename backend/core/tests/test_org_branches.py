"""ORG-03/04 (T2.2): لا حذف لفرع له دفتر — إقفال بعد تحويل المخزون؛ رمز الفرع ثابت بعد أول فاتورة
(§٨.٢)؛ الإنشاء للمالك ومدير الفرع يرى فرعه؛ الأجهزة بآخر اتصال ناجح والمعلّق المبلَّغ بلا وصف
«متصل» كاذب (§٩.٣)."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from core.models import Branch, Session
from core.tenancy import tenant_context
from core.tests.test_org import _h, ctx  # noqa: F401

pytestmark = pytest.mark.django_db(transaction=True)


def test_branches_create_code_lock_and_close(ctx: dict[str, Any]) -> None:  # noqa: F811
    c, h = Client(), _h(ctx["tokens"]["owner"])
    with tenant_context(ctx["tenant"].id):
        # باقة فرعين، والفرع الثاني المبذور مُقفل — فيبقى مقعد لفرع جديد (حدّ الباقة رقم صريح)
        from core.subscription import set_for_scenario

        set_for_scenario(state="active", plan_code="dual")
        Branch.objects.exclude(id=ctx["branch"].id).update(is_active=False)
    r = c.get("/api/org/branches", headers=h)
    assert r.status_code == 200 and r.json()["can_create"] is True
    main = r.json()["branches"][0]
    assert main["code_locked"] is False and main["ledger"]["invoices"] == 0
    assert len(main["devices"]) == 3  # الأجهزة المرتبطة بالفرع (المالك والمدير والكاشير)
    assert len(r.json()["branches"]) == 2
    # إنشاء فرع: الرمز لاتيني قصير فريد
    r = c.post(
        "/api/org/branches",
        {"name": "فرع شمبات", "code": "shm"},
        content_type="application/json",
        headers=h,
    )
    assert r.status_code == 201 and r.json()["code"] == "SHM"
    bid = r.json()["id"]
    assert (
        c.post(
            "/api/org/branches",
            {"name": "x", "code": "SHM"},
            content_type="application/json",
            headers=h,
        ).json()["detail"]
        == "code_taken"
    )
    assert (
        c.post(
            "/api/org/branches",
            {"name": "x", "code": "b"},
            content_type="application/json",
            headers=h,
        ).json()["detail"]
        == "code_invalid"
    )
    # الحذف غير موجود
    r = c.post(f"/api/org/branches/{bid}/delete", content_type="application/json", headers=h)
    assert (
        r.status_code == 400 and r.json()["detail"] == "delete_unavailable" and "ledger" in r.json()
    )
    # الرمز يُعدَّل قبل أول فاتورة ثم يُقفل
    r = c.post(
        f"/api/org/branches/{bid}/update",
        {"code": "BAH", "name": "بحري"},
        content_type="application/json",
        headers=h,
    )
    assert r.status_code == 200 and r.json()["code"] == "BAH" and r.json()["name"] == "بحري"
    with tenant_context(ctx["tenant"].id):
        from sales.models import Sale

        branch = Branch.objects.get(id=bid)
        Sale.objects.create(
            tenant=ctx["tenant"],
            branch_id=branch.id,
            device_id=ctx["device_ids"]["owner"],
            user_id=ctx["users"]["owner"].id,
            invoice_number="INV-BAH-A1-26-000001",
            business_date=timezone.localdate(),
            occurred_at=timezone.now(),
            subtotal_minor=10000,
            total_minor=10000,
            cash_minor=10000,
        )
    r = c.post(
        f"/api/org/branches/{bid}/update",
        {"code": "XYZ"},
        content_type="application/json",
        headers=h,
    )
    assert r.status_code == 400 and r.json()["detail"] == "code_locked"
    r = c.get("/api/org/branches", headers=h)
    row = next(b for b in r.json()["branches"] if b["id"] == bid)
    assert row["code_locked"] is True and row["ledger"]["invoices"] == 1
    # الإقفال: الفرع الافتراضي لا يُقفل؛ فرع بلا مخزون ولا وردية مفتوحة يُقفل ويبقى في القائمة
    assert (
        c.post(
            f"/api/org/branches/{main['id']}/close", content_type="application/json", headers=h
        ).json()["detail"]
        == "default_branch"
    )
    r = c.post(f"/api/org/branches/{bid}/close", content_type="application/json", headers=h)
    assert r.status_code == 200 and r.json()["is_active"] is False
    assert any(b["id"] == bid for b in c.get("/api/org/branches", headers=h).json()["branches"])


def test_manager_scope_and_devices(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    mh = _h(ctx["tokens"]["manager"])
    r = c.get("/api/org/branches", headers=mh)
    assert (
        r.status_code == 200 and r.json()["can_create"] is False and len(r.json()["branches"]) == 1
    )
    assert (
        c.post(
            "/api/org/branches",
            {"name": "x", "code": "ABC"},
            content_type="application/json",
            headers=mh,
        ).status_code
        == 403
    )
    assert c.get("/api/org/devices", headers=_h(ctx["tokens"]["cashier"])).status_code == 403
    # الأجهزة: آخر اتصال ناجح والمعلّق المبلَّغ والحالة الحسابية
    with tenant_context(ctx["tenant"].id):
        old = timezone.now() - timedelta(days=5)
        Session.objects.filter(device_id=ctx["device_ids"]["cashier"]).update(
            last_seen_at=old, reported_pending=312, reported_pending_at=old
        )
        Session.objects.filter(device_id=ctx["device_ids"]["manager"]).update(
            last_seen_at=timezone.now() - timedelta(hours=3)
        )
    r = c.get("/api/org/devices", headers=_h(ctx["tokens"]["owner"]))
    assert r.status_code == 200
    body = r.json()
    assert body["counts"]["total"] == 3 and body["device_limit"] == 3
    by = {d["name"]: d for d in body["devices"]}
    assert by["جهاز owner"]["connectivity"] == "connected" and by["جهاز owner"]["pending"] == 0
    assert by["جهاز manager"]["connectivity"] == "offline"
    assert by["جهاز cashier"]["connectivity"] == "stale" and by["جهاز cashier"]["pending"] == 312
    assert by["جهاز cashier"]["users"] == ["أحمد ياسين"]
    assert body["counts"]["pending_total"] == 312


def test_owner_revokes_device_from_list(ctx: dict[str, Any]) -> None:  # noqa: F811
    """0005 §٢٥٣ (بلاغ المالك 2026-11-11): لم يكن في القائمة ما يسحب جهازاً، فبلغت المنشأة حدّ
    الباقة ولا سبيل لتحرير مكان. السحب للمالك وحده، ولا يمرّ على معلّق لم يُرَ عدده، ويحرّر مكاناً
    من الحدّ."""
    from core.models import AuditEvent, Device
    from core.subscription import can_register_device

    c = Client()
    oh = _h(ctx["tokens"]["owner"])
    dev = ctx["device_ids"]["cashier"]
    url = f"/api/org/devices/{dev}/revoke"

    def post(h: dict[str, str], body: dict[str, Any]) -> Any:
        return c.post(url, body, content_type="application/json", headers=h)

    r = post(_h(ctx["tokens"]["manager"]), {})
    assert r.status_code == 403 and r.json()["detail"] == "owner_required"

    with tenant_context(ctx["tenant"].id):
        assert can_register_device() == (False, "device_limit")  # 3 من 3
        Session.objects.filter(device_id=dev).update(
            reported_pending=4, reported_pending_at=timezone.now()
        )
    # معلّق لم يُعرض عدده على المالك بعد: رفض يحمل العدد
    r = post(oh, {"pending_seen": 0})
    assert r.status_code == 409
    assert r.json() == {"detail": "pending_unseen", "extra": {"pending": 4}}
    with tenant_context(ctx["tenant"].id):
        assert Device.objects.get(id=dev).status == Device.Status.ACTIVE

    r = post(oh, {"pending_seen": 4})
    assert r.status_code == 200, r.json()
    body = r.json()
    row = next(d for d in body["devices"] if d["id"] == str(dev))
    assert row["status"] == "revoked" and row["connectivity"] == "revoked"
    assert body["counts"]["total"] == 3 and body["counts"]["active"] == 2
    assert body["can_revoke"] is True
    with tenant_context(ctx["tenant"].id):
        assert not Session.objects.filter(device_id=dev, revoked_at__isnull=True).exists()
        ev = AuditEvent.objects.filter(kind="device.revoked").get()
        assert "4 عملية لم تُرفع" in ev.detail
        assert can_register_device() == (True, "")  # مكان تحرّر
    # جلسة الجهاز المسحوب لا تعمل بعده
    assert c.get("/api/org/devices", headers=_h(ctx["tokens"]["cashier"])).status_code == 401

    assert post(oh, {"pending_seen": 4}).json()["detail"] == "device_not_active"
    r = c.post(
        "/api/org/devices/00000000-0000-7000-8000-000000000000/revoke",
        {},
        content_type="application/json",
        headers=oh,
    )
    assert r.status_code == 404
    # غير المالك لا يُعرض له السحب
    seen_by_manager = c.get("/api/org/devices", headers=_h(ctx["tokens"]["manager"])).json()
    assert seen_by_manager["can_revoke"] is False

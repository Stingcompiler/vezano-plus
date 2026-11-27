"""S-04 و S-05 من مراجعة البيع 2026-11-22 (0005 §٢٩٣): اعتماد المدير الحاضر برمزه، و«طلبات
تنتظرك» للمالك والمدير، والإقفال الإداري لوردية مهجورة.

- برمز عند الصندوق: الخادم يعيد الفحص عند الرفع — ضمن الحدّ يُسجَّل معتمداً باسم صاحب الرمز؛ فوق
  الحدّ أو الطالب نفسه أو رمز تغيّر قبل الاعتماد يُحجر `approval_invalid` (والمالك يقبله في SYS-03).
- اعتماد بلا اتصال يُرفع بعد ساعات ويُفحص بوقته (رمز تغيّر بعده مقبول).
- الصندوق: قبول ورفض بسبب، والطالب يعرف النتيجة، والسحب المعتمد يُسجَّل بالطلب نفسه.
- الإقفال الإداري: المدير ضمن حدّ «إغلاق وردية بعجز»، وما فوقه للمالك.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from conftest import TwoTenants
from core.auth.devices import register_device
from core.auth.pin import set_user_pin
from core.models import Notification, PinVerifier, Role, User, UserBranchAccess
from core.tenancy import platform_context, tenant_context
from sales.models import CreditOverride, DiscountOverride
from shifts.models import CashMovementRequest, Shift, ShiftCashMovement
from sync.counter import ensure_state
from sync.models import QuarantinedOperation
from sync.push import PROTOCOL_VERSION, push

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.usefixtures("pinned_clock")]

NOW = "2026-09-17T11:00:00Z"


@pytest.fixture
def ctx(two_tenants: TwoTenants) -> dict[str, Any]:
    t, branch = two_tenants.a, two_tenants.a_branches[0]
    with platform_context():
        roles = {
            code: Role.unscoped.create(tenant=t, code=code, name=name)
            for code, name in (("owner", "مالك"), ("manager", "مدير فرع"), ("cashier", "كاشير"))
        }
        users = {}
        for key, name, code, owner in (
            ("owner", "ندى", "owner", True),
            ("manager", "عمر", "manager", False),
            ("cashier", "سالم", "cashier", False),
            ("cashier2", "هدى", "cashier", False),
        ):
            u = User.objects.create_user(tenant=t, username=key, display_name=name, is_owner=owner)
            UserBranchAccess.unscoped.create(tenant=t, user=u, branch=branch, role=roles[code])
            users[key] = u
    with tenant_context(t.id):
        for i, u in enumerate(users.values()):
            set_user_pin(u, f"{i + 1}{i + 1}{i + 1}{i + 1}{i + 1}{i + 1}")
        reg = register_device(user=users["cashier"], branch=branch, name="كاشير 1")
        regs = {
            k: register_device(user=users[k], branch=branch, name=f"جهاز {k}")
            for k in ("owner", "manager")
        }
        epoch = ensure_state(t.id).sync_epoch
    return {
        "tenant": t,
        "branch": branch,
        "other_branch": two_tenants.a_branches[1],
        "users": users,
        "device": reg.device,
        "access": reg.access,
        "owner_access": regs["owner"].access,
        "manager_access": regs["manager"].access,
        "epoch": epoch,
    }


def version(c: dict[str, Any], key: str) -> int:
    with tenant_context(c["tenant"].id):
        return int(PinVerifier.objects.get(user=c["users"][key]).version)


def do_push(c: dict[str, Any], *ops: dict[str, Any]) -> list[dict[str, Any]]:
    with tenant_context(c["tenant"].id):
        resp = push(
            device_id=c["device"].id,
            actor_user_id=c["users"]["cashier"].id,
            envelope={
                "protocol_version": PROTOCOL_VERSION,
                "sync_epoch": c["epoch"],
                "request_id": str(uuid.uuid4()),
                "operations": list(ops),
            },
            branch_id=str(c["branch"].id),
        ).as_dict()
    return list(resp["results"])


def op(kind: str, entity: str, payload: dict[str, Any], dep: str | None = None) -> dict[str, Any]:
    mid = next(v for k, v in payload.items() if k in ("request_id", "override_id", "movement_id"))
    return {
        "operation_id": str(uuid.uuid4()),
        "kind": kind,
        "op_version": 1,
        "dependencies": [dep] if dep else [],
        "members": [{"entity": entity, "id": mid, "schema_version": 1, "payload": payload}],
    }


def discount_op(
    c: dict[str, Any],
    minor: int,
    *,
    approver: str | None = None,
    ver: int | None = None,
    at: str = NOW,
) -> dict[str, Any]:
    rid = str(uuid.uuid4())
    p: dict[str, Any] = {
        "request_id": rid,
        "branch_id": str(c["branch"].id),
        "mode": "amount",
        "value": str(minor),
        "cap": "1000",
        "reason": "زبون دائم",
        "cart_total_minor": "200000",
        "discount_minor": str(minor),
        "occurred_at": at,
    }
    if approver:
        p |= {
            "approval_method": "pin",
            "approved_by_user_id": str(c["users"][approver].id),
            "verifier_version": str(ver if ver is not None else version(c, approver)),
        }
    return op("discount_override", "sales.DiscountOverride", p)


def shift_open(c: dict[str, Any], sid: str, at: str = NOW) -> dict[str, Any]:
    return {
        "operation_id": str(uuid.uuid4()),
        "kind": "shift_open",
        "op_version": 1,
        "dependencies": [],
        "members": [
            {
                "entity": "shifts.ShiftOpened",
                "id": sid,
                "schema_version": 1,
                "payload": {
                    "shift_id": sid,
                    "branch_id": str(c["branch"].id),
                    "device_id": str(c["device"].id),
                    "user_id": str(c["users"]["cashier"].id),
                    "opening_float_minor": "100000",
                    "business_date": at[:10],
                    "occurred_at": at,
                },
            }
        ],
    }


def withdrawal_op(
    c: dict[str, Any], sid: str, dep: str, minor: int, **extra: Any
) -> dict[str, Any]:
    mid = str(uuid.uuid4())
    return op(
        "cash_movement",
        "shifts.CashMovement",
        {
            "movement_id": mid,
            "shift_id": sid,
            "kind": "withdrawal",
            "signed_amount_minor": str(-minor),
            "reason": "توريد للخزنة الرئيسية",
            "actor_user_id": str(c["users"]["cashier"].id),
            "occurred_at": NOW,
            **extra,
        },
        dep,
    )


def credit_op(c: dict[str, Any], *, approver: str | None = None) -> dict[str, Any]:
    oid = str(uuid.uuid4())
    p: dict[str, Any] = {
        "override_id": oid,
        "sale_id": str(uuid.uuid4()),
        "party_id": str(uuid.uuid4()),
        "branch_id": str(c["branch"].id),
        "credit_limit_minor": "500000",
        "balance_after_minor": "620000",
        "reason": "زبون قديم يسدّد آخر الشهر",
        "occurred_at": NOW,
    }
    if approver:
        p |= {
            "approval_method": "pin",
            "approved_by_user_id": str(c["users"][approver].id),
            "verifier_version": str(version(c, approver)),
        }
    return op("credit_override", "sales.CreditOverride", p)


def api(c: dict[str, Any], who: str) -> dict[str, Any]:
    token = {"owner": c["owner_access"], "manager": c["manager_access"], "cashier": c["access"]}[
        who
    ]
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def held_code(c: dict[str, Any]) -> tuple[str, str]:
    with tenant_context(c["tenant"].id):
        q = QuarantinedOperation.objects.order_by("-received_at").first()
        assert q is not None
        return q.code, q.detail


# ---------------------------------------------------------------- برمز عند الصندوق


def test_pin_approval_within_limit_is_recorded_with_the_approver(ctx: dict[str, Any]) -> None:
    """المدير (حدّه 200.00 للعملية) يعتمد خصم 150.00 برمزه: معتمد باسمه `approved_via=pin`."""
    [r] = do_push(ctx, discount_op(ctx, 15000, approver="manager"))
    assert r["status"] == "accepted", r
    with tenant_context(ctx["tenant"].id):
        d = DiscountOverride.objects.get()
        assert d.status == "approved" and d.approved_via == "pin"
        assert d.decided_by_name == "عمر" and d.requested_by_name == "سالم"
        assert d.discount_minor == 15000


def test_pin_approval_above_limit_is_quarantined_and_owner_may_accept(
    ctx: dict[str, Any],
) -> None:
    """خصم 300.00 فوق حدّ المدير: يُحجر `approval_invalid` ولا يُسجَّل؛ قبول المالك في SYS-03 يطبّقه."""
    [r] = do_push(ctx, discount_op(ctx, 30000, approver="manager"))
    assert r["status"] == "conflicted" and r["code"] == "approval_invalid"
    assert held_code(ctx) == ("approval_invalid", "discount:over_limit")
    with tenant_context(ctx["tenant"].id):
        assert not DiscountOverride.objects.exists()
        held = QuarantinedOperation.objects.get()
        from sync.review import detail_payload

        assert detail_payload(held)["acceptable"] is True
    r2 = Client().post(
        f"/api/sync/quarantine/{held.id}/decide",
        {"decision": "accept", "reason": "اتفقتُ مع المدير هاتفياً"},
        content_type="application/json",
        **api(ctx, "owner"),
    )
    assert r2.status_code == 200, r2.content
    with tenant_context(ctx["tenant"].id):
        assert DiscountOverride.objects.get().status == "approved"


def test_pin_approval_by_requester_or_unknown_or_cashier_is_quarantined(
    ctx: dict[str, Any],
) -> None:
    """الطالب لا يعتمد طلبه، ورمز كاشير آخر لا يغطي ما فوق حدّه (10.00)."""
    [r] = do_push(ctx, discount_op(ctx, 5000, approver="cashier"))
    assert r["status"] == "conflicted" and held_code(ctx)[1] == "discount:self_approval"
    [r] = do_push(ctx, discount_op(ctx, 5000, approver="cashier2"))
    assert r["status"] == "conflicted" and held_code(ctx)[1] == "discount:over_limit"


def test_wrong_pin_version_is_quarantined(ctx: dict[str, Any]) -> None:
    """متحقق لا يطابق ما عند الخادم (رمز غُيّر قبل لحظة الاعتماد) = `stale_pin`."""
    old = version(ctx, "manager")
    with tenant_context(ctx["tenant"].id):
        set_user_pin(ctx["users"]["manager"], "909090")
    after = (timezone.now() + timedelta(minutes=5)).isoformat().replace("+00:00", "Z")
    [r] = do_push(ctx, discount_op(ctx, 15000, approver="manager", ver=old, at=after))
    assert r["status"] == "conflicted" and held_code(ctx)[1] == "discount:stale_pin"
    [r] = do_push(ctx, discount_op(ctx, 15000, approver="manager", ver=old + 7))
    assert r["status"] == "conflicted" and held_code(ctx)[1] == "discount:stale_pin"


def test_offline_pin_approval_is_verified_on_push_by_its_own_time(ctx: dict[str, Any]) -> None:
    """اعتماد بلا اتصال قبل ساعات ثم تغيّر الرمز ثم رُفع: يُقاس بوقته — الرمز كان صحيحاً حينها."""
    old = version(ctx, "manager")
    earlier = (timezone.now() - timedelta(hours=5)).isoformat().replace("+00:00", "Z")
    with tenant_context(ctx["tenant"].id):
        set_user_pin(ctx["users"]["manager"], "808080")
    [r] = do_push(ctx, discount_op(ctx, 15000, approver="manager", ver=old, at=earlier))
    assert r["status"] == "accepted", r
    with tenant_context(ctx["tenant"].id):
        assert DiscountOverride.objects.get().decided_by_name == "عمر"


def test_withdrawal_pin_is_owner_only(ctx: dict[str, Any]) -> None:
    """السحب للمالك وحده: رمز المدير يُحجر، ورمز المالك يُسجَّل باسمه `approved_via=pin`."""
    sid = str(uuid.uuid4())
    o = shift_open(ctx, sid)
    do_push(ctx, o)
    by_manager = withdrawal_op(
        ctx,
        sid,
        o["operation_id"],
        20000,
        approval_method="pin",
        authorized_by_user_id=str(ctx["users"]["manager"].id),
        verifier_version=str(version(ctx, "manager")),
    )
    [r] = do_push(ctx, by_manager)
    assert r["status"] == "conflicted" and held_code(ctx)[1] == "withdrawal:role_forbidden"
    by_owner = withdrawal_op(
        ctx,
        sid,
        o["operation_id"],
        20000,
        approval_method="pin",
        authorized_by_user_id=str(ctx["users"]["owner"].id),
        verifier_version=str(version(ctx, "owner")),
    )
    [r] = do_push(ctx, by_owner)
    assert r["status"] == "accepted", r
    with tenant_context(ctx["tenant"].id):
        m = ShiftCashMovement.objects.get()
        assert m.authorized_by_name == "ندى" and m.approved_via == "pin"


def test_credit_override_pin_by_manager_and_not_by_cashier(ctx: dict[str, Any]) -> None:
    [r] = do_push(ctx, credit_op(ctx, approver="manager"))
    assert r["status"] == "accepted"
    [r] = do_push(ctx, credit_op(ctx, approver="cashier2"))
    assert r["status"] == "conflicted" and held_code(ctx)[1] == "credit:own_customer_only"
    with tenant_context(ctx["tenant"].id):
        c = CreditOverride.objects.get()
        assert c.status == "approved" and c.decided_by_name == "عمر"


def test_verifiers_carry_role_cells_for_on_the_spot_approval(ctx: dict[str, Any]) -> None:
    r = Client().get("/api/devices/verifiers", **api(ctx, "cashier"))
    assert r.status_code == 200
    rows = {v["display_name"]: v for v in r.json()["verifiers"]}
    assert rows["عمر"]["role_code"] == "manager" and rows["عمر"]["is_owner"] is False
    assert rows["عمر"]["permissions"]["discount"]["limit_minor"] == "20000"
    assert rows["ندى"]["is_owner"] is True
    assert rows["ندى"]["permissions"]["discount"]["value"] == "unlimited"


# ---------------------------------------------------------------- «طلبات تنتظرك»


def test_inbox_accept_withdrawal_and_cashier_learns_then_records_it(ctx: dict[str, Any]) -> None:
    sid = str(uuid.uuid4())
    o = shift_open(ctx, sid)
    do_push(ctx, o)
    c = Client()
    r = c.post(
        f"/api/shifts/{sid}/requests",
        {"kind": "withdrawal", "amount_minor": "50000", "reason": "توريد للخزنة"},
        content_type="application/json",
        **api(ctx, "cashier"),
    )
    rid = r.json()["id"]
    # المدير يرى الطلب ولا يقرّر فيه (السحب للمالك)، والكاشير لا يرى الصندوق
    box = c.get("/api/approvals", **api(ctx, "manager")).json()
    assert box["can_review"] is True and box["items"][0]["can_decide"] is False
    assert c.get("/api/approvals", **api(ctx, "cashier")).json()["items"] == []
    box = c.get("/api/approvals", **api(ctx, "owner")).json()
    item = box["items"][0]
    assert item["kind"] == "withdrawal" and item["amount_minor"] == "50000"
    assert item["requested_by_name"] == "سالم" and item["can_decide"] is True
    # الرئيسية والإشعارات
    home = c.get("/api/home", **api(ctx, "owner")).json()
    assert any(d["id"] == "approvals" and d["href"] == "/approvals" for d in home["decisions"])
    with tenant_context(ctx["tenant"].id):
        from core import notifications

        notifications.refresh()
        assert Notification.objects.filter(kind="approval_pending").count() == 1
    r = c.post(
        f"/api/approvals/withdrawal/{rid}/decide",
        {"decision": "accept"},
        content_type="application/json",
        **api(ctx, "owner"),
    )
    assert r.status_code == 200 and r.json()["item"]["status"] == "approved"
    # شاشة الكاشير تعرف النتيجة
    mine = c.get(f"/api/approvals/withdrawal/{rid}", **api(ctx, "cashier")).json()
    assert mine["item"]["status"] == "approved" and mine["item"]["decided_by_name"] == "ندى"
    with tenant_context(ctx["tenant"].id):
        n = Notification.objects.get(kind="approval_decided")
        assert n.for_user == ctx["users"]["cashier"].id
        assert n.title == "وافق ندى على طلب سحب"
        notifications.refresh()
        assert Notification.objects.get(kind="approval_pending").resolved_at is not None
    # السحب يُسجَّل بالطلب: مبلغ آخر يُحجر، والمبلغ نفسه يُقبل باسم من وافق
    owner_id = str(ctx["users"]["owner"].id)
    wrong = withdrawal_op(
        ctx, sid, o["operation_id"], 60000, approval_request_id=rid, authorized_by_user_id=owner_id
    )
    [res] = do_push(ctx, wrong)
    assert res["status"] == "conflicted" and held_code(ctx)[1] == "withdrawal:request_not_approved"
    right = withdrawal_op(
        ctx, sid, o["operation_id"], 50000, approval_request_id=rid, authorized_by_user_id=owner_id
    )
    [res] = do_push(ctx, right)
    assert res["status"] == "accepted"
    with tenant_context(ctx["tenant"].id):
        m = ShiftCashMovement.objects.get()
        assert m.approved_via == "inbox" and str(m.approval_request_id) == rid
        assert m.authorized_by_name == "ندى"


def test_inbox_reject_discount_needs_reason_and_is_final(ctx: dict[str, Any]) -> None:
    do_push(ctx, discount_op(ctx, 15000))
    with tenant_context(ctx["tenant"].id):
        d = DiscountOverride.objects.get()
        assert d.status == "pending"
    c = Client()
    url = f"/api/approvals/discount/{d.id}/decide"
    r = c.post(url, {"decision": "reject"}, content_type="application/json", **api(ctx, "manager"))
    assert r.status_code == 400 and r.json()["errors"][0]["field"] == "reason"
    r = c.post(
        url,
        {"decision": "reject", "reason": "الخصم أكبر من هامش الصنف"},
        content_type="application/json",
        **api(ctx, "manager"),
    )
    assert r.status_code == 200, r.content
    assert r.json()["item"]["status"] == "rejected"
    assert r.json()["item"]["decision_reason"] == "الخصم أكبر من هامش الصنف"
    mine = c.get(f"/api/approvals/discount/{d.id}", **api(ctx, "cashier")).json()
    assert mine["item"]["status"] == "rejected" and mine["item"]["decided_by_name"] == "عمر"
    r = c.post(url, {"decision": "accept"}, content_type="application/json", **api(ctx, "owner"))
    assert r.status_code == 409 and r.json()["detail"] == "already_decided"


def test_inbox_discount_over_manager_limit_is_owners(ctx: dict[str, Any]) -> None:
    do_push(ctx, discount_op(ctx, 30000))
    with tenant_context(ctx["tenant"].id):
        d = DiscountOverride.objects.get()
    c = Client()
    box = c.get("/api/approvals", **api(ctx, "manager")).json()
    assert box["items"][0]["can_decide"] is False
    url = f"/api/approvals/discount/{d.id}/decide"
    r = c.post(url, {"decision": "accept"}, content_type="application/json", **api(ctx, "manager"))
    assert r.status_code == 403 and r.json()["reason"] == "over_limit"
    r = c.post(url, {"decision": "accept"}, content_type="application/json", **api(ctx, "owner"))
    assert r.status_code == 200 and r.json()["item"]["approved_via"] == "inbox"


# ---------------------------------------------------------------- S-05 الإقفال الإداري


def _abandoned(ctx: dict[str, Any]) -> str:
    sid = str(uuid.uuid4())
    at = (timezone.now() - timedelta(hours=26)).isoformat().replace("+00:00", "Z")
    do_push(ctx, shift_open(ctx, sid, at=at))
    return sid


def test_admin_close_within_limit_by_manager(ctx: dict[str, Any]) -> None:
    """عجز 200.00 ضمن حدّ المدير (300.00): يُقفلها باسمه وسببه، والمتوقَّع لقطة خادمية."""
    sid = _abandoned(ctx)
    c = Client()
    rows = c.get("/api/shifts/review", **api(ctx, "manager")).json()["shifts"]
    row = next(r for r in rows if r["id"] == sid)
    assert row["abandoned"] is True and row["can_admin_close"] is True
    assert row["close_limit_minor"] == "30000"
    home = c.get("/api/home", **api(ctx, "owner")).json()
    assert any(d["href"] == f"/shifts/review?close={sid}" for d in home["decisions"])
    url = f"/api/shifts/{sid}/admin-close"
    r = c.post(
        url, {"counted_cash_minor": "80000"}, content_type="application/json", **api(ctx, "manager")
    )
    assert r.status_code == 400 and r.json()["errors"][0]["field"] == "reason"
    r = c.post(
        url,
        {"counted_cash_minor": "80000", "reason": "الجهاز تعطّل وعُدّ الدرج بحضوري"},
        content_type="application/json",
        **api(ctx, "manager"),
    )
    assert r.status_code == 200, r.content
    row = r.json()["row"]
    assert row["state"] == "closed" and row["close_kind"] == "admin"
    assert row["closed_by_name"] == "عمر" and row["counted_by_name"] == "عمر"
    assert row["variance_minor"] == "-20000" and row["expected_source"] == "server"
    assert row["close_reason"] == "الجهاز تعطّل وعُدّ الدرج بحضوري"
    r = c.post(
        url,
        {"counted_cash_minor": "1", "reason": "x"},
        content_type="application/json",
        **api(ctx, "owner"),
    )
    assert r.status_code == 400 and r.json()["detail"] == "shift_closed"


def test_admin_close_above_limit_is_owner_only(ctx: dict[str, Any]) -> None:
    sid = _abandoned(ctx)
    c = Client()
    url = f"/api/shifts/{sid}/admin-close"
    body = {"counted_cash_minor": "60000", "reason": "عُدّ بحضوري"}
    r = c.post(url, body, content_type="application/json", **api(ctx, "manager"))
    assert r.status_code == 403 and r.json()["reason"] == "over_limit"
    assert r.json()["limit_minor"] == "30000"
    with tenant_context(ctx["tenant"].id):
        assert Shift.objects.get(id=sid).state == "open"
    r = c.post(url, body, content_type="application/json", **api(ctx, "owner"))
    assert r.status_code == 200 and r.json()["row"]["closed_by_name"] == "ندى"
    with tenant_context(ctx["tenant"].id):
        assert CashMovementRequest.objects.count() == 0
        s = Shift.objects.get(id=sid)
        assert s.state == "closed" and s.close_kind == "admin"


def test_inbox_credit_override_accept_by_manager(ctx: dict[str, Any]) -> None:
    """تجاوز حدّ ائتمان بلا معتمد حاضر: البيع تمّ («الحد أداة انتباه لا قفل»)، والتجاوز في الصندوق
    بالمبلغ الزائد (120.00 فوق الحدّ) حتى يوافق المدير."""
    do_push(ctx, credit_op(ctx))
    c = Client()
    item = c.get("/api/approvals", **api(ctx, "manager")).json()["items"][0]
    assert item["kind"] == "credit" and item["amount_minor"] == "120000"
    assert item["credit_limit_minor"] == "500000" and item["can_decide"] is True
    r = c.post(
        f"/api/approvals/credit/{item['id']}/decide",
        {"decision": "accept", "reason": ""},
        content_type="application/json",
        **api(ctx, "manager"),
    )
    assert r.status_code == 200 and r.json()["item"]["status"] == "approved"
    assert c.get("/api/approvals", **api(ctx, "owner")).json()["items"] == []

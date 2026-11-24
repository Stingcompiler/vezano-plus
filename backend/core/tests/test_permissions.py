"""مدخل الصلاحية الواحد `core.permissions.can` (مراجعة 2026-11-22 O-01/O-02؛ 0005 §٢٩٢): لكل صف من
صفوف المصفوفة الثلاثة عشر، تغيير الخلية من شاشة ORG-02 يغيّر ما يسمح به الخادم وما يرسله للشاشات؛
والمالك مسموح دائماً؛ و«لا» في الخصم تعني صفراً لا الحدّ التجريبي."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from django.test import Client

from conftest import TwoTenants
from core import home, org, permissions
from core.auth.devices import register_device
from core.models import Role, User, UserBranchAccess
from core.tenancy import platform_context, tenant_context

pytestmark = pytest.mark.django_db(transaction=True)

CODES = ("owner", "manager", "cashier", "storekeeper")


@pytest.fixture
def ctx(two_tenants: TwoTenants) -> dict[str, Any]:
    a, branch, other = two_tenants.a, two_tenants.a_branches[0], two_tenants.a_branches[1]
    with platform_context():
        roles = {
            code: Role.unscoped.create(tenant=a, code=code, name=name)
            for code, name in (
                ("owner", "مالك"),
                ("manager", "مدير فرع"),
                ("cashier", "كاشير"),
                ("storekeeper", "أمين مخزن"),
            )
        }
        users = {
            code: User.objects.create_user(
                tenant=a, username=f"u-{code}", display_name=code, is_owner=code == "owner"
            )
            for code in CODES
        }
        for code, u in users.items():
            UserBranchAccess.unscoped.create(tenant=a, user=u, branch=branch, role=roles[code])
    with tenant_context(a.id):
        regs = {
            code: register_device(user=u, branch=branch, name=f"جهاز {code}")
            for code, u in users.items()
        }
    return {
        "tenant": a,
        "branch": branch,
        "other": other,
        "roles": roles,
        "users": users,
        "regs": regs,
    }


def _h(ctx: dict[str, Any], code: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {ctx['regs'][code].access}"}


def _set(ctx: dict[str, Any], role: str, key: str, value: str, limit: int | None = None) -> None:
    """يغيّر الخلية من مسار المالك نفسه (PUT /api/org/roles) — لا من قاعدة البيانات مباشرة."""
    change: dict[str, Any] = {"role_id": str(ctx["roles"][role].id), "key": key, "value": value}
    if limit is not None:
        change.update(limit_minor=str(limit), period="per_op")
    r = Client().put(
        "/api/org/roles",
        {"changes": [change]},
        content_type="application/json",
        headers=_h(ctx, "owner"),
    )
    assert r.status_code == 200, r.content


def _viewer(ctx: dict[str, Any], code: str) -> home.Viewer:
    return home.viewer_for(ctx["users"][code], ctx["regs"][code].device)


# ------------------------------------------------------------------ النواة


def test_device_defaults_mirror_seeded_matrix() -> None:
    """`DEFAULT_ROLE_RULES` في sync-core (للسياق المخزَّن القديم) = افتراض `org.PERMISSIONS`."""
    import re
    from pathlib import Path

    src = (
        Path(__file__).resolve().parents[3] / "packages/sync-core/src/permissions.ts"
    ).read_text()
    body = src.split("DEFAULT_ROLE_RULES", 1)[1].split("};\n", 1)[0]
    for role in ("manager", "cashier", "storekeeper"):
        block = body.split(f"  {role}: {{", 1)[1].split("},", 1)[0]
        seen: dict[str, org.Cell] = {}
        for key, expr in re.findall(r"(\w+): ([^,\n]+),", block):
            if expr == "y()":
                seen[key] = org.Cell("yes")
            elif expr == "n()":
                seen[key] = org.Cell("no")
            elif m := re.fullmatch(r'c\("(\w+)"\)', expr):
                seen[key] = org.Cell(m.group(1))
            elif m := re.fullmatch(r"lim\((\d+)\)", expr):
                seen[key] = org.Cell("limit", int(m.group(1)), "per_op")
        assert seen == {p.key: p.defaults[role] for p in org.PERMISSIONS}, role


def test_decide_cell_values() -> None:
    b1, b2 = uuid.uuid4(), uuid.uuid4()
    d = permissions.decide_cell
    assert d("sell", org.Cell("yes")).unrestricted
    assert d("discount", org.Cell("unlimited"), amount_minor=10**12).allowed
    assert d("sell", org.Cell("no")).reason == "role_forbidden"
    lim = org.Cell("limit", 50_000, "per_op")
    assert d("refund", lim, amount_minor=50_000).allowed
    over = d("refund", lim, amount_minor=50_001)
    assert not over and over.reason == "over_limit" and over.limit_minor == 50_000
    assert d("close_short", lim, branch_id=b2, own_branch_id=b1).reason == "other_branch"
    assert d("stock_adjust", org.Cell("branch"), branch_id=b1, own_branch_id=b1).allowed
    assert d("stock_adjust", org.Cell("branch"), branch_id=b2, own_branch_id=b1).reason == (
        "other_branch"
    )
    assert d("record_payment", org.Cell("cash_only"), method="cash").allowed
    assert d("record_payment", org.Cell("cash_only"), method="bank").reason == "cash_only"
    assert not d("record_payment", org.Cell("cash_only")).unrestricted
    assert d("view_receivables", org.Cell("own_customer")).reason == "own_customer_only"
    assert d("stock_adjust", org.Cell("propose")).reason == "propose_only"


def test_owner_always_allowed(ctx: dict[str, Any]) -> None:
    with tenant_context(ctx["tenant"].id):
        v = _viewer(ctx, "owner")
        for spec in org.PERMISSIONS:
            assert permissions.can(v, spec.key, 10**12, branch_id=ctx["other"].id).unrestricted
        assert all(
            c["value"] in ("yes", "unlimited") for c in permissions.rules_payload(v).values()
        )


def test_defaults_keep_seeded_cells_and_reach_device(ctx: dict[str, Any]) -> None:
    """الافتراض المبذور هو ما يصل الجهاز مع سياق الوردية والرئيسية."""
    c = Client()
    body = c.get("/api/shifts/current", headers=_h(ctx, "cashier")).json()
    perms = body["permissions"]
    assert [*perms] == [p.key for p in org.PERMISSIONS]
    assert perms["refund"] == {"value": "limit", "limit_minor": "50000", "period": "per_op"}
    assert perms["record_payment"]["value"] == "cash_only"
    home_body = c.get("/api/home", headers=_h(ctx, "cashier")).json()
    assert home_body["permissions"] == perms
    assert home_body["quick_actions"] == ["sale", "payment", "return"]
    assert c.get("/api/home", headers=_h(ctx, "storekeeper")).json()["quick_actions"] == []


# ------------------------------------------------------------------ الصفوف الثلاثة عشر


def test_sell_row(ctx: dict[str, Any]) -> None:
    c = Client()
    _set(ctx, "storekeeper", "sell", "yes")
    assert c.get("/api/home", headers=_h(ctx, "storekeeper")).json()["quick_actions"] == ["sale"]
    _set(ctx, "cashier", "sell", "no")
    body = c.get("/api/home", headers=_h(ctx, "cashier")).json()
    assert "sale" not in body["quick_actions"]
    assert (
        c.get("/api/shifts/current", headers=_h(ctx, "cashier")).json()["permissions"]["sell"][
            "value"
        ]
        == "no"
    )
    with tenant_context(ctx["tenant"].id):
        assert not permissions.can_in_branch(ctx["users"]["cashier"], ctx["branch"].id, "sell")
        assert permissions.can_in_branch(ctx["users"]["owner"], ctx["branch"].id, "sell")


def test_discount_row_no_means_zero(ctx: dict[str, Any]) -> None:
    from sales.services import _exceeds_discount_cap, caps_for

    c = Client()
    _set(ctx, "cashier", "discount", "no")
    caps = c.get("/api/shifts/current", headers=_h(ctx, "cashier")).json()["discount_caps"]
    assert caps["forbidden"] is True
    with tenant_context(ctx["tenant"].id):
        assert caps_for("cashier", False).forbidden
        cashier = ctx["users"]["cashier"]
        # أي خصم — ولو قرشاً — يُوسم «فوق السقف» في الخادم
        assert _exceeds_discount_cap(cashier, cashier, ctx["branch"].id, 1, 100_000)
        assert not _exceeds_discount_cap(cashier, cashier, ctx["branch"].id, 0, 100_000)
        assert not caps_for("owner", True).forbidden
    _set(ctx, "cashier", "discount", "limit", 0)
    with tenant_context(ctx["tenant"].id):
        assert caps_for("cashier", False).forbidden  # حدّ صفر = لا خصم، لا «بلا حد»
    _set(ctx, "cashier", "discount", "limit", 2_500)
    with tenant_context(ctx["tenant"].id):
        caps2 = caps_for("cashier", False)
        assert not caps2.forbidden and caps2.per_op_minor == 2_500


def test_refund_row(ctx: dict[str, Any]) -> None:
    with tenant_context(ctx["tenant"].id):
        cashier, branch = ctx["users"]["cashier"], ctx["branch"].id
        assert permissions.can_in_branch(cashier, branch, "refund", 50_000)
        assert permissions.can_in_branch(cashier, branch, "refund", 50_001).reason == "over_limit"
    _set(ctx, "cashier", "refund", "limit", 100_000)
    with tenant_context(ctx["tenant"].id):
        assert permissions.can_in_branch(cashier, branch, "refund", 50_001)
    _set(ctx, "cashier", "refund", "no")
    body = Client().get("/api/home", headers=_h(ctx, "cashier")).json()
    assert "return" not in body["quick_actions"] and body["permissions"]["refund"]["value"] == "no"


def test_record_payment_row(ctx: dict[str, Any]) -> None:
    with tenant_context(ctx["tenant"].id):
        cashier, branch = ctx["users"]["cashier"], ctx["branch"].id
        assert permissions.can_in_branch(cashier, branch, "record_payment", method="cash")
        assert not permissions.can_in_branch(cashier, branch, "record_payment", method="bank")
    _set(ctx, "cashier", "record_payment", "yes")
    with tenant_context(ctx["tenant"].id):
        d = permissions.can_in_branch(cashier, branch, "record_payment", method="bank")
        assert d.unrestricted
    _set(ctx, "cashier", "record_payment", "no")
    assert (
        "payment"
        not in Client().get("/api/home", headers=_h(ctx, "cashier")).json()["quick_actions"]
    )


def test_view_receivables_row(ctx: dict[str, Any]) -> None:
    c = Client()
    r = c.get("/api/reports/receivables", headers=_h(ctx, "manager"))
    assert r.status_code == 200 and r.json()["scope"] == "branch"  # «فرعه»
    r = c.get("/api/parties/list", headers=_h(ctx, "manager"))
    assert r.status_code == 200 and r.json()["scope"] == "branch"
    _set(ctx, "manager", "view_receivables", "yes")
    assert c.get("/api/reports/receivables", headers=_h(ctx, "manager")).json()["scope"] == "all"
    _set(ctx, "manager", "view_receivables", "no")
    r = c.get("/api/reports/receivables", headers=_h(ctx, "manager"))
    assert r.status_code == 403 and r.json()["detail"] == "permission_denied"
    assert r.json()["permission"] == "view_receivables"
    # الكاشير «عميل البيع فقط»: لا قائمة ولا تقرير — حتى تُفتح له الخلية
    assert c.get("/api/parties/list", headers=_h(ctx, "cashier")).status_code == 403
    _set(ctx, "cashier", "view_receivables", "yes")
    r = c.get("/api/parties/list", headers=_h(ctx, "cashier"))
    assert r.status_code == 200 and r.json()["scope"] == "all"


def test_close_short_row(ctx: dict[str, Any]) -> None:
    from shifts.views import settle_decision

    c = Client()
    branch = ctx["branch"].id
    with tenant_context(ctx["tenant"].id):
        cashier, manager = _viewer(ctx, "cashier"), _viewer(ctx, "manager")
        assert settle_decision(cashier, -5_000, branch)  # عجز 50.00 = حدّ الكاشير
        assert settle_decision(cashier, -5_001, branch).reason == "over_limit"
        assert settle_decision(cashier, 9_999, branch)  # الزيادة ليست عجزاً
        assert settle_decision(cashier, None, branch).reason == "over_limit"  # بلا عدّ
        assert settle_decision(manager, -30_000, ctx["other"].id).reason == "other_branch"
        assert settle_decision(_viewer(ctx, "owner"), -(10**9), ctx["other"].id)
    assert c.get("/api/shifts/review", headers=_h(ctx, "cashier")).json()["can_settle"] is True
    _set(ctx, "cashier", "close_short", "no")
    assert c.get("/api/shifts/review", headers=_h(ctx, "cashier")).json()["can_settle"] is False
    _set(ctx, "manager", "close_short", "unlimited")
    with tenant_context(ctx["tenant"].id):
        assert settle_decision(_viewer(ctx, "manager"), -(10**9), branch)


def test_stock_adjust_row(ctx: dict[str, Any]) -> None:
    from inventory.views import _can_adjust

    c = Client()
    with tenant_context(ctx["tenant"].id):
        mgr, sk = _viewer(ctx, "manager"), _viewer(ctx, "storekeeper")
        assert _can_adjust(mgr, ctx["branch"].id) and not _can_adjust(mgr, ctx["other"].id)
        assert not _can_adjust(sk, ctx["branch"].id)  # «اقتراح فقط»
    r = c.get("/api/inventory/openings", headers=_h(ctx, "manager"))
    assert r.status_code == 200 and r.json()["can_approve"] is True
    _set(ctx, "manager", "stock_adjust", "no")
    assert c.get("/api/inventory/openings", headers=_h(ctx, "manager")).json()["can_approve"] is (
        False
    )
    _set(ctx, "storekeeper", "stock_adjust", "yes")
    with tenant_context(ctx["tenant"].id):
        assert _can_adjust(_viewer(ctx, "storekeeper"), ctx["other"].id)


def test_campaign_purchase_market_rows(ctx: dict[str, Any]) -> None:
    from core import campaigns
    from inventory import purchase_docs
    from market import offers, orders

    with tenant_context(ctx["tenant"].id):
        mgr = _viewer(ctx, "manager")
        assert campaigns.can_create(mgr) and not campaigns.can_approve(mgr)
        assert purchase_docs.approval_limit(mgr) == 300_000 == orders.order_limit(mgr)
        assert not offers.can_publish(mgr)
    _set(ctx, "manager", "campaign_create", "no")
    _set(ctx, "manager", "campaign_approve", "yes")
    _set(ctx, "manager", "purchase_approve", "no")
    _set(ctx, "manager", "market_publish", "yes")
    with tenant_context(ctx["tenant"].id):
        mgr = _viewer(ctx, "manager")
        assert not campaigns.can_create(mgr) and campaigns.can_approve(mgr)
        assert purchase_docs.approval_limit(mgr) == 0 == orders.order_limit(mgr)
        assert offers.can_publish(mgr)
        assert purchase_docs.approval_limit(_viewer(ctx, "owner")) is None


def test_cost_margin_view_row_drives_margin_report(ctx: dict[str, Any]) -> None:
    """O-11: تقرير الهامش يتبع الخلية نفسها التي تتبعها شاشة التكلفة PUR-05."""
    c = Client()
    r = c.get("/api/reports/margin", headers=_h(ctx, "manager"))
    assert r.status_code == 200 and r.json()["scope"] == "branch"
    assert c.get("/api/reports/margin", headers=_h(ctx, "cashier")).status_code == 403
    _set(ctx, "manager", "cost_margin_view", "no")
    r = c.get("/api/reports/margin", headers=_h(ctx, "manager"))
    assert r.status_code == 403 and r.json()["permission"] == "cost_margin_view"
    _set(ctx, "cashier", "cost_margin_view", "yes")
    assert c.get("/api/reports/margin", headers=_h(ctx, "cashier")).status_code == 200


def test_conflict_review_row(ctx: dict[str, Any]) -> None:
    c = Client()
    assert c.get("/api/sync/quarantine", headers=_h(ctx, "manager")).json()["can_review"] is False
    assert c.get("/api/sync/quarantine", headers=_h(ctx, "owner")).json()["can_review"] is True
    _set(ctx, "manager", "conflict_review", "yes")
    assert c.get("/api/sync/quarantine", headers=_h(ctx, "manager")).json()["can_review"] is True
    with tenant_context(ctx["tenant"].id):
        assert (
            home.home_summary(ctx["tenant"].id, _viewer(ctx, "manager"))["permissions"][
                "conflict_review"
            ]["value"]
            == "yes"
        )

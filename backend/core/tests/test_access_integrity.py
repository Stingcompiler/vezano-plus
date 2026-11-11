"""مراجعة 2026-11-05 (البنود ٦ و٨ و٩): الدور من فرع الجهاز، والرصيد في البحث لمن يرى المال،
ورمز مشترك البوابة لا يُسلَّم لمن اشترك برقمه من متصفح آخر."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import Client

from core import home
from core.auth.devices import register_device
from core.models import UserBranchAccess
from core.tenancy import platform_context, tenant_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from sync.counter import ensure_state

pytestmark = pytest.mark.django_db(transaction=True)


def test_role_follows_the_device_branch(ctx: dict[str, Any], two_tenants: Any) -> None:  # noqa: F811
    """مدير في الفرع الأول وكاشير في الثاني: على جهاز الثاني كاشير، وعلى جهاز الأول مدير."""
    manager = ctx["users"]["manager"]
    second = two_tenants.a_branches[1]
    with platform_context():
        UserBranchAccess.unscoped.create(
            tenant=ctx["tenant"], user=manager, branch=second, role=ctx["roles"]["cashier"]
        )
    with tenant_context(ctx["tenant"].id):
        dev2 = register_device(user=manager, branch=second, name="جهاز الفرع الثاني").device
        assert home.viewer_for(manager, dev2).role_code == "cashier"
        dev1 = register_device(user=manager, branch=ctx["branch"], name="جهاز الفرع الأول").device
        assert home.viewer_for(manager, dev1).role_code == "manager"


def test_party_search_hides_balance_from_cashier(ctx: dict[str, Any]) -> None:  # noqa: F811
    c, ho, hc = Client(), _h(ctx["tokens"]["owner"]), _h(ctx["tokens"]["cashier"])
    with tenant_context(ctx["tenant"].id):
        ensure_state(ctx["tenant"].id)
    r = _post(c, ho, "/api/parties", {"name": "خالد العوض"})
    pid = r.json()["id"]
    r = _post(
        c,
        ho,
        f"/api/parties/{pid}/opening-balance",
        {"side": "customer_due", "amount_minor": "123456", "reason": "دفتر 2024"},
    )
    assert r.status_code in (200, 201)
    assert c.get(f"/api/parties/{pid}/statement", headers=hc).status_code == 403
    rows = c.get("/api/parties", {"q": "خالد"}, headers=hc).json()["parties"]
    assert [p["id"] for p in rows] == [pid] and rows[0]["balance_minor"] == ""
    rows = c.get("/api/parties", {"q": "خالد"}, headers=ho).json()["parties"]
    assert rows[0]["balance_minor"] == "123456"


def test_portal_resubscribe_does_not_hand_out_the_token(ctx: dict[str, Any]) -> None:  # noqa: F811
    slug = Client().get("/api/org/portal", headers=_h(ctx["tokens"]["owner"])).json()["slug"]

    def subscribe(body: dict[str, Any]) -> Any:
        return Client().post(f"/api/portal/{slug}/subscribe", body, content_type="application/json")

    first = subscribe({"phone": "0912000555", "push_permission": "denied"})
    assert first.status_code == 201
    token = first.json()["subscriber"]["token"]
    assert token

    # متصفح آخر بالرقم نفسه: «اشتركتَ» بلا رمز، ولا يفتح رسائل المشترك
    other = subscribe({"phone": "0912000555", "push_permission": "granted"})
    assert other.status_code == 201 and other.json()["subscriber"]["token"] == ""
    assert Client().get(f"/api/portal/{slug}/messages?t=").status_code == 404

    # المتصفح نفسه بالرمز الذي يحمله: إعادة الاشتراك والرمز نفسه
    again = subscribe({"phone": "0912000555", "token": token})
    assert again.status_code == 201 and again.json()["subscriber"]["token"] == token
    assert Client().get(f"/api/portal/{slug}/messages?t={token}").status_code == 200


def test_party_card_hides_opening_balances_from_cashier(ctx: dict[str, Any]) -> None:  # noqa: F811
    """مراجعة 2026-11-10 (ع-٧): البطاقة كانت تحجب الرصيد وتعيد مبلغ الرصيد الافتتاحي نفسه."""
    c, ho, hc = Client(), _h(ctx["tokens"]["owner"]), _h(ctx["tokens"]["cashier"])
    with tenant_context(ctx["tenant"].id):
        ensure_state(ctx["tenant"].id)
    pid = _post(c, ho, "/api/parties", {"name": "خالد العوض"}).json()["id"]
    _post(
        c,
        ho,
        f"/api/parties/{pid}/opening-balance",
        {"side": "customer_due", "amount_minor": "123456", "reason": "دفتر 2024"},
    )
    seen = c.get(f"/api/parties/{pid}", headers=hc)
    assert seen.status_code == 200
    assert seen.json()["opening_balances"] == [] and b"123456" not in seen.content
    full = c.get(f"/api/parties/{pid}", headers=ho).json()
    assert [ob["amount_minor"] for ob in full["opening_balances"]] == ["123456"]


def test_catalog_balances_are_limited_to_the_viewer_branch(
    ctx: dict[str, Any],  # noqa: F811
    two_tenants: Any,
) -> None:
    """مراجعة 2026-11-10 (ع-٨): `/api/inventory/balances` يرفض فرعاً آخر، وهذا المسار كان يعيده."""
    c, ho, hc = Client(), _h(ctx["tokens"]["owner"]), _h(ctx["tokens"]["cashier"])
    other = two_tenants.a_branches[1]
    r = c.get(f"/api/catalog/balances?branch_id={other.id}", headers=hc)
    assert r.status_code == 403 and r.json()["detail"] == "branch_forbidden"
    assert c.get("/api/catalog/balances", headers=hc).status_code == 200
    own = c.get(f"/api/catalog/balances?branch_id={ctx['branch'].id}", headers=hc)
    assert own.status_code == 200
    # المالك يرى كل الفروع
    assert c.get(f"/api/catalog/balances?branch_id={other.id}", headers=ho).status_code == 200

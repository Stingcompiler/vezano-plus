"""مراجعة 2026-11-05 (البندان ٤–٥): مطابقة الدفعة الواحدة أثرها مرة واحدة ولو تزامن طلبان، وقبول
نسخة المورد توقيع على مبلغ يخضع لصلاحية الشراء وحدّها."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from conftest import TwoTenants
from core.tenancy import platform_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from market.models import MarketOrder, MarketPayment
from market.tests.test_order_flow import _owner_headers
from market.tests.test_orders import _seed

pytestmark = pytest.mark.django_db(transaction=True)

PRICE = 118000


def _quoted_order(
    c: Client, h: dict[str, str], hb: dict[str, str], two_tenants: TwoTenants
) -> tuple[str, str]:
    sugar, _rice = _seed(two_tenants.b)
    lines = [{"offer_id": str(sugar.id), "qty": 10, "price_minor": str(PRICE)}]
    oid = _post(
        c,
        h,
        "/api/market/orders",
        {
            "op_id": str(uuid.uuid4()),
            "supplier_tenant_id": str(two_tenants.b.id),
            "kind": "order",
            "lines": lines,
        },
    ).json()["order"]["id"]
    _post(
        c,
        hb,
        f"/api/market/orders/{oid}/quote",
        {
            "lines": [{"offer_id": str(sugar.id), "qty_confirmed": 10, "price_minor": str(PRICE)}],
            "valid_until": (timezone.localdate() + timedelta(days=3)).isoformat(),
            "send": True,
        },
    )
    return oid, str(sugar.id)


def test_cashier_cannot_accept_the_supplier_version(
    ctx: dict[str, Any],  # noqa: F811
    two_tenants: TwoTenants,
) -> None:
    c, h = Client(), _h(ctx["tokens"]["owner"])
    hb = _owner_headers(two_tenants.b, "ob-acc")
    oid, _ = _quoted_order(c, h, hb, two_tenants)
    r = _post(c, _h(ctx["tokens"]["cashier"]), f"/api/market/orders/{oid}/accept", {"version": 2})
    assert r.status_code == 403 and r.json()["detail"] == "permission_denied"
    with platform_context():
        o = MarketOrder.unscoped.get(id=oid)
        assert o.agreed_version is None and o.status != MarketOrder.Status.ACCEPTED
    assert _post(c, h, f"/api/market/orders/{oid}/accept", {"version": 2}).status_code == 200
    with platform_context():
        assert MarketOrder.unscoped.get(id=oid).agreed_version == 2


def test_two_matches_of_one_payment_count_once(
    ctx: dict[str, Any],  # noqa: F811
    two_tenants: TwoTenants,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    c, h = Client(), _h(ctx["tokens"]["owner"])
    hb = _owner_headers(two_tenants.b, "ob-pay")
    oid, offer = _quoted_order(c, h, hb, two_tenants)
    _post(c, h, f"/api/market/orders/{oid}/accept", {"version": 2})
    shp = _post(
        c, hb, f"/api/market/orders/{oid}/shipments", {"lines": [{"offer_id": offer, "qty": 8}]}
    ).json()["shipments"][0]["id"]
    _post(
        c,
        h,
        f"/api/market/orders/{oid}/receive",
        {"shipment_id": shp, "lines": [{"offer_id": offer, "qty_received": 8}]},
    )
    pu = f"/api/market/orders/{oid}/payments"
    amount = 8 * PRICE
    pid = _post(c, h, pu, {"amount_minor": str(amount), "transfer_ref": "TRX-RACE"}).json()[
        "created"
    ]["id"]
    with platform_context():
        stale: MarketPayment = MarketPayment.unscoped.get(id=pid)

    assert _post(c, hb, f"{pu}/{pid}/match", {"note": "وصل"}).status_code == 200

    # الطلب الثاني قرأ الدفعة قبل أن يحفظ الأول (السباق الذي أعاده المراجع بحاجز): نسخته «مسجَّلة»
    manager = MarketPayment.unscoped
    real_filter = manager.filter

    class _Stale:
        def first(self) -> MarketPayment:
            return stale

    def stale_lookup(*args: Any, **kwargs: Any) -> Any:
        return _Stale() if "order" in kwargs else real_filter(*args, **kwargs)

    monkeypatch.setattr(manager, "filter", stale_lookup)
    r = _post(c, hb, f"{pu}/{pid}/match", {"note": "وصل"})
    monkeypatch.undo()
    assert r.status_code == 400 and r.json()["detail"] == "already_decided"
    with platform_context():
        assert MarketOrder.unscoped.get(id=oid).paid_minor == amount

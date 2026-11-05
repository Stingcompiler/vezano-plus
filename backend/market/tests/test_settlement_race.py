"""مطابقة دفعة السوق تحت التزامن (مراجعة 2026-10-26 بند 4): مطابقتان متزامنتان للدفعة نفسها تزيدان
المدفوع مرة واحدة والثانية «already_decided»؛ ودفعتان مختلفتان للطلب نفسه تضيفان مجموعهما بالضبط."""

from __future__ import annotations

import threading
import uuid
from datetime import date
from typing import Any

import pytest
from django.db import connection

from conftest import TwoTenants
from core import home
from core.models import User
from core.tenancy import platform_context, tenant_context
from market import settlement
from market.models import MarketOrder, MarketPayment
from market.services import MarketRejected

pytestmark = pytest.mark.django_db(transaction=True)


def _setup(
    two_tenants: TwoTenants, amounts: list[int]
) -> tuple[home.Viewer, MarketOrder, list[MarketPayment]]:
    buyer, supplier = two_tenants.a, two_tenants.b
    with platform_context():
        owner = User.objects.create_user(
            tenant=supplier, username=f"sup-{uuid.uuid4().hex[:6]}", display_name="م", is_owner=True
        )
        order = MarketOrder.unscoped.create(
            tenant=buyer,
            op_id=uuid.uuid4(),
            supplier_tenant_id=supplier.id,
            supplier_name="المورد",
        )
        pays = [
            MarketPayment.unscoped.create(
                tenant=buyer,
                order=order,
                supplier_tenant_id=supplier.id,
                number=i + 1,
                amount_minor=a,
                transfer_ref=f"TRX-{uuid.uuid4().hex[:6]}",
                transferred_on=date(2026, 10, 20),
            )
            for i, a in enumerate(amounts)
        ]
    viewer = home.Viewer(
        user=owner, is_owner=True, role_code="owner", role_name="مالك", branch=None, device=None
    )
    return viewer, order, pays


def _match(
    supplier_id: uuid.UUID,
    viewer: home.Viewer,
    order: MarketOrder,
    pay: MarketPayment,
    out: list[Any],
) -> None:
    try:
        with tenant_context(supplier_id):
            settlement.match_payment(
                actor=viewer.user,
                viewer=viewer,
                order_id=order.id,
                payment_id=pay.id,
                accept=True,
                note="",
            )
        out.append("matched")
    except MarketRejected as e:
        out.append(e.code)
    finally:
        connection.close()


def test_concurrent_match_of_one_payment_counts_once(
    two_tenants: TwoTenants, monkeypatch: pytest.MonkeyPatch
) -> None:
    viewer, order, (pay,) = _setup(two_tenants, [10000])
    inside, release = threading.Event(), threading.Event()
    real_save = MarketPayment.save
    calls = {"n": 0}

    def held_save(self: MarketPayment, *args: Any, **kwargs: Any) -> None:
        # المطابقة الأولى تتوقّف داخل معاملتها بعد فحص الحالة وقبل الالتزام
        calls["n"] += 1
        real_save(self, *args, **kwargs)
        if calls["n"] == 1:
            inside.set()
            release.wait(10)

    monkeypatch.setattr(MarketPayment, "save", held_save)
    results: list[Any] = []
    sid = two_tenants.b.id
    first = threading.Thread(target=_match, args=(sid, viewer, order, pay, results))
    first.start()
    assert inside.wait(10)
    second = threading.Thread(target=_match, args=(sid, viewer, order, pay, results))
    second.start()
    second.join(1.0)  # بلا القفل كانت الثانية تقرأ «مسجَّلة» هنا وتمضي إلى الإضافة
    release.set()
    first.join(10)
    second.join(10)
    assert sorted(results) == ["already_decided", "matched"]
    with platform_context():
        assert MarketOrder.unscoped.get(id=order.id).paid_minor == 10000


def test_two_payments_on_one_order_add_exactly(two_tenants: TwoTenants) -> None:
    viewer, order, pays = _setup(two_tenants, [10000, 2500])
    results: list[Any] = []
    threads = [
        threading.Thread(target=_match, args=(two_tenants.b.id, viewer, order, p, results))
        for p in pays
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert results == ["matched", "matched"]
    with platform_context():
        assert MarketOrder.unscoped.get(id=order.id).paid_minor == 12500

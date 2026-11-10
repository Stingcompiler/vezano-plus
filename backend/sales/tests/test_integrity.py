"""مراجعة 2026-11-05 (البنود ١–٣): طلبات مُعدّة لا تمسّ مالاً معتمداً.

١ مرتجع بسعر أعلى من سطر البيع يُحجر ولا يدخل الصندوق.
٢ عملية جديدة تحمل هوية بيع معتمد في حمولتها تُرفض، فلا تتغيّر سطوره ولا دفعاته.
٣ خصم فوق سقف دور البائع يُقبل دون اتصال (§٧.٤) ويُوسم للمراجعة."""

from __future__ import annotations

from typing import Any

import pytest

from catalog import services as catalog_services
from core.models import User
from core.tenancy import tenant_context
from sales.models import Payment, Sale, SaleLine, SaleReturn
from sales.tests.test_duplicates import ctx as ctx_fixture
from sales.tests.test_returns import return_op
from sales.tests.test_sale import ITEM, do_push, sale_op

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.usefixtures("pinned_clock")]
ctx = ctx_fixture


def _members(op: dict[str, Any], entity: str) -> list[dict[str, Any]]:
    return [m for m in op["members"] if m["entity"] == entity]


def test_return_priced_above_the_sale_line_is_quarantined(ctx: dict[str, Any]) -> None:
    assert do_push(ctx, sale_op(ctx, invoice="INV-1")) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        sale = Sale.objects.get(invoice_number="INV-1")
    op = return_op(ctx, sale, qty="1000")
    head = _members(op, "sales.SaleReturn")[0]["payload"]
    line = _members(op, "sales.SaleReturnLine")[0]["payload"]
    line.update(unit_price_minor="90000", line_total_minor="90000")
    head["total_minor"] = "90000"
    assert do_push(ctx, op) == ["conflicted"]
    with tenant_context(ctx["tenant"].id):
        assert not SaleReturn.objects.exists()


def test_return_at_the_sale_price_is_accepted_and_not_flagged(ctx: dict[str, Any]) -> None:
    assert do_push(ctx, sale_op(ctx, invoice="INV-1", qty="2000")) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        sale = Sale.objects.get(invoice_number="INV-1")
    assert do_push(ctx, return_op(ctx, sale, qty="1000")) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        r = SaleReturn.objects.get()
        assert r.cash_minor == 10000 and r.exceeds_original is False


def test_new_operation_cannot_attach_to_an_accepted_sale(ctx: dict[str, Any]) -> None:
    first = sale_op(ctx, invoice="INV-1")
    assert do_push(ctx, first) == ["accepted"]
    old_id = _members(first, "sales.Sale")[0]["id"]

    # بيع جديد بهوية عضو جديدة، وحمولته وسطوره ودفعاته تحمل هوية البيع القديم
    forged = sale_op(ctx, invoice="INV-2")
    for m in forged["members"]:
        if "sale_id" in m["payload"]:
            m["payload"]["sale_id"] = old_id
        if m["payload"].get("source_id"):
            m["payload"]["source_id"] = old_id
    assert do_push(ctx, forged) == ["rejected"]

    # والصيغة الأخرى: هوية العضو نفسها هي هوية البيع القديم
    reused = sale_op(ctx, invoice="INV-3")
    new_id = _members(reused, "sales.Sale")[0]["id"]
    for m in reused["members"]:
        if m["entity"] == "sales.Sale":
            m["id"] = old_id
        if m["payload"].get("sale_id") == new_id:
            m["payload"]["sale_id"] = old_id
        if m["payload"].get("source_id") == new_id:
            m["payload"]["source_id"] = old_id
    assert do_push(ctx, reused) == ["conflicted"]

    with tenant_context(ctx["tenant"].id):
        sale = Sale.objects.get(id=old_id)
        assert sale.total_minor == 10000 and sale.cash_minor == 10000
        assert SaleLine.objects.filter(sale=sale).count() == 1
        assert Payment.objects.filter(sale=sale).count() == 1


def _sold_by(op: dict[str, Any], user: User) -> dict[str, Any]:
    _members(op, "sales.Sale")[0]["payload"]["user_id"] = str(user.id)
    return op


def test_cashier_discount_over_the_cap_is_accepted_and_flagged(ctx: dict[str, Any]) -> None:
    cashier = ctx["cashier"]
    # سقف الكاشير 1,000 للعملية: خصم 500,000 على بيع 600,000
    over = sale_op(ctx, invoice="INV-1", price="600000", discount=("amount", "500000", "500000"))
    within = sale_op(ctx, invoice="INV-2", price="10000", discount=("amount", "500", "500"))
    assert do_push(ctx, _sold_by(over, cashier), _sold_by(within, cashier)) == [
        "accepted",
        "accepted",
    ]
    with tenant_context(ctx["tenant"].id):
        assert Sale.objects.get(invoice_number="INV-1").exceeds_discount_cap is True
        assert Sale.objects.get(invoice_number="INV-2").exceeds_discount_cap is False


def test_owner_discount_has_no_cap(ctx: dict[str, Any]) -> None:
    op = sale_op(ctx, invoice="INV-1", price="600000", discount=("amount", "500000", "500000"))
    assert do_push(ctx, op) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        assert Sale.objects.get().exceeds_discount_cap is False


# ------------------------------------------------------- مراجعة 2026-11-10 (ع-٦)
def _decide(ctx: dict[str, Any], who: str, item_id: Any, decision: str) -> Any:  # noqa: F811
    from django.test import Client

    return Client().post(
        f"/api/sync/quarantine/{item_id}/decide",
        {"decision": decision, "reason": "راجعتُ الفاتورة مع الكاشير"},
        content_type="application/json",
        headers={"Authorization": f"Bearer {ctx[who]}"},
    )


def _over_return(ctx: dict[str, Any]) -> tuple[Sale, Any]:  # noqa: F811
    """بيع وحدة بـ10,000 ثم مرتجع خمس وحدات بسعر الأصل — طلب المراجعة نفسه."""
    from sync.models import QuarantinedOperation

    assert do_push(ctx, sale_op(ctx, invoice="INV-1", qty="1000")) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        sale = Sale.objects.get(invoice_number="INV-1")
    assert do_push(ctx, return_op(ctx, sale, qty="5000")) == ["conflicted"]
    with tenant_context(ctx["tenant"].id):
        assert not SaleReturn.objects.exists()
        held = QuarantinedOperation.objects.get(code="return_exceeds_sale")
        # لا نقد خرج ولا مخزون دخل: رصيد الصنف بيع الوحدة وحده
        assert catalog_services.branch_balances(ctx["branch"].id) == {ITEM: "-1000"}
    return sale, held.id


def test_return_exceeding_the_sale_quantity_waits_for_the_owner(ctx: dict[str, Any]) -> None:
    """كان يُقبل ويُخرج 50,000 نقداً ويُدخل خمس وحدات موسوماً — الآن يُحجر، والكاشير لا يحسمه."""
    _sale, item_id = _over_return(ctx)
    assert _decide(ctx, "access2", item_id, "accept").status_code == 403
    r = _decide(ctx, "access", item_id, "reject")
    assert r.status_code == 200 and r.json()["item"]["decision"] == "reject"
    with tenant_context(ctx["tenant"].id):
        assert not SaleReturn.objects.exists()
        assert catalog_services.branch_balances(ctx["branch"].id) == {ITEM: "-1000"}


def test_owner_accepting_an_exceeding_return_applies_it_flagged(ctx: dict[str, Any]) -> None:
    """النقد خرج فعلاً عند الجهاز: قبول المالك يحفظ الواقعة بآثارها موسومة، مرة واحدة."""
    _sale, item_id = _over_return(ctx)
    r = _decide(ctx, "access", item_id, "accept")
    assert r.status_code == 200, r.content
    with tenant_context(ctx["tenant"].id):
        ret = SaleReturn.objects.get()
        assert ret.cash_minor == 50000 and ret.exceeds_original is True
        assert catalog_services.branch_balances(ctx["branch"].id) == {ITEM: "4000"}
    again = _decide(ctx, "access", item_id, "accept")
    assert again.status_code == 400 and again.json()["detail"] == "already_decided"
    with tenant_context(ctx["tenant"].id):
        assert SaleReturn.objects.count() == 1

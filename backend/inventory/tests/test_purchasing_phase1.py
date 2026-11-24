"""المرحلة ١ من مراجعة المشتريات والمخزون (0005 §٢٨٩): إيقاف الأرقام الخاطئة.

- I-01: فتح أمر مستلَم كاملاً لا يولّد مستنداً ثانياً، والملغى لا مستند له، والمستند الثاني للأمر
  المستلَم جزئياً يقترح الباقي وحده.
- I-02 (د-١): الاستلام وحده يُدخل المخزون. مستند الشراء لمورد له استلام قائم بالأصناف نفسها لا
  يُعتمد حتى يُربط به أو يُقال إنه شحنة أخرى؛ المربوط كمياته من الاستلام، واعتماده يرفع الذمّة بلا
  حركة مخزون، وسعره يصل إلى التكلفة بدل تقدير المستلِم.
- I-05: سطر مستلَم بسعر صفر لا يُعتمد إلا «هدية من المورد».
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from django.test import Client

from catalog import services as catalog_services
from core.tenancy import tenant_context
from inventory.models import PurchaseDocument, StockMovement
from inventory.tests.test_inventory import _api, _now_iso, _receipt_op, ctx  # noqa: F401
from parties import services as party_services
from sales.tests.test_sale import do_push

pytestmark = pytest.mark.django_db(transaction=True)


def _post(c: Client, h: dict[str, str], path: str, body: dict[str, Any]) -> Any:
    return c.post(path, body, content_type="application/json", **h)  # type: ignore[arg-type]


def _patch(c: Client, h: dict[str, str], path: str, body: dict[str, Any]) -> Any:
    return c.patch(path, body, content_type="application/json", **h)  # type: ignore[arg-type]


def _supplier(c0: dict[str, Any], name: str = "مطاحن سيقا — وكيل") -> Any:
    with tenant_context(c0["tenant"].id):
        p = party_services.create_party(
            party_id=None, name=name, phone="0912", created_by=c0["owner"], distinct_from=None
        )
        p.is_supplier = True
        p.save(update_fields=["is_supplier"])
    return p


def _order(c: Client, h: dict[str, str], supplier: Any, item: str, cartons: int) -> str:
    r = _post(
        c,
        h,
        "/api/inventory/purchasing/orders",
        {
            "supplier_id": str(supplier.id),
            "confirmed": True,
            "lines": [{"item_id": item, "unit_code": "carton", "qty_milli": str(cartons * 1000)}],
        },
    )
    assert r.status_code == 201, r.content
    return str(r.json()["order"]["id"])


def _draft(c: Client, h: dict[str, str], order_id: str) -> Any:
    return _post(c, h, f"/api/inventory/purchasing/orders/{order_id}/document", {})


def _receipt(c0: dict[str, Any], supplier: Any, item: str, cartons: int, cost: str = "") -> str:
    op = _receipt_op(c0, item, qty=str(cartons * 1000), factor="12000", cost=cost, when=_now_iso())
    op["members"][0]["payload"]["party_id"] = str(supplier.id)
    op["members"][0]["payload"]["supplier_name"] = supplier.name
    assert do_push(c0, op) == ["accepted"]
    return str(op["members"][0]["id"])


def _balance(c0: dict[str, Any], item: str) -> str:
    with tenant_context(c0["tenant"].id):
        return str(catalog_services.branch_balances(c0["branch"].id).get(item, "0"))


def test_received_order_cancelled_order_remaining_and_zero_price(ctx: dict[str, Any]) -> None:  # noqa: F811
    sugar = str(ctx["sugar"].id)
    supplier = _supplier(ctx)
    c, h = _api(ctx)
    # أمر بلا سعر معروف: المسوّدة بسعر صفر — والصفر لا يُعتمد (I-05)
    order_id = _order(c, h, supplier, sugar, 10)
    d = _draft(c, h, order_id).json()["document"]
    assert d["lines"][0]["unit_price_minor"] == "0" and d["lines"][0]["is_gift"] is False
    assert [b["code"] for b in d["blockers"]] == ["invoice_number_required", "price_required"]
    line = d["lines"][0]["id"]
    r = _post(
        c,
        h,
        f"/api/inventory/purchasing/documents/{d['id']}/approve",
        {"supplier_invoice_number": "SG-1", "lines": [{"id": line, "received_qty_milli": "4000"}]},
    )
    assert r.status_code == 400 and r.json()["detail"] == "blocked"
    assert [b["code"] for b in r.json()["extra"]["blockers"]] == ["price_required"]
    # بسعر: وصل 4 من 10 → الأمر مستلَم جزئياً
    r = _post(
        c,
        h,
        f"/api/inventory/purchasing/documents/{d['id']}/approve",
        {"lines": [{"id": line, "unit_price_minor": "90000"}]},
    )
    assert r.status_code == 200, r.content
    assert r.json()["document"]["effects"]["stock"][0]["qty_milli"] == "4000"
    o = c.get(f"/api/inventory/purchasing/orders/{order_id}", **h).json()["order"]  # type: ignore[arg-type]
    assert o["status"] == "partial"
    # المستند الثاني يقترح الباقي (6 كراتين) لا الأمر كله (I-01)
    d2 = _draft(c, h, order_id).json()["document"]
    assert d2["id"] != d["id"] and d2["number"] == "2"
    (ln,) = d2["lines"]
    assert ln["ordered_qty_milli"] == "6000" and ln["received_qty_milli"] == "6000"
    # «هدية من المورد — بلا سعر»: الصفر مقصود فيُعتمد، والسعر يُفرض صفراً
    r = _patch(
        c,
        h,
        f"/api/inventory/purchasing/documents/{d2['id']}",
        {
            "supplier_invoice_number": "SG-2",
            "lines": [{"id": ln["id"], "unit_price_minor": "5000", "is_gift": True}],
        },
    )
    d2 = r.json()["document"]
    assert d2["lines"][0]["is_gift"] is True and d2["lines"][0]["unit_price_minor"] == "0"
    assert d2["blockers"] == [] and d2["total_minor"] == "0"
    r = _post(c, h, f"/api/inventory/purchasing/documents/{d2['id']}/approve", {})
    assert r.status_code == 200, r.content
    assert _balance(ctx, sugar) == "120000"  # 10 كراتين × 12
    o = c.get(f"/api/inventory/purchasing/orders/{order_id}", **h).json()["order"]  # type: ignore[arg-type]
    assert o["status"] == "received"
    # فتح الأمر المستلَم كاملاً يعيد مستنده المعتمد الأخير — لا مسوّدة ثالثة بسعر صفر
    with tenant_context(ctx["tenant"].id):
        count = PurchaseDocument.objects.count()
    r = _draft(c, h, order_id)
    assert r.status_code == 200 and r.json()["document"]["id"] == d2["id"]
    assert r.json()["document"]["status"] == "approved"
    with tenant_context(ctx["tenant"].id):
        assert PurchaseDocument.objects.count() == count
    # الأمر الملغى لا مستند له
    other = _order(c, h, supplier, sugar, 3)
    r = _post(c, h, f"/api/inventory/purchasing/orders/{other}/cancel", {"reason": "ألغاه المورد"})
    assert r.status_code == 200, r.content
    r = _draft(c, h, other)
    assert r.status_code == 400 and r.json()["detail"] == "order_cancelled"


def test_document_linked_to_existing_receipt_adds_debt_not_stock(ctx: dict[str, Any]) -> None:  # noqa: F811
    from inventory import purchase_docs, purchasing
    from inventory.receipt_costs import costed_receipt_lines

    sugar = str(ctx["sugar"].id)
    supplier = _supplier(ctx)
    c, h = _api(ctx)
    order_id = _order(c, h, supplier, sugar, 10)
    # أمين المخزن استلم 8 كراتين من INV-04 (بتقديره 850.00) — المخزون +96
    rid = _receipt(ctx, supplier, sugar, 8, cost="85000")
    assert _balance(ctx, sugar) == "96000"
    with tenant_context(ctx["tenant"].id):
        moves = StockMovement.objects.count()
    d = _draft(c, h, order_id).json()["document"]
    assert [x["receipt_id"] for x in d["receipt_candidates"]] == [rid]
    assert d["receipt_candidates"][0]["supplier_name"] == "مطاحن سيقا — وكيل"
    assert "receipt_link_required" in {b["code"] for b in d["blockers"]}
    assert d["linked_receipts"] == []
    line = d["lines"][0]["id"]
    # بلا قرار في الاستلام لا اعتماد — ولو اكتمل الرقم والسعر
    r = _post(
        c,
        h,
        f"/api/inventory/purchasing/documents/{d['id']}/approve",
        {"supplier_invoice_number": "SG-9", "lines": [{"id": line, "unit_price_minor": "90000"}]},
    )
    assert r.status_code == 400
    assert [b["code"] for b in r.json()["extra"]["blockers"]] == ["receipt_link_required"]
    # استلام ليس مرشّحاً يُرفض
    r = _post(
        c,
        h,
        f"/api/inventory/purchasing/documents/{d['id']}/receipts",
        {"link": ["01a2031b-7a3c-7a1d-af8e-ed0564dfd080"]},
    )
    assert r.status_code == 400 and r.json()["detail"] == "receipt_not_candidate"
    # «اربط بالاستلام»: الكمية من الاستلام (8 لا 10)، والمرشّح يختفي
    r = _post(c, h, f"/api/inventory/purchasing/documents/{d['id']}/receipts", {"link": [rid]})
    assert r.status_code == 200, r.content
    d = r.json()["document"]
    assert [x["receipt_id"] for x in d["linked_receipts"]] == [rid]
    assert d["receipt_candidates"] == [] and d["blockers"] == []
    assert d["lines"][0]["received_qty_milli"] == "8000" and d["total_minor"] == "720000"
    # الكمية في المستند المربوط لا تُكتب يدوياً
    r = _patch(
        c,
        h,
        f"/api/inventory/purchasing/documents/{d['id']}",
        {"lines": [{"id": line, "received_qty_milli": "10000"}]},
    )
    assert r.json()["document"]["lines"][0]["received_qty_milli"] == "8000"
    r = _post(c, h, f"/api/inventory/purchasing/documents/{d['id']}/approve", {})
    assert r.status_code == 200, r.content
    d = r.json()["document"]
    # الذمّة من المستند، والمخزون لم يتحرّك مرة ثانية
    assert d["effects"]["stock"] == [] and d["effects"]["linked_receipts"] == [
        "RCV-KRT-A2-26-000001"
    ]
    assert d["effects"]["payable_minor"] == "720000"
    assert _balance(ctx, sugar) == "96000"
    with tenant_context(ctx["tenant"].id):
        assert StockMovement.objects.count() == moves
        assert party_services.supplier_owed_minor(supplier) == 720000
        # سعر الفاتورة يصل إلى التكلفة ويحلّ محلّ تقدير المستلِم لنفس الصنف
        assert not costed_receipt_lines().filter(receipt_id=uuid.UUID(rid)).exists()
        assert purchasing.last_purchase_prices([ctx["sugar"].id]) == {
            (ctx["sugar"].id, "carton"): 90000
        }
        assert purchase_docs._weighted_avg_cost([ctx["sugar"].id]) == {
            ctx["sugar"].id: 90000 * 1000 * 1000 // 12000
        }
    # الأمر مستلَم جزئياً (8 من 10)، والمستند التالي بالباقي ولا يعرض الاستلام نفسه ثانيةً
    o = c.get(f"/api/inventory/purchasing/orders/{order_id}", **h).json()["order"]  # type: ignore[arg-type]
    assert o["status"] == "partial"
    d2 = _draft(c, h, order_id).json()["document"]
    assert d2["lines"][0]["ordered_qty_milli"] == "2000" and d2["receipt_candidates"] == []
    # الربط بعد الاعتماد ممنوع
    r = _post(c, h, f"/api/inventory/purchasing/documents/{d['id']}/receipts", {"link": [rid]})
    assert r.status_code == 400 and r.json()["detail"] == "document_locked"


def test_distinct_shipment_and_unrelated_receipts(ctx: dict[str, Any]) -> None:  # noqa: F811
    sugar, tea = str(ctx["sugar"].id), str(ctx["tea"].id)
    supplier = _supplier(ctx)
    other = _supplier(ctx, "شركة النيل للمشروبات")
    c, h = _api(ctx)
    order_id = _order(c, h, supplier, sugar, 5)
    # ليست مرشّحة: مورد آخر، أو صنف ليس في المستند
    _receipt(ctx, other, sugar, 5)
    op = _receipt_op(ctx, tea, qty="5000", factor="1000", when=_now_iso())
    op["members"][0]["payload"]["party_id"] = str(supplier.id)
    assert do_push(ctx, op) == ["accepted"]
    rid = _receipt(ctx, supplier, sugar, 5)
    d = _draft(c, h, order_id).json()["document"]
    assert [x["receipt_id"] for x in d["receipt_candidates"]] == [rid]
    # «شحنتان مختلفتان»: لا يُعرض ثانيةً، والمستند يُدخل مخزونه كما كان (المستند المباشر)
    r = _post(c, h, f"/api/inventory/purchasing/documents/{d['id']}/receipts", {"distinct": [rid]})
    assert r.status_code == 200, r.content
    d = r.json()["document"]
    assert d["receipt_candidates"] == [] and d["linked_receipts"] == []
    assert d["lines"][0]["received_qty_milli"] == "5000"
    before = _balance(ctx, sugar)
    r = _post(
        c,
        h,
        f"/api/inventory/purchasing/documents/{d['id']}/approve",
        {
            "supplier_invoice_number": "SG-3",
            "lines": [{"id": d["lines"][0]["id"], "unit_price_minor": "90000"}],
        },
    )
    assert r.status_code == 200, r.content
    assert r.json()["document"]["effects"]["stock"][0]["qty_milli"] == "5000"
    assert int(_balance(ctx, sugar)) == int(before) + 60000

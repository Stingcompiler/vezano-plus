"""المرحلة ٢ من مراجعة المشتريات والمخزون «إغلاق الدوائر» (0005 §٢٩٥).

- I-02 كاملاً: «حوّل إلى مستند شراء» — يفتح المدير استلام أمين المخزن فيصير مستند شراء مربوطاً به؛
  الاعتماد يرفع الذمّة ويحدّث الأمر بلا حركة مخزون ثانية. الاستلام يقبل أمر شراء مفتوحاً
  (`stock_receipt@2`) فيُربط بمستند ذلك الأمر وحده.
- I-06: الحجر له مخرج — «أعد إلى المتاح» و«أهلك» بحدّ الهالك، و«أرجع للمورد» مرتجع شراء من الحجر.
- I-07: ما رفضه المورد يعود إلى المخزون أو إلى الحجر بفاعل وسبب.
- I-08: «استلم الباقي» يكمل التحويل الجزئي حتى الباقي؛ والمالك يقرّر الفرق «فُقد في الطريق» أو
  «يعود للمرسل»؛ وتنبيه المالك بعد 72 ساعة.
- I-10: «جرد ينتظر التسوية» في الرئيسية.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from django.test import Client

from catalog import services as catalog_services
from conftest import TwoTenants
from core.models import Notification, Role, User, UserBranchAccess
from core.tenancy import platform_context, tenant_context
from inventory.models import (
    DamageRecord,
    PurchaseDocument,
    StockMovement,
    StockTransfer,
)
from inventory.tests.test_inventory import (  # noqa: F401
    _api,
    _cashier,
    _count_op,
    _now_iso,
    _receipt_of_transfer,
    _receipt_op,
    _transfer_op,
    ctx,
)
from inventory.tests.test_purchasing_phase1 import _order, _post, _supplier
from parties import services as party_services
from sales.tests.test_sale import do_push

pytestmark = pytest.mark.django_db(transaction=True)


def _receipt(
    c0: dict[str, Any], supplier: Any, item: str, cartons: int, *, cost: str = "", order: str = ""
) -> str:
    """استلام INV-04 من أمين المخزن — بأمر شراء (الإصدار ٢) أو بلا أمر."""
    op = _receipt_op(c0, item, qty=str(cartons * 1000), factor="12000", cost=cost, when=_now_iso())
    head = op["members"][0]
    head["payload"]["party_id"] = str(supplier.id)
    head["payload"]["supplier_name"] = supplier.name
    if order:
        op["op_version"] = 2
        head["schema_version"] = 2
        head["payload"]["purchase_order_id"] = order
    assert do_push(c0, op) == ["accepted"]
    return str(head["id"])


def _balance(c0: dict[str, Any], item: str, branch: Any = None) -> str:
    with tenant_context(c0["tenant"].id):
        b = branch or c0["branch"]
        return str(catalog_services.branch_balances(b.id).get(item, "0"))


def _quarantine(c0: dict[str, Any], item: Any) -> int:
    from inventory.services import branch_quarantine

    with tenant_context(c0["tenant"].id):
        return branch_quarantine(c0["branch"].id).get(item, 0)


def _role_user(c0: dict[str, Any], code: str, name: str) -> dict[str, str]:
    from core.auth.devices import register_device

    with platform_context():
        role = Role.unscoped.filter(tenant=c0["tenant"], code=code).first() or (
            Role.unscoped.create(tenant=c0["tenant"], code=code, name=name)
        )
        u = User.objects.create_user(
            tenant=c0["tenant"], username=f"{code}-{uuid.uuid4().hex[:6]}", display_name=name
        )
        UserBranchAccess.unscoped.create(
            tenant=c0["tenant"], user=u, branch=c0["branch"], role=role
        )
    with tenant_context(c0["tenant"].id):
        reg = register_device(user=u, branch=c0["branch"], name=f"جهاز {name}")
    return {"HTTP_AUTHORIZATION": f"Bearer {reg.access}"}


def _approve(c: Client, h: dict[str, str], doc: dict[str, Any], price: str, inv: str) -> Any:
    return _post(
        c,
        h,
        f"/api/inventory/purchasing/documents/{doc['id']}/approve",
        {
            "supplier_invoice_number": inv,
            "lines": [
                {"id": ln["id"], "unit_price_minor": price}
                for ln in doc["lines"]
                if ln["received_qty_milli"] != "0"
            ],
        },
    )


# ------------------------------------------------------------------------------------ I-02


def test_receipt_on_order_converts_to_document_without_second_movement(
    ctx: dict[str, Any],  # noqa: F811
) -> None:
    sugar = str(ctx["sugar"].id)
    supplier = _supplier(ctx)
    c, h = _api(ctx)
    order_id = _order(c, h, supplier, sugar, 10)
    # أمين المخزن يستلم 6 كراتين على الأمر (stock_receipt@2) — المخزون +72
    rid = _receipt(ctx, supplier, sugar, 6, order=order_id)
    assert _balance(ctx, sugar) == "72000"
    with tenant_context(ctx["tenant"].id):
        moves = StockMovement.objects.count()
    # القائمة: بلا مستند شراء، وفي الرئيسية «ينتظر مستند الشراء»
    lst = c.get("/api/inventory/receipts", **h).json()  # type: ignore[arg-type]
    assert lst["unpriced_count"] == 1 and lst["can_convert"] is True
    (row,) = lst["receipts"]
    assert row["id"] == rid and row["order_number"] == "1" and row["document"] is None
    assert row["lines"][0]["unit_name"] == "كرتونة" and row["can_convert"] is True
    home = c.get("/api/home", **h).json()  # type: ignore[arg-type]
    card = next(d for d in home["decisions"] if d["id"] == f"receipt-unpriced:{rid}")
    assert card["action"] == "حوّل إلى مستند شراء" and card["href"] == f"/inventory/receipts/{rid}"
    # «حوّل إلى مستند شراء»: مسوّدة الأمر مربوطة بالاستلام، كميتها ما استُلم (6 لا 10)
    r = _post(c, h, f"/api/inventory/receipts/{rid}/document", {})
    assert r.status_code == 200, r.content
    d = r.json()["document"]
    assert d["order_number"] == "1" and [x["receipt_id"] for x in d["linked_receipts"]] == [rid]
    assert d["lines"][0]["received_qty_milli"] == "6000" and d["receipt_candidates"] == []
    # التحويل مرة ثانية يعيد المستند نفسه — لا مستند ثانٍ للشحنة
    again = _post(c, h, f"/api/inventory/receipts/{rid}/document", {}).json()["document"]
    assert again["id"] == d["id"]
    # المدير يضيف السعر ورقم الفاتورة ويعتمد: الذمّة ترتفع، والأمر يُحدَّث، والمخزون لا يتحرّك
    r = _approve(c, h, d, "90000", "SG-21")
    assert r.status_code == 200, r.content
    d = r.json()["document"]
    assert d["status"] == "approved" and d["effects"]["stock"] == []
    assert d["effects"]["payable_minor"] == "540000"
    assert _balance(ctx, sugar) == "72000"
    with tenant_context(ctx["tenant"].id):
        assert StockMovement.objects.count() == moves
        assert party_services.supplier_owed_minor(supplier) == 540000
    o = c.get(f"/api/inventory/purchasing/orders/{order_id}", **h).json()["order"]  # type: ignore[arg-type]
    assert o["status"] == "partial" and o["lines"][0]["received_base_qty_milli"] == "72000"
    # الاستلام صار مسعَّراً: خرج من «بلا مستند» ومن الرئيسية
    rc = c.get(f"/api/inventory/receipts/{rid}", **h).json()["receipt"]  # type: ignore[arg-type]
    assert rc["document"]["number"] == d["number"] and rc["document"]["status"] == "approved"
    assert c.get("/api/inventory/receipts", **h).json()["unpriced_count"] == 0  # type: ignore[arg-type]
    full = c.get("/api/inventory/receipts?scope=all", **h).json()  # type: ignore[arg-type]
    assert [x["id"] for x in full["receipts"]] == [rid]  # استلام المستند `PD-` ليس شحنة
    # استلام على أمر آخر ليس مرشّحاً لمستند هذا الأمر
    other = _order(c, h, supplier, sugar, 2)
    _receipt(ctx, supplier, sugar, 2, order=other)
    d2 = _post(c, h, f"/api/inventory/purchasing/orders/{order_id}/document", {}).json()["document"]
    assert d2["receipt_candidates"] == []


def test_direct_receipt_converts_with_its_supplier_items_and_cost(
    ctx: dict[str, Any],  # noqa: F811
) -> None:
    sugar = str(ctx["sugar"].id)
    supplier = _supplier(ctx)
    c, h = _api(ctx)
    rid = _receipt(ctx, supplier, sugar, 4, cost="88000")
    # أمين المخزن يرى الاستلام بلا تكلفة ولا يحوّل؛ الكاشير لا يرى
    kh = _role_user(ctx, "storekeeper", "ندى")
    seen = c.get(f"/api/inventory/receipts/{rid}", **kh).json()["receipt"]  # type: ignore[arg-type]
    assert seen["can_convert"] is False and seen["lines"][0]["unit_cost_minor"] == ""
    r = _post(c, kh, f"/api/inventory/receipts/{rid}/document", {})
    assert r.status_code == 403
    cc, ch = _cashier(ctx, ctx["branch"])
    assert cc.get("/api/inventory/receipts", **ch).status_code == 403  # type: ignore[arg-type]
    # المدير يحوّل: مستند بلا أمر بمورد الاستلام وصنفه وتكلفته المكتوبة
    r = _post(c, h, f"/api/inventory/receipts/{rid}/document", {})
    assert r.status_code == 200, r.content
    d = r.json()["document"]
    assert d["order_id"] == "" and d["supplier_id"] == str(supplier.id)
    (ln,) = d["lines"]
    assert ln["unit_price_minor"] == "88000" and ln["received_qty_milli"] == "4000"
    assert ln["unit_name"] == "كرتونة" and ln["diff"] == ""
    assert [b["code"] for b in d["blockers"]] == ["invoice_number_required"]
    r = _post(
        c,
        h,
        f"/api/inventory/purchasing/documents/{d['id']}/approve",
        {"supplier_invoice_number": "WH-7"},
    )
    assert r.status_code == 200, r.content
    assert r.json()["document"]["effects"]["stock"] == []
    assert _balance(ctx, sugar) == "48000"
    with tenant_context(ctx["tenant"].id):
        assert party_services.supplier_owed_minor(supplier) == 352000
    # استلام المستند نفسه (`PD-`) لا يُحوَّل
    with tenant_context(ctx["tenant"].id):
        pd = PurchaseDocument.objects.get(id=d["id"]).receipt
    assert pd is not None
    r = _post(c, h, f"/api/inventory/receipts/{pd.id}/document", {})
    assert r.status_code == 404


# ------------------------------------------------------------------------------------ I-06


def _approved_doc(c: Client, h: dict[str, str], c0: dict[str, Any], supplier: Any) -> Any:
    """مستند معتمد بلا استلام (المالك وحده): 5 كراتين سكر بـ900.00."""
    sugar = str(c0["sugar"].id)
    order_id = _order(c, h, supplier, sugar, 5)
    d = _post(c, h, f"/api/inventory/purchasing/orders/{order_id}/document", {}).json()["document"]
    r = _approve(c, h, d, "90000", "SG-5")
    assert r.status_code == 200, r.content
    return r.json()["document"]


def test_quarantine_release_write_off_and_return_to_supplier(ctx: dict[str, Any]) -> None:  # noqa: F811
    sugar = str(ctx["sugar"].id)
    supplier = _supplier(ctx)
    c, h = _api(ctx)
    doc = _approved_doc(c, h, ctx, supplier)
    assert _balance(ctx, sugar) == "60000"
    # 10 كغ تالفة إلى الحجر: المتاح 50
    r = _post(
        c,
        h,
        f"/api/inventory/items/{sugar}/damage",
        {"qty_milli": "10000", "destination": "quarantine", "reason": "أكياس مبلولة"},
    )
    assert r.status_code == 201, r.content
    q = c.get(f"/api/inventory/items/{sugar}/quarantine", **h).json()  # type: ignore[arg-type]
    assert q["quarantine_milli"] == "10000" and q["balance_milli"] == "50000"
    assert [x["id"] for x in q["documents"]] == [doc["id"]] and q["can_release"] is True
    # «أعد إلى المتاح» بسبب: الحجر 7 والمتاح 53
    r = _post(
        c,
        h,
        f"/api/inventory/items/{sugar}/quarantine",
        {"action": "release", "qty_milli": "3000", "reason": "جفّت وسليمة"},
    )
    assert r.status_code == 201, r.content
    assert r.json()["quarantine_milli"] == "7000" and r.json()["balance_milli"] == "53000"
    assert r.json()["damage"]["destination"] == "release"
    rows = c.get(f"/api/inventory/items/{sugar}/movements", **h).json()["rows"]  # type: ignore[arg-type]
    rel = next(x for x in rows if x["reason"] == "release")
    assert rel["label"] == "أعد إلى المتاح" and rel["delta_milli"] == "3000"
    assert "سبب: جفّت وسليمة" in rel["actor"]
    # بلا سبب، أو فوق ما في الحجر — مرفوض
    r = _post(
        c, h, f"/api/inventory/items/{sugar}/quarantine", {"action": "release", "qty_milli": "1000"}
    )
    assert r.status_code == 400 and r.json()["errors"][0]["code"] == "required"
    r = _post(
        c,
        h,
        f"/api/inventory/items/{sugar}/quarantine",
        {"action": "write_off", "qty_milli": "8000", "reason": "x"},
    )
    assert r.status_code == 400 and r.json()["errors"][0]["code"] == "exceeds_quarantine"
    # الكاشير لا يعيد إلى المتاح؛ و«أهلك» فوق الحدّ (500.00 بسعر البيع) للمالك
    cc, ch = _cashier(ctx, ctx["branch"])
    r = _post(
        cc,
        ch,
        f"/api/inventory/items/{sugar}/quarantine",
        {"action": "release", "qty_milli": "1000", "reason": "x"},
    )
    assert r.status_code == 403
    r = _post(
        cc,
        ch,
        f"/api/inventory/items/{sugar}/quarantine",
        {"action": "write_off", "qty_milli": "6000", "reason": "تعفّن"},
    )
    assert r.status_code == 403 and r.json()["detail"] == "owner_required"
    # «أهلك» 2 كغ: الحجر 5، والمتاح لا يتغيّر
    r = _post(
        c,
        h,
        f"/api/inventory/items/{sugar}/quarantine",
        {"action": "write_off", "qty_milli": "2000", "reason": "تعفّن"},
    )
    assert r.status_code == 201 and r.json()["quarantine_milli"] == "5000"
    assert _balance(ctx, sugar) == "53000"
    with tenant_context(ctx["tenant"].id):
        assert DamageRecord.objects.filter(source="quarantine").count() == 2


def test_return_from_quarantine_cannot_exceed_what_is_held(ctx: dict[str, Any]) -> None:  # noqa: F811
    sugar = str(ctx["sugar"].id)
    supplier = _supplier(ctx)
    c, h = _api(ctx)
    doc = _approved_doc(c, h, ctx, supplier)
    _post(
        c,
        h,
        f"/api/inventory/items/{sugar}/damage",
        {"qty_milli": "12000", "destination": "quarantine", "reason": "كرتونة مبلولة"},
    )
    line = doc["lines"][0]["id"]
    body = {
        "document_line_id": line,
        "qty_milli": "2000",
        "reason": "تالف",
        "from_quarantine": True,
    }
    r = _post(c, h, f"/api/inventory/purchasing/documents/{doc['id']}/return", {"lines": [body]})
    assert r.status_code == 400
    err = r.json()["extra"]["errors"][0]
    assert err["code"] == "exceeds_quarantine" and err["max_qty_milli"] == "1000"
    body["qty_milli"] = "1000"
    r = _post(c, h, f"/api/inventory/purchasing/documents/{doc['id']}/return", {"lines": [body]})
    assert r.status_code == 201, r.content
    assert _quarantine(ctx, ctx["sugar"].id) == 0
    assert _balance(ctx, sugar) == "48000"  # 60 − 12 إلى الحجر؛ المرتجع لم يمسّ المتاح


# ------------------------------------------------------------------------------------ I-07


def test_rejected_return_goes_back_to_stock_or_quarantine(ctx: dict[str, Any]) -> None:  # noqa: F811
    sugar = str(ctx["sugar"].id)
    supplier = _supplier(ctx)
    c, h = _api(ctx)
    doc = _approved_doc(c, h, ctx, supplier)
    line = doc["lines"][0]["id"]
    r = _post(
        c,
        h,
        f"/api/inventory/purchasing/documents/{doc['id']}/return",
        {"lines": [{"document_line_id": line, "qty_milli": "2000", "reason": "تالف"}]},
    )
    ret = r.json()["return"]
    assert _balance(ctx, sugar) == "36000"
    # قبل ردّ المورد لا مرفوض
    r = _post(
        c,
        h,
        f"/api/inventory/purchasing/returns/{ret['id']}/rejected",
        {"destination": "stock", "reason": "x"},
    )
    assert r.status_code == 400 and r.json()["detail"] == "nothing_rejected"
    # المورد قبل كرتونة ورفض كرتونة
    r = _post(
        c,
        h,
        f"/api/inventory/purchasing/returns/{ret['id']}",
        {
            "lines": [
                {"id": ret["lines"][0]["id"], "accepted_qty_milli": "1000", "supplier_note": ""}
            ],
            "note": "قبل واحدة",
        },
    )
    ret = r.json()["return"]
    assert ret["status"] == "partial" and ret["lines"][0]["rejected_qty_milli"] == "1000"
    assert ret["rejected_destination"] == ""
    # بلا سبب مرفوض
    r = _post(
        c,
        h,
        f"/api/inventory/purchasing/returns/{ret['id']}/rejected",
        {"destination": "stock", "reason": ""},
    )
    assert r.status_code == 400 and r.json()["detail"] == "reason_required"
    # «أعد المرفوض إلى المخزون»: +12 كغ بفاعل وسبب
    r = _post(
        c,
        h,
        f"/api/inventory/purchasing/returns/{ret['id']}/rejected",
        {"destination": "stock", "reason": "سليمة — نبيعها"},
    )
    assert r.status_code == 200, r.content
    ret = r.json()["return"]
    assert ret["rejected_destination"] == "stock" and ret["rejected_by_name"] == "سالم"
    assert ret["rejected_reason"] == "سليمة — نبيعها"
    assert _balance(ctx, sugar) == "48000"
    rows = c.get(f"/api/inventory/items/{sugar}/movements", **h).json()["rows"]  # type: ignore[arg-type]
    assert any(x["reason"] == "return_rejected" and x["delta_milli"] == "12000" for x in rows)
    # القرار لا يُعاد، والردّ لا يتغيّر بعده
    r = _post(
        c,
        h,
        f"/api/inventory/purchasing/returns/{ret['id']}/rejected",
        {"destination": "quarantine", "reason": "x"},
    )
    assert r.status_code == 400 and r.json()["detail"] == "rejected_decided"
    r = _post(
        c,
        h,
        f"/api/inventory/purchasing/returns/{ret['id']}",
        {"lines": [{"id": ret["lines"][0]["id"], "accepted_qty_milli": "0"}], "note": ""},
    )
    assert r.status_code == 400 and r.json()["detail"] == "rejected_decided"
    # مرتجع ثانٍ مرفوض كله → «انقله إلى الحجر»
    r = _post(
        c,
        h,
        f"/api/inventory/purchasing/documents/{doc['id']}/return",
        {"lines": [{"document_line_id": line, "qty_milli": "1000", "reason": "تالف"}]},
    )
    ret2 = r.json()["return"]
    _post(
        c,
        h,
        f"/api/inventory/purchasing/returns/{ret2['id']}",
        {"lines": [{"id": ret2["lines"][0]["id"], "accepted_qty_milli": "0"}], "note": "رفض"},
    )
    r = _post(
        c,
        h,
        f"/api/inventory/purchasing/returns/{ret2['id']}/rejected",
        {"destination": "quarantine", "reason": "تالفة فعلاً"},
    )
    assert r.status_code == 200 and r.json()["return"]["rejected_destination"] == "quarantine"
    assert _quarantine(ctx, ctx["sugar"].id) == 12000
    assert _balance(ctx, sugar) == "36000"


# ------------------------------------------------------------------------------------ I-08


def _partial_transfer(
    c0: dict[str, Any], two_tenants: TwoTenants
) -> tuple[Client, dict[str, str], dict[str, Any], Any, dict[str, Any]]:
    """تحويل 10 كغ استُلم منه 7 — والباقي 3 في الطريق."""
    from core.auth.devices import register_device

    sugar = str(c0["sugar"].id)
    to = two_tenants.a_branches[1]
    with tenant_context(c0["tenant"].id):
        StockMovement.objects.create(
            tenant=c0["tenant"],
            branch=c0["branch"],
            item_id=c0["sugar"].id,
            delta_base_qty_milli=100000,
            reason="receive",
        )
    assert do_push(c0, _transfer_op(c0, to, [(sugar, "سكر", "10000", "1000")])) == ["accepted"]
    c, h = _api(c0)
    t = c.get("/api/inventory/transfers", **h).json()["transfers"][0]  # type: ignore[arg-type]
    with platform_context():
        UserBranchAccess.unscoped.create(
            tenant=c0["tenant"],
            user=c0["owner"],
            branch=to,
            role=Role.unscoped.filter(tenant=c0["tenant"], code="owner").first(),
        )
    with tenant_context(c0["tenant"].id):
        reg_to = register_device(user=c0["owner"], branch=to, name="مخزن بحري")
    dev_to = dict(c0, branch=to, device=reg_to.device)
    op = _receipt_of_transfer(c0, t, to, {sugar: "7000"}, reason="ثلاثة ممزقة")
    assert do_push(dev_to, op) == ["accepted"]
    return c, h, t, to, dev_to


def _complete_op(
    c0: dict[str, Any], t: dict[str, Any], to: Any, got: str, reason: str = ""
) -> dict[str, Any]:
    """«استلم الباقي»: المُرسل في السطر هو الباقي كما يعرضه الجهاز."""
    remaining = {**t, "lines": [{**ln, "base_qty_milli": "3000"} for ln in t["lines"]]}
    return _receipt_of_transfer(c0, remaining, to, {t["lines"][0]["item_id"]: got}, reason=reason)


def test_second_receipt_completes_partial_transfer_up_to_remaining(
    ctx: dict[str, Any],  # noqa: F811
    two_tenants: TwoTenants,
) -> None:
    sugar = str(ctx["sugar"].id)
    c, h, t, to, dev_to = _partial_transfer(ctx, two_tenants)
    t2 = c.get(f"/api/inventory/transfers/{t['id']}", **h).json()["transfer"]  # type: ignore[arg-type]
    assert t2["lines"][0]["remaining_base_milli"] == "3000"
    # فوق الباقي: يُحجر للمراجعة لا يُقبل صامتاً
    assert do_push(dev_to, _complete_op(ctx, t, to, "4000", reason="زيادة")) == ["conflicted"]
    assert _balance(ctx, sugar, to) == "7000"
    # 2 من 3: يبقى جزئياً بكيلو
    assert do_push(dev_to, _complete_op(ctx, t, to, "2000", reason="كيس ممزق")) == ["accepted"]
    t3 = c.get(f"/api/inventory/transfers/{t['id']}", **h).json()["transfer"]  # type: ignore[arg-type]
    assert t3["status"] == "partially_received" and t3["in_transit_milli"] == "1000"
    assert _balance(ctx, sugar, to) == "9000"


def test_owner_settles_remaining_lost_or_returned_and_late_alert(
    ctx: dict[str, Any],  # noqa: F811
    two_tenants: TwoTenants,
) -> None:
    from core import notifications

    sugar = str(ctx["sugar"].id)
    c, h, t, to, _dev = _partial_transfer(ctx, two_tenants)
    # تنبيه المالك: أُرسل قبل أكثر من 72 ساعة ولم يُستلم كاملاً
    with tenant_context(ctx["tenant"].id):
        notifications.refresh()
        n = Notification.objects.get(kind="transfer_late")
        assert n.owner_only and n.title == f"تحويل {t['transfer_number']} — تأخّر فوق 72 ساعة"
    # الإلغاء لا يعيد الباقي تلقائياً — يُحسم بقرار
    r = c.post(f"/api/inventory/transfers/{t['id']}/cancel", **h)  # type: ignore[arg-type]
    assert r.status_code == 400 and r.json()["errors"][0]["code"] == "settle_required"
    # القرار للمالك وحده، وبسبب
    cc, ch = _cashier(ctx, ctx["branch"])
    r = _post(cc, ch, f"/api/inventory/transfers/{t['id']}/settle", {"outcome": "lost"})
    assert r.status_code == 403
    r = _post(c, h, f"/api/inventory/transfers/{t['id']}/settle", {"outcome": "lost", "reason": ""})
    assert r.status_code == 400 and r.json()["errors"][0]["code"] == "reason_required"
    # «فُقد في الطريق»: الباقي يُهلك من الطريق، بلا حركة على أي من الفرعين
    with tenant_context(ctx["tenant"].id):
        moves = StockMovement.objects.count()
    r = _post(
        c,
        h,
        f"/api/inventory/transfers/{t['id']}/settle",
        {"outcome": "lost", "reason": "سقطت من الشاحنة"},
    )
    assert r.status_code == 200, r.content
    tr = r.json()["transfer"]
    assert tr["status"] == "received" and tr["settlement"] == "lost"
    assert tr["settlement_label"] == "فُقد في الطريق" and tr["in_transit_milli"] == "0"
    assert tr["settled_by_name"] == "سالم" and tr["lines"][0]["settled_base_milli"] == "3000"
    with tenant_context(ctx["tenant"].id):
        assert StockMovement.objects.count() == moves
        rec = DamageRecord.objects.get(source="transit")
        assert rec.base_qty_milli == 3000 and rec.destination == "write_off"
        notifications.refresh()
        assert Notification.objects.get(kind="transfer_late").resolved_at is not None
    assert _balance(ctx, sugar) == "90000" and _balance(ctx, sugar, to) == "7000"
    r = _post(
        c, h, f"/api/inventory/transfers/{t['id']}/settle", {"outcome": "lost", "reason": "x"}
    )
    assert r.status_code == 400 and r.json()["errors"][0]["code"] == "not_partial"


def test_settle_returned_puts_remaining_back_with_sender(
    ctx: dict[str, Any],  # noqa: F811
    two_tenants: TwoTenants,
) -> None:
    sugar = str(ctx["sugar"].id)
    c, h, t, to, _dev = _partial_transfer(ctx, two_tenants)
    r = _post(
        c,
        h,
        f"/api/inventory/transfers/{t['id']}/settle",
        {"outcome": "returned", "reason": "عادت مع السائق"},
    )
    assert r.status_code == 200, r.content
    assert r.json()["transfer"]["settlement_label"] == "يعود للمرسل"
    assert _balance(ctx, sugar) == "93000" and _balance(ctx, sugar, to) == "7000"
    with tenant_context(ctx["tenant"].id):
        assert StockTransfer.objects.get(id=t["id"]).status == "received"
    rows = c.get(f"/api/inventory/items/{sugar}/movements", **h).json()["rows"]  # type: ignore[arg-type]
    back = next(x for x in rows if x["reason"] == "transfer_in")
    assert back["delta_milli"] == "3000" and "يعود للمرسل" in back["actor"]


# ------------------------------------------------------------------------------------ I-10


def test_home_card_count_waiting_for_adjustment(ctx: dict[str, Any]) -> None:  # noqa: F811
    sugar = str(ctx["sugar"].id)
    op = _count_op(ctx, [(sugar, "سكر", "8000", "10000")])
    assert do_push(ctx, op) == ["accepted"]
    sid = op["members"][0]["id"]
    c, h = _api(ctx)
    home = c.get("/api/home", **h).json()  # type: ignore[arg-type]
    card = next(d for d in home["decisions"] if d["id"] == f"count-pending:{sid}")
    assert card["title"] == "جرد ينتظر التسوية" and card["action"] == "مراجعة الفروق"
    assert card["href"] == f"/inventory/count/{sid}/review"
    # الكاشير لا يسوّي فلا يرى البطاقة
    cc, ch = _cashier(ctx, ctx["branch"])
    home = cc.get("/api/home", **ch).json()  # type: ignore[arg-type]
    assert not any(str(d["id"]).startswith("count-pending:") for d in home["decisions"])

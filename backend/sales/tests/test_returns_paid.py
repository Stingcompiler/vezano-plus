"""مراجعة 2026-11-22 المرحلة ١ (0005 §٢٩٠): المرتجع يردّ ما دُفع لا سعر القائمة، ووجهته تتبع الدفع
الأصلي، ولا يتراكب مع الإلغاء.

- S-01: خصم الفاتورة يُوزَّع على السطور؛ المرتجع الكامل لفاتورة 21,000 بخصم 200 يردّ 20,800، والجزئي
  تراكمياً لا يتجاوز المدفوع أبداً؛ قيمة مُعدّة فوق ذلك تُحجر.
- S-02: الآجل يُخصم من الذمّة أولاً، ثم التحويل، ثم النقد؛ وجهة تخالف ذلك تُحجر حتى يقرّر المالك.
- S-06: مرتجع على فاتورة معكوسة يُحجر، وعكس فاتورة لها مرتجع يُرفض.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from django.test import Client

from core.tenancy import tenant_context
from parties import services as party_services
from sales.models import Sale, SaleReturn
from sales.tests.test_duplicates import _open_shift
from sales.tests.test_duplicates import ctx as ctx_fixture
from sales.tests.test_sale import ITEM, do_push, sale_op
from shifts import services as shift_services
from shifts.models import Shift
from sync.models import QuarantinedOperation

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.usefixtures("pinned_clock")]
ctx = ctx_fixture

_n = iter(range(1, 1000))


def ret_op(
    c: dict[str, Any],
    sale: Sale,
    *,
    qty: str,
    value: int,
    parts: tuple[int, int, int] | None,
    destination: str | None = None,
    shift_id: str | None = None,
    party_id: str | None = None,
) -> dict[str, Any]:
    """مرتجع صالح بقيمة وأجزاء (آجل، تحويل، نقد) معلنة؛ `parts=None` = جهاز قديم بوجهة واحدة."""
    with tenant_context(c["tenant"].id):
        line = sale.lines.get()
    rid = str(uuid.uuid4())
    head: dict[str, Any] = {
        "return_id": rid,
        "return_number": f"RET-KRT-A2-26-{next(_n):06d}",
        "sale_id": str(sale.id),
        "branch_id": str(c["branch"].id),
        "device_id": str(c["device"].id),
        "user_id": str(c["owner"].id),
        "condition": "good",
        "total_minor": str(value),
        "business_date": "2026-09-17",
        "occurred_at": "2026-09-17T11:00:00Z",
    }
    if parts is not None:
        credit, bank, cash = parts
        head.update(credit_minor=str(credit), bank_minor=str(bank), cash_minor=str(cash))
        used = [d for d, v in (("credit", credit), ("bank", bank), ("cash", cash)) if v > 0]
        head["destination"] = destination or (used[0] if len(used) == 1 else "mixed")
    else:
        head["destination"] = destination or "cash"
    if shift_id:
        head["shift_id"] = shift_id
    pid = party_id if party_id is not None else (str(sale.party_id) if sale.party_id else "")
    if pid:
        head["party_id"] = pid
    q = int(qty)
    return {
        "operation_id": str(uuid.uuid4()),
        "kind": "sale_return",
        "op_version": 1,
        "dependencies": [],
        "members": [
            {"entity": "sales.SaleReturn", "id": rid, "schema_version": 1, "payload": head},
            {
                "entity": "sales.SaleReturnLine",
                "id": (lid := str(uuid.uuid4())),
                "schema_version": 1,
                "payload": {
                    "line_id": lid,
                    "return_id": rid,
                    "sale_line_id": str(line.id),
                    "item_id": ITEM,
                    "factor_milli": str(line.factor_milli),
                    "qty_milli": qty,
                    "unit_price_minor": str(line.unit_price_minor),
                    "line_total_minor": str(value),
                },
            },
            {
                "entity": "inventory.StockMovement",
                "id": (mid := str(uuid.uuid4())),
                "schema_version": 1,
                "payload": {
                    "movement_id": mid,
                    "branch_id": str(c["branch"].id),
                    "item_id": ITEM,
                    "delta_base_qty_milli": str(q * line.factor_milli // 1000),
                    "reason": "return",
                    "source_entity": "sales.SaleReturn",
                    "source_id": rid,
                    "occurred_at": "2026-09-17T11:00:00Z",
                },
            },
        ],
    }


def _sale(c: dict[str, Any], invoice: str, **kw: Any) -> Sale:
    assert do_push(c, sale_op(c, invoice=invoice, **kw)) == ["accepted"]
    with tenant_context(c["tenant"].id):
        sale: Sale = Sale.objects.get(invoice_number=invoice)
    return sale


def _party(c: dict[str, Any]) -> Any:
    with tenant_context(c["tenant"].id):
        return party_services.create_party(
            party_id=None, name="أحمد الطيب", phone="", created_by=c["owner"], distinct_from=None
        )


def _balance(c: dict[str, Any], party: Any) -> str:
    with tenant_context(c["tenant"].id):
        return str(party_services.party_payload(party)["balance_minor"])


def _held(c: dict[str, Any]) -> list[str]:
    with tenant_context(c["tenant"].id):
        return [q.code for q in QuarantinedOperation.objects.order_by("received_at")]


def _refunds(c: dict[str, Any], sid: str) -> int:
    with tenant_context(c["tenant"].id):
        return shift_services.cash_totals(Shift.objects.get(id=sid)).cash_refunds_minor


# ---------------------------------------------------------------- S-01


def test_full_return_of_discounted_invoice_refunds_what_was_paid(ctx: dict[str, Any]) -> None:
    """فاتورة 686 من بيانات العرض: سطر 21,000 وخصم 200 → دُفع 20,800. المرتجع الكامل يردّ 20,800
    نقداً؛ مرتجع مُعدّ بسعر القائمة (21,000) يُحجر ولا يمسّ الصندوق."""
    sid = str(uuid.uuid4())
    _open_shift(ctx, sid)
    sale = _sale(
        ctx, "INV-686", price="2100000", discount=("amount", "20000", "20000"), shift_id=sid
    )
    assert sale.total_minor == 2080000
    forged = ret_op(ctx, sale, qty="1000", value=2100000, parts=(0, 0, 2100000), shift_id=sid)
    assert do_push(ctx, forged) == ["conflicted"]
    assert _held(ctx) == ["return_exceeds_sale"]
    assert _refunds(ctx, sid) == 0
    ok = ret_op(ctx, sale, qty="1000", value=2080000, parts=(0, 0, 2080000), shift_id=sid)
    assert do_push(ctx, ok) == ["accepted"]
    assert _refunds(ctx, sid) == 2080000
    with tenant_context(ctx["tenant"].id):
        r = SaleReturn.objects.get()
        assert (r.total_minor, r.cash_minor, r.destination) == (2080000, 2080000, "cash")


def test_cumulative_partial_returns_never_exceed_what_was_paid(ctx: dict[str, Any]) -> None:
    """3 وحدات × 100.00 بخصم 10.00 → دُفع 290.00. الردّ وحدةً وحدة: 96.67 + 96.66 + 96.67 = 290.00
    بالضبط (V(c) = round(29000 × c ÷ 3000)). جزء بوحدة صغرى زائدة يُحجر."""
    sale = _sale(ctx, "INV-P", qty="3000", price="10000", discount=("amount", "1000", "1000"))
    over = ret_op(ctx, sale, qty="1000", value=9668, parts=(0, 0, 9668))
    assert do_push(ctx, over) == ["conflicted"]
    for v in (9667, 9666, 9667):
        assert do_push(ctx, ret_op(ctx, sale, qty="1000", value=v, parts=(0, 0, v))) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        assert sum(r.total_minor for r in SaleReturn.objects.all()) == sale.total_minor == 29000
    # لا شيء بقي ليُردّ: حتى وحدة صغرى واحدة تتجاوز الأصل
    assert do_push(ctx, ret_op(ctx, sale, qty="1000", value=1, parts=(0, 0, 1))) == ["conflicted"]


def test_undiscounted_invoice_still_accepts_price_times_quantity(ctx: dict[str, Any]) -> None:
    """جهاز قديم (بلا أجزاء، الكمية × السعر) على فاتورة نقدية بلا خصم: يُقبل كما كان."""
    sale = _sale(ctx, "INV-OLD", qty="3000", price="10000")
    assert do_push(ctx, ret_op(ctx, sale, qty="1000", value=10000, parts=None)) == ["accepted"]
    with tenant_context(ctx["tenant"].id):
        assert SaleReturn.objects.get().cash_minor == 10000


# ---------------------------------------------------------------- S-02


def test_credit_sale_return_reduces_debt_not_the_drawer(ctx: dict[str, Any]) -> None:
    """فاتورة آجلة كلها: المرتجع يُخصم من الذمّة (10,000 → 0) ولا يُخرج نقداً. جهاز يعلن «نقداً»
    (الخيار الافتراضي القديم) يُحجر `return_refund_mismatch`: لا نقد خرج والدين باقٍ."""
    sid = str(uuid.uuid4())
    _open_shift(ctx, sid)
    party = _party(ctx)
    sale = _sale(ctx, "INV-C", party_id=str(party.id), payments=[("credit", "10000")], shift_id=sid)
    assert _balance(ctx, party) == "10000"
    legacy_cash = ret_op(ctx, sale, qty="1000", value=10000, parts=None, shift_id=sid)
    assert do_push(ctx, legacy_cash) == ["conflicted"]
    forged_cash = ret_op(ctx, sale, qty="1000", value=10000, parts=(0, 0, 10000), shift_id=sid)
    assert do_push(ctx, forged_cash) == ["conflicted"]
    assert _held(ctx) == ["return_refund_mismatch", "return_refund_mismatch"]
    assert _refunds(ctx, sid) == 0 and _balance(ctx, party) == "10000"
    ok = ret_op(ctx, sale, qty="1000", value=10000, parts=(10000, 0, 0), shift_id=sid)
    assert do_push(ctx, ok) == ["accepted"]
    assert _refunds(ctx, sid) == 0 and _balance(ctx, party) == "0"


def test_credit_part_must_reduce_the_invoice_customer(ctx: dict[str, Any]) -> None:
    """الجزء الآجل يُخصم من ذمّة عميل الفاتورة نفسه لا من عميل آخر يختاره طلب مُعدّ."""
    party, other = _party(ctx), _party(ctx)
    sale = _sale(ctx, "INV-X", party_id=str(party.id), payments=[("credit", "10000")])
    op = ret_op(ctx, sale, qty="1000", value=10000, parts=(10000, 0, 0), party_id=str(other.id))
    assert do_push(ctx, op) == ["conflicted"]
    assert _held(ctx) == ["return_refund_mismatch"]
    assert _balance(ctx, party) == "10000" and _balance(ctx, other) == "0"


def test_mixed_sale_reduces_debt_first_then_cash(ctx: dict[str, Any]) -> None:
    """مختلط: 40.00 نقداً + 60.00 آجلاً على وحدتين. ردّ الأولى (50.00) كله من الذمّة؛ الثانية: 10.00
    من الذمّة الباقية ثم 40.00 نقداً — مجموع الذمّة والنقد = قيمة المرتجع (§٧.٢)."""
    sid = str(uuid.uuid4())
    _open_shift(ctx, sid)
    party = _party(ctx)
    sale = _sale(
        ctx,
        "INV-M",
        qty="2000",
        price="5000",
        party_id=str(party.id),
        payments=[("cash", "4000"), ("credit", "6000")],
        shift_id=sid,
    )
    wrong = ret_op(ctx, sale, qty="1000", value=5000, parts=(1000, 0, 4000), shift_id=sid)
    assert do_push(ctx, wrong) == ["conflicted"]
    first = ret_op(ctx, sale, qty="1000", value=5000, parts=(5000, 0, 0), shift_id=sid)
    assert do_push(ctx, first) == ["accepted"]
    assert _balance(ctx, party) == "1000" and _refunds(ctx, sid) == 0
    second = ret_op(ctx, sale, qty="1000", value=5000, parts=(1000, 0, 4000), shift_id=sid)
    assert do_push(ctx, second) == ["accepted"]
    assert _balance(ctx, party) == "0" and _refunds(ctx, sid) == 4000
    with tenant_context(ctx["tenant"].id):
        assert sorted(r.destination for r in SaleReturn.objects.all()) == ["credit", "mixed"]


def test_bank_sale_refunds_as_bank_outside_the_drawer(ctx: dict[str, Any]) -> None:
    """فاتورة بتحويل: الردّ تحويلاً لا نقداً من الدرج. «نقداً» يُحجر."""
    sid = str(uuid.uuid4())
    _open_shift(ctx, sid)
    sale = _sale(ctx, "INV-B", payments=[("bank", "10000")], shift_id=sid)
    cash = ret_op(ctx, sale, qty="1000", value=10000, parts=None, shift_id=sid)
    assert do_push(ctx, cash) == ["conflicted"]
    bank = ret_op(ctx, sale, qty="1000", value=10000, parts=(0, 10000, 0), shift_id=sid)
    assert do_push(ctx, bank) == ["accepted"]
    assert _refunds(ctx, sid) == 0
    with tenant_context(ctx["tenant"].id):
        r = SaleReturn.objects.get()
        assert (r.destination, r.bank_minor, r.cash_minor) == ("bank", 10000, 0)
    c = Client()
    body = c.get(f"/api/sales/{sale.id}", HTTP_AUTHORIZATION=f"Bearer {ctx['access']}").json()
    assert body["returns"][0]["bank_minor"] == "10000"


def test_parts_must_add_up_and_match_destination(ctx: dict[str, Any]) -> None:
    """أجزاء لا تساوي القيمة، أو «تحويل» بلا أجزاء من جهاز قديم — مرفوضة شكلاً."""
    sale = _sale(ctx, "INV-S", payments=[("bank", "10000")])
    bad_sum = ret_op(ctx, sale, qty="1000", value=10000, parts=(0, 9000, 0))
    assert do_push(ctx, bad_sum) == ["rejected"]
    bad_dest = ret_op(ctx, sale, qty="1000", value=10000, parts=(0, 10000, 0), destination="cash")
    assert do_push(ctx, bad_dest) == ["rejected"]
    legacy_bank = ret_op(ctx, sale, qty="1000", value=10000, parts=None, destination="bank")
    assert do_push(ctx, legacy_bank) == ["rejected"]


def test_owner_may_accept_a_mismatched_destination(ctx: dict[str, Any]) -> None:
    """الاستثناء بإذن المالك: نقداً لفاتورة آجلة يُطبَّق كما أعلنه الجهاز بعد قبوله في SYS-03."""
    party = _party(ctx)
    sale = _sale(ctx, "INV-E", party_id=str(party.id), payments=[("credit", "10000")])
    assert do_push(ctx, ret_op(ctx, sale, qty="1000", value=10000, parts=None)) == ["conflicted"]
    with tenant_context(ctx["tenant"].id):
        held = QuarantinedOperation.objects.get()
        from sync.review import detail_payload

        assert detail_payload(held)["acceptable"] is True
    r = Client().post(
        f"/api/sync/quarantine/{held.id}/decide",
        {"decision": "accept", "reason": "الزبون طلب نقداً وسدّد دينه سابقاً"},
        content_type="application/json",
        headers={"Authorization": f"Bearer {ctx['access']}"},
    )
    assert r.status_code == 200, r.content
    with tenant_context(ctx["tenant"].id):
        assert SaleReturn.objects.get().cash_minor == 10000
    assert _balance(ctx, party) == "10000"


# ---------------------------------------------------------------- S-06


def _reverse(c: dict[str, Any], first: Sale, second: Sale) -> Any:
    return Client().post(
        "/api/sales/duplicates/decide",
        {
            "first_id": str(first.id),
            "second_id": str(second.id),
            "decision": "reverse",
            "reason": "تكرار",
        },
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {c['access']}",
    )


def test_return_on_reversed_invoice_is_held(ctx: dict[str, Any]) -> None:
    """العكس أعاد المخزون والنقد: مرتجع بعده (من جهاز لم يعلم بالعكس) يُحجر ولا يُخرج نقداً."""
    sid = str(uuid.uuid4())
    _open_shift(ctx, sid)
    first = _sale(ctx, "INV-1", shift_id=sid)
    second = _sale(ctx, "INV-2", shift_id=sid)
    assert _reverse(ctx, first, second).status_code == 201
    op = ret_op(ctx, second, qty="1000", value=10000, parts=(0, 0, 10000), shift_id=sid)
    assert do_push(ctx, op) == ["conflicted"]
    assert _held(ctx) == ["return_sale_reversed"]
    assert _refunds(ctx, sid) == 0
    with tenant_context(ctx["tenant"].id):
        assert not SaleReturn.objects.exists()


def test_invoice_with_a_return_cannot_be_reversed(ctx: dict[str, Any]) -> None:
    """العكس يعيد كل الكمية والنقد: بعد مرتجع جزئي يُخرجهما مرتين — يُرفض `sale_has_returns`."""
    first = _sale(ctx, "INV-1", qty="2000", price="5000")
    second = _sale(ctx, "INV-2", qty="2000", price="5000")
    assert do_push(ctx, ret_op(ctx, second, qty="1000", value=5000, parts=(0, 0, 5000))) == [
        "accepted"
    ]
    r = _reverse(ctx, first, second)
    assert r.status_code == 409 and r.json()["detail"] == "sale_has_returns"
    with tenant_context(ctx["tenant"].id):
        assert not second.reversals.exists()

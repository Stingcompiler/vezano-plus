"""مراجعة 2026-11-10 (ع-٣): عملية واحدة مشوّهة لا تُسقط النقل كله.

كان معرّف غير صالح في سطر بيع يرفع استثناءً من المُطبِّق يخرج من `push()`، فيردّ الخادم 500
ويتراجع عن كل ما في الظرف — والجهاز يعيد الظرف نفسه بلا نهاية فيتوقف طابوره. الآن تُحجر المشوّهة
وحدها ويُقبل جيرانها، والردّ 200 بنتيجة لكل عملية."""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from core.tenancy import tenant_context
from core.tests.test_org import ctx  # noqa: F401
from sales.models import Sale, SaleLine
from sales.tests.test_sale import sale_op
from shifts.models import Shift
from shifts.tests.test_shifts import shift_open
from sync import appliers
from sync.models import QuarantinedOperation
from sync.tests.test_push_identity import _as, _push

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.usefixtures("pinned_clock")]


def _member(op: dict[str, Any], entity: str) -> dict[str, Any]:
    payload: dict[str, Any] = next(m for m in op["members"] if m["entity"] == entity)["payload"]
    return payload


def test_malformed_id_is_rejected_alone_and_neighbours_are_kept(
    ctx: dict[str, Any],  # noqa: F811
) -> None:
    """الطلب نفسه من المراجعة: فتح وردية سليم + بيع سطره يحمل `unit_id` ليس معرّفاً."""
    owner = _as(ctx, "owner")
    sid = str(uuid.uuid4())
    good = shift_open(owner, sid)
    bad = sale_op(owner, invoice="BAD-1")
    _member(bad, "sales.SaleLine")["unit_id"] = "not-a-uuid"
    after = sale_op(owner, invoice="OK-2")

    assert _push(owner, good, bad, after) == [
        ("accepted", ""),
        ("rejected", "validation"),
        ("accepted", ""),
    ]
    with tenant_context(ctx["tenant"].id):
        assert Shift.objects.filter(id=sid).exists()
        assert list(Sale.objects.values_list("invoice_number", flat=True)) == ["OK-2"]
        held = QuarantinedOperation.objects.get(reason="rejected")
        assert held.code == "validation" and "unit_id" in held.detail
    # الإعادة لا تغيّر شيئاً ولا تسدّ: السليمتان مكررتان والمشوّهة مرفوضة كما هي
    assert _push(owner, good, bad, after) == [
        ("duplicate", ""),
        ("rejected", "validation"),
        ("duplicate", ""),
    ]


@pytest.mark.parametrize(
    ("entity", "field", "value"),
    [
        ("sales.Sale", "party_id", "x"),
        ("sales.Sale", "shift_id", "123"),
        ("sales.SaleLine", "item_id", "سكر"),
        ("inventory.StockMovement", "item_id", "0"),
        ("inventory.StockMovement", "source_id", "abc"),
    ],
)
def test_every_id_field_is_checked_before_the_applier(
    ctx: dict[str, Any],  # noqa: F811
    entity: str,
    field: str,
    value: str,
) -> None:
    owner = _as(ctx, "owner")
    op = sale_op(owner, invoice="BAD-1")
    _member(op, entity)[field] = value
    assert _push(owner, op) == [("rejected", "validation")]
    with tenant_context(ctx["tenant"].id):
        assert not Sale.objects.exists()


def test_applier_crash_rolls_back_its_operation_only(
    ctx: dict[str, Any],  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """شبكة الأمان: استثناء غير متوقع من مُطبِّق (خلل برمجي أو حمولة لم يتوقعها التحقق) يتراجع
    عن عمليته كلها — رأسها وما سبق السطر — ويحجرها `commit_failed`، وما بعدها في الظرف يُقبل."""
    owner = _as(ctx, "owner")
    doomed = sale_op(owner, invoice="BOOM-1")
    fine = sale_op(owner, invoice="OK-1")
    doomed_line = next(m for m in doomed["members"] if m["entity"] == "sales.SaleLine")["id"]

    real = list(appliers.APPLIERS["sales.SaleLine"])

    def explode(tenant_id: Any, device_id: Any, actor: Any, entity_id: Any, payload: Any) -> None:
        if str(entity_id) == doomed_line:
            raise RuntimeError("خلل في المُطبِّق")
        for fn in real:
            fn(tenant_id, device_id, actor, entity_id, payload)

    monkeypatch.setitem(appliers.APPLIERS, "sales.SaleLine", [explode])
    assert _push(owner, doomed, fine) == [("rejected", "commit_failed"), ("accepted", "")]
    with tenant_context(ctx["tenant"].id):
        assert list(Sale.objects.values_list("invoice_number", flat=True)) == ["OK-1"]
        assert SaleLine.objects.count() == 1
        held = QuarantinedOperation.objects.get(reason="rejected")
        assert held.code == "commit_failed" and "RuntimeError" in held.detail

    # بعد زوال الخلل: الجهاز يعيد العملية نفسها فتُقبل — الحجر لم يحرق هويتها
    monkeypatch.setitem(appliers.APPLIERS, "sales.SaleLine", real)
    assert _push(owner, doomed) == [("accepted", "")]
    with tenant_context(ctx["tenant"].id):
        assert Sale.objects.filter(invoice_number="BOOM-1").exists()


def test_dependant_of_a_crashed_operation_is_rejected_not_applied(
    ctx: dict[str, Any],  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = _as(ctx, "owner")
    sid = str(uuid.uuid4())
    opening = shift_open(owner, sid)
    sale = sale_op(owner, invoice="DEP-1", shift_id=sid)
    sale["dependencies"] = [opening["operation_id"]]

    def explode(*_a: Any) -> None:
        raise RuntimeError("خلل في المُطبِّق")

    monkeypatch.setitem(appliers.APPLIERS, "shifts.ShiftOpened", [explode])
    assert _push(owner, opening, sale) == [
        ("rejected", "commit_failed"),
        ("rejected", "dependency_rejected"),
    ]
    with tenant_context(ctx["tenant"].id):
        assert not Shift.objects.exists() and not Sale.objects.exists()


@pytest.mark.parametrize(
    "spoil",
    [
        lambda op: op["members"].__setitem__(1, "ليس كائناً"),
        lambda op: op["members"][0].__setitem__("schema_version", "x"),
        lambda op: _member(op, "sales.SaleLine").__setitem__("qty_milli", ["1000"]),
        lambda op: _member(op, "sales.Sale").__setitem__("total_minor", {"v": 1}),
        lambda op: op.__setitem__("dependencies", "ليست قائمة"),
    ],
)
def test_malformed_shapes_are_rejected_not_500(
    ctx: dict[str, Any],  # noqa: F811
    spoil: Any,
) -> None:
    """أشكال لم يتوقعها مُحقِّق النوع: كلها رفض دائم مسمّى، والجار السليم يُقبل."""
    owner = _as(ctx, "owner")
    bad = sale_op(owner, invoice="BAD-1")
    spoil(bad)
    assert _push(owner, bad, sale_op(owner, invoice="OK-1")) == [
        ("rejected", "validation"),
        ("accepted", ""),
    ]
    with tenant_context(ctx["tenant"].id):
        assert list(Sale.objects.values_list("invoice_number", flat=True)) == ["OK-1"]

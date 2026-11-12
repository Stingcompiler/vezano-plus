"""0005 §٢٦٨ (اختيار المالك 2026-11-12: «الآجلة حين تستحق»، 30 يوماً): لا موعد استحقاق للفاتورة في
النظام، فالمستحق = أقدم فاتورة آجلة غير مسدَّدة مضى عليها 30 يوماً. للمالك وحده، ويزول بالسداد؛
والحديثة لا تُنبَّه، ولا الرصيد الافتتاحي (لا يدخل أعمار الديون — PTY-04)."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from core.auth.devices import register_device
from core.models import Notification
from core.tenancy import tenant_context
from parties import services as party_services
from parties.models import OpeningBalance
from parties.tests.test_parties import _receipt_op
from sales.tests.test_sale import ctx, do_push, sale_op  # noqa: F401

pytestmark = pytest.mark.django_db(transaction=True)


def _today(op: dict[str, Any]) -> dict[str, Any]:
    today = timezone.localdate().isoformat()
    for m in op["members"]:
        if "business_date" in m["payload"]:
            m["payload"]["business_date"] = today
        if "occurred_at" in m["payload"]:
            m["payload"]["occurred_at"] = f"{today}T10:34:00Z"
    return op


def test_credit_overdue_30_days_notifies_owner_until_paid(ctx: dict[str, Any]) -> None:  # noqa: F811
    with tenant_context(ctx["tenant"].id):

        def party(name: str) -> Any:
            return party_services.create_party(
                party_id=None, name=name, phone="", created_by=ctx["owner"], distinct_from=None
            )

        old, fresh, opening = party("أحمد الطيب"), party("فاطمة حسن"), party("عثمان")
        OpeningBalance.objects.create(
            tenant=ctx["tenant"],
            party=opening,
            side="customer_due",
            amount_minor=5000,
            reason="دفتر قديم",
            business_date=timezone.localdate() - timedelta(days=90),
            decided_by_user_id=ctx["owner"].id,
        )
        reg = register_device(user=ctx["owner"], branch=ctx["branch"], name="جهاز المالك")
    # أحمد: آجل بتاريخ 16 سبتمبر (أقدم من 30 يوماً) بلا سداد بعده؛ فاطمة: آجل اليوم
    assert do_push(
        ctx, sale_op(ctx, invoice="INV-O1", party_id=str(old.id), payments=[("credit", "10000")])
    ) == ["accepted"]
    assert do_push(
        ctx,
        _today(
            sale_op(
                ctx,
                invoice="INV-N1",
                price="3000",
                party_id=str(fresh.id),
                payments=[("credit", "3000")],
            )
        ),
    ) == ["accepted"]

    c, h = Client(), {"Authorization": f"Bearer {reg.access}"}

    def due() -> list[dict[str, Any]]:
        items = c.get("/api/notifications", headers=h).json()["items"]
        return [i for i in items if i["kind"] == "credit_due" and not i["resolved"]]

    assert [i["title"] for i in due()] == ["على أحمد الطيب 100.00 مستحقة"]
    assert due()[0]["href"] == f"/parties/{old.id}/statement"
    with tenant_context(ctx["tenant"].id):
        assert Notification.objects.get(kind="credit_due").owner_only is True

    # أحمد يسدّد اليوم: يزول التنبيه
    rc = {**ctx, "user": ctx["owner"]}
    assert do_push(ctx, _today(_receipt_op(rc, str(old.id), amount="10000"))) == ["accepted"]
    assert due() == []

"""فحص 2026-10-17 VP13 — سجل تدقيق المشغّلين: كل الأفعال عبر الوحدات، بتصفية وصفحات، وللمشغّل وحده."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from django.test import Client
from django.utils import timezone

from core.models import User
from core.tenancy import platform_context
from core.tests.test_org import _h, ctx  # noqa: F401
from stingops.models import OperatorAccessLog
from stingops.tests.test_operator import _operator_headers


def test_operator_audit_log_lists_filters_and_pages(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    oh = _operator_headers("ops_audit", "منى — تشغيل")
    with platform_context():
        op = User.unscoped.get(username="ops_audit")
        other = User.unscoped.create(
            tenant=None, username="ops_b", display_name="سعد — دعم", is_platform_staff=True
        )
        now = timezone.now()
        OperatorAccessLog.objects.create(
            operator=op, tenant=ctx["tenant"], action="tenant_detail", at=now - timedelta(minutes=3)
        )
        OperatorAccessLog.objects.create(
            operator=other, action="plan.update", detail="فرع واحد", at=now - timedelta(minutes=2)
        )
        same = now - timedelta(minutes=1)
        for i in range(55):  # صفحة كاملة + فائض في اللحظة نفسها
            OperatorAccessLog.objects.create(operator=op, action="login", detail=f"ua{i}", at=same)

    r = c.get("/api/platform/audit", headers=oh)
    assert r.status_code == 200
    body = r.json()
    assert len(body["entries"]) == 50 and body["next_before"]
    assert body["entries"][0]["action_label"] == "دخول"
    assert {"id": str(other.id), "name": "سعد — دعم"} in body["operators"]
    # الصفحة الثانية تكمل بلا تكرار ولا سقوط عند تساوي الوقت
    r2 = c.get(
        "/api/platform/audit",
        {"before": body["next_before"]},
        headers=oh,
    )
    ids = {e["id"] for e in body["entries"]} | {e["id"] for e in r2.json()["entries"]}
    with platform_context():
        assert len(ids) == OperatorAccessLog.objects.count()

    # التصفية: الفئة، المشغّل، المستأجر؛ ومعرّف تالف لا يُسقط الخادم
    h = oh
    cat = c.get("/api/platform/audit", {"category": "catalog"}, headers=h).json()["entries"]
    assert [(e["action"], e["action_label"], e["detail"]) for e in cat] == [
        ("plan.update", "تعديل باقة", "فرع واحد")
    ]
    by_op = c.get("/api/platform/audit", {"operator": str(other.id)}, headers=h).json()["entries"]
    assert {e["operator_name"] for e in by_op} == {"سعد — دعم"}
    by_t = c.get("/api/platform/audit", {"tenant": str(ctx["tenant"].id)}, headers=h).json()[
        "entries"
    ]
    assert [e["action_label"] for e in by_t] == ["فتح سجل مستأجر"]
    assert c.get("/api/platform/audit", {"operator": "x"}, headers=h).json()["entries"] == []

    # مستخدم متجر لا يقرأ السجل
    r = c.get("/api/platform/audit", headers=_h(ctx["tokens"]["owner"]))
    assert r.status_code == 403

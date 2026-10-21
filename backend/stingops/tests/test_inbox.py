"""0005 §١٩٠: وارد فريق المنصة — رسائل الدعم الواردة من المنشآت وإشعارات الأحداث.

- كانت رسائل الدعم (SYS-11) تُخزَّن ولا شاشة للمنصة تقرؤها؛
- كل حدث وارد (منشأة بانتظار الاعتماد، إيصال، رسالة، طلب جولة…) يترك إشعاراً لفريق المنصة؛
- «الدعم» يقرأ ويعالج ويعلّم مقروءاً؛ المالك وبلا جلسة لا يرون شيئاً.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from django.test import Client

from core.auth.accounts import create_account
from core.auth.memberships import create_tenant
from core.models import Tenant
from core.tenancy import platform_context, tenant_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from stingops.models import OperatorNotice, OperatorProfile
from stingops.tests.test_operator import _operator_headers
from sync.models import SupportReport

pytestmark = pytest.mark.django_db(transaction=True)

PASSWORD = "Sting-demo-2026!"  # noqa: S105 — كلمة مرور اختبار


def _support_headers() -> dict[str, str]:
    h = _operator_headers("inbox-sup", "طيب — دعم")
    with platform_context():
        OperatorProfile.objects.filter(user__username="inbox-sup").update(role="support")
    return h


def _notices(kind: str) -> list[OperatorNotice]:
    with platform_context():
        return list(OperatorNotice.objects.filter(kind=kind))


def test_new_tenant_and_proof_leave_notices(ctx: dict[str, Any]) -> None:  # noqa: F811
    account = create_account("0912447099", PASSWORD, "المالك")
    result = create_tenant(
        account,
        client_request_id=uuid.uuid4(),
        name="منشأة الاختبار",
        sector="grocery",
        currency="SDG",
        first_branch_name="الرئيسي",
    )
    rows = _notices("tenant_pending")
    assert len(rows) == 1 and "منشأة الاختبار" in rows[0].title
    assert rows[0].tenant_id == result.creation.tenant_id and rows[0].read_at is None
    # إيصال دفع يصل
    r = _post(
        Client(),
        _h(ctx["tokens"]["owner"]),
        "/api/org/subscription/proofs",
        {"reference": "INBOX-1", "plan_code": "dual"},
    )
    assert r.status_code == 201, r.content
    assert [n.title for n in _notices("proof")] == ["إيصال دفع جديد INBOX-1"]


def test_notices_list_read_and_roles(ctx: dict[str, Any]) -> None:  # noqa: F811
    from stingops.inbox import emit

    with platform_context():
        tenant = Tenant.unscoped.get(id=ctx["tenant"].id)
    emit("demo", "طلب جولة جديد: عثمان", href="/platform/demo-requests")
    emit("proof", "إيصال دفع جديد X", tenant_id=tenant.id)
    c = Client()
    sup = _support_headers()
    # لا مالك ولا بلا جلسة
    assert c.get("/api/platform/notices", headers=_h(ctx["tokens"]["owner"])).status_code == 403
    assert c.get("/api/platform/notices").status_code in {401, 403}
    # الدعم يقرأ
    body = c.get("/api/platform/notices", headers=sup).json()
    assert body["unread"] == 2 and len(body["notices"]) == 2
    assert body["new_messages"] == 0
    assert body["notices"][0]["title"] == "إيصال دفع جديد X"
    assert body["notices"][0]["tenant_name"] == tenant.name and body["notices"][0]["read"] is False
    # ويعلّم مقروءاً: واحداً ثم الباقي
    first = body["notices"][0]["id"]
    r = _post(c, sup, "/api/platform/notices/read", {"ids": [first]})
    assert r.status_code == 200 and r.json()["unread"] == 1
    assert [n["read_by_name"] for n in r.json()["notices"] if n["read"]] == ["طيب — دعم"]
    r = _post(c, sup, "/api/platform/notices/read", {})
    assert r.json()["unread"] == 0
    assert c.get("/api/platform/notices?unread=1", headers=sup).json()["notices"] == []
    assert _post(c, sup, "/api/platform/notices/read", {"ids": ["x"]}).status_code == 400


def test_support_report_reaches_platform_messages(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    with tenant_context(ctx["tenant"].id):
        rep = SupportReport.objects.create(
            tenant_id=ctx["tenant"].id,
            reference="SUP-261021-0001",
            device=uuid.uuid4(),
            user=uuid.uuid4(),
            user_name="سالم",
            app_version="1.4.2",
            payload={"app_version": "1.4.2", "errors": []},
            note="الطابعة لا تتصل",
        )
    sup = _support_headers()
    # المالك لا يرى
    assert c.get("/api/platform/messages", headers=_h(ctx["tokens"]["owner"])).status_code == 403
    body = c.get("/api/platform/messages", headers=sup).json()
    assert body["new_count"] == 1 and body["messages"][0]["reference"] == "SUP-261021-0001"
    assert body["messages"][0]["from_name"] == "سالم" and body["messages"][0]["handled"] is False
    assert body["messages"][0]["tenant_name"] == ctx["tenant"].name
    d = c.get(f"/api/platform/messages/{rep.id}", headers=sup).json()
    assert d["note"] == "الطابعة لا تتصل" and d["payload"]["app_version"] == "1.4.2"
    # المعالجة بملاحظة باسم المشغّل، مرة واحدة
    r = _post(c, sup, f"/api/platform/messages/{rep.id}/handle", {"note": "أُعيد ضبط الطابعة"})
    assert r.status_code == 200 and r.json()["handled_by_name"] == "طيب — دعم"
    assert _post(c, sup, f"/api/platform/messages/{rep.id}/handle", {}).status_code == 409
    assert c.get("/api/platform/messages", headers=sup).json()["messages"] == []
    allm = c.get("/api/platform/messages?status=all", headers=sup).json()
    assert allm["messages"][0]["handled_note"] == "أُعيد ضبط الطابعة"
    assert c.get("/api/platform/messages?status=handled", headers=sup).json()["new_count"] == 0
    assert c.get(f"/api/platform/messages/{uuid.uuid4()}", headers=sup).status_code == 404


def test_emit_never_breaks_the_original_operation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from stingops import inbox

    def boom(*_a: Any, **_k: Any) -> None:
        raise RuntimeError("db down")

    monkeypatch.setattr(OperatorNotice.objects, "create", boom)
    inbox.emit("demo", "x")  # لا استثناء

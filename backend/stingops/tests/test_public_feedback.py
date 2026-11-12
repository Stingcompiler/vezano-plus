"""0005 §٢٦٦: ملاحظات الزوار — بلا حساب، خاصة بالفريق، حدود وفخّ، أرقام وروابط تُخفى، وتظهر في
«الملاحظات» بمصدر «الزوار»."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from django.test import Client

from core.models import PortalChannel
from core.tenancy import platform_context, tenant_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from stingops.models import OperatorNotice, PublicFeedback
from stingops.public_feedback import PER_VISITOR_PER_HOUR, clean_text
from stingops.tests.test_inbox import _support_headers

pytestmark = pytest.mark.django_db(transaction=True)

URL = "/api/public/feedback"


def _send(c: Client, ip: str = "10.0.0.1", **over: Any) -> Any:
    body = {"kind": "platform", "text": "أتمنى وضعاً ليلياً", "page": "/plans", **over}
    return c.post(URL, body, content_type="application/json", REMOTE_ADDR=ip)


def _rows() -> list[PublicFeedback]:
    with platform_context():
        return list(PublicFeedback.objects.order_by("created_at"))


def test_clean_text() -> None:
    assert clean_text("زوروا https://spam.example/x الآن") == "زوروا [رابط] الآن"
    assert clean_text("www.bad.io و spam.xyz") == "[رابط] و [رابط]"
    assert clean_text("اتصل 0912447099") == "اتصل •••"


def test_visitor_sends_without_account() -> None:
    c = Client()
    r = _send(c, email="Visitor@Example.com")
    assert r.status_code == 201, r.content
    assert r.json()["reference"].startswith("PF-")
    (f,) = _rows()
    assert f.contact_email == "visitor@example.com" and f.page == "/plans"
    assert len(f.visitor_key) == 64 and "10.0.0.1" not in f.visitor_key
    with platform_context():
        n = OperatorNotice.objects.get(kind="feedback")
    assert f.reference in n.title and n.href == "/platform/feedback?source=public"


def test_validation_trap_and_limits() -> None:
    c = Client()
    assert _send(c, kind="rating").json()["detail"] == "kind_invalid"
    assert _send(c, text=" ").json()["detail"] == "text_required"
    assert _send(c, text="س" * 601).json()["detail"] == "text_too_long"
    assert _send(c, email="not-an-email").json()["detail"] == "email_invalid"
    assert _send(c, kind="shop", shop="no-such-shop").json()["detail"] == "shop_unknown"
    # الفخّ: نجاح ظاهر بلا حفظ
    r = _send(c, website="http://bot")
    assert r.status_code == 201 and _rows() == []
    for _ in range(PER_VISITOR_PER_HOUR):
        assert _send(c).status_code == 201
    r = _send(c)
    assert r.status_code == 429 and r.json()["detail"] == "rate_limited"
    # زائر آخر ما زال يستطيع
    assert _send(c, ip="10.0.0.2").status_code == 201


def test_shop_note_and_operator_flow(ctx: dict[str, Any]) -> None:  # noqa: F811
    with tenant_context(ctx["tenant"].id):
        PortalChannel.objects.create(tenant_id=ctx["tenant"].id, slug="wahat")
    c = Client()
    r = _send(c, kind="shop", shop="wahat", text="البائع لطيف لكن الأسعار غير ظاهرة")
    assert r.status_code == 201
    (f,) = _rows()
    assert f.shop_name == ctx["tenant"].name and f.shop_slug == "wahat"
    sup = _support_headers()
    # عدّاد واحد للتجار والزوار
    assert c.get("/api/platform/notices", headers=sup).json()["new_feedback"] == 1
    # التجار افتراضياً — لا تظهر ملاحظة الزائر هناك
    assert c.get("/api/platform/feedback", headers=sup).json()["items"] == []
    body = c.get("/api/platform/feedback?source=public", headers=sup).json()
    assert body["source"] == "public" and body["new"] == {"merchant": 0, "public": 1}
    row = body["items"][0]
    assert row["tenant_name"] == ctx["tenant"].name and row["kind_label"] == "ملاحظة عن محل"
    assert row["platform"] == "public" and row["screen"] == "/plans"
    path = f"/api/platform/feedback/public/{f.id}"
    r = _post(c, sup, path, {"status": "studying", "reply": "نتواصل مع المحل"})
    assert r.status_code == 200 and r.json()["updated_by_name"] == "طيب — دعم"
    assert (
        _post(c, sup, path, {"status": "studying", "reply": "نتواصل مع المحل"}).status_code == 409
    )
    assert (
        _post(
            c, sup, f"/api/platform/feedback/public/{uuid.uuid4()}", {"status": "done"}
        ).status_code
        == 404
    )
    # المالك لا يرى ملاحظات الزوار ولا يغيّرها
    owner = _h(ctx["tokens"]["owner"])
    assert c.get("/api/platform/feedback?source=public", headers=owner).status_code == 403
    assert _post(c, owner, path, {"status": "done"}).status_code == 403

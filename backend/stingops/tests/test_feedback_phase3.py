"""0005 §٢٦٧: الردّ على الزائر بالبريد، ملخّص آخر 30 يوماً بالنوع، ولقطة الشاشة مع ملاحظة التاجر."""

from __future__ import annotations

import base64
import uuid
from typing import Any

import pytest
from django.core import mail
from django.test import Client

from core.tenancy import platform_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from stingops.models import PublicFeedback
from stingops.tests.test_inbox import _support_headers

pytestmark = pytest.mark.django_db(transaction=True)

PNG = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\nfake").decode()


def _visitor(c: Client, **over: Any) -> PublicFeedback:
    body = {"kind": "platform", "text": "أتمنى وضعاً ليلياً", **over}
    assert c.post("/api/public/feedback", body, content_type="application/json").status_code == 201
    with platform_context():
        return PublicFeedback.objects.order_by("-created_at").first()  # type: ignore[return-value]


def test_email_reply_to_visitor(monkeypatch: pytest.MonkeyPatch) -> None:
    c = Client()
    sup = _support_headers()
    f = _visitor(c, email="visitor@example.com")
    path = f"/api/platform/feedback/public/{f.id}"
    # بلا ردّ لا بريد
    r = _post(c, sup, path, {"status": "studying", "reply": "", "email_reply": True})
    assert r.json()["detail"] == "reply_required"
    # بلا إعداد بريد على الخادم: يُحفظ ويقال «not_configured»
    monkeypatch.delenv("STING_EMAIL_FROM", raising=False)
    r = _post(c, sup, path, {"status": "studying", "reply": "سنضيفه", "email_reply": True})
    assert r.status_code == 200 and r.json()["email"] == "not_configured"
    assert r.json()["emailed_at"] == "" and len(mail.outbox) == 0
    monkeypatch.setenv("STING_EMAIL_FROM", "plus@vezano.app")
    r = _post(c, sup, path, {"status": "done", "reply": "أُضيف الوضع الليلي", "email_reply": True})
    assert r.json()["email"] == "sent" and r.json()["emailed_at"]
    (m,) = mail.outbox
    assert m.to == ["visitor@example.com"] and f.reference in m.subject
    assert "أُضيف الوضع الليلي" in m.body and "أتمنى وضعاً ليلياً" not in m.body
    # إعادة الإرسال بلا تغيير مسموحة حين تُطلب صراحة
    r = _post(c, sup, path, {"status": "done", "reply": "أُضيف الوضع الليلي", "email_reply": True})
    assert r.status_code == 200 and len(mail.outbox) == 2
    # زائر بلا بريد
    g = _visitor(c)
    r = _post(
        c,
        sup,
        f"/api/platform/feedback/public/{g.id}",
        {"status": "done", "reply": "x", "email_reply": True},
    )
    assert r.json()["detail"] == "no_email"


def test_summary_last_30_days(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    owner = _h(ctx["tokens"]["owner"])
    for kind in ("suggestion", "suggestion", "problem"):
        body = {"client_id": str(uuid.uuid4()), "kind": kind, "text": "نص"}
        assert _post(c, owner, "/api/support/feedback", body).status_code == 201
    _visitor(c, kind="site")
    sup = _support_headers()
    s = c.get("/api/platform/feedback", headers=sup).json()["summary"]
    assert s["merchant"] == {"suggestion": 2, "problem": 1, "opinion": 0}
    assert s["public"] == {"platform": 0, "site": 1, "shop": 0}


def test_screenshot_attachment(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    cash = _h(ctx["tokens"]["cashier"])
    base = {"kind": "problem", "text": "الشاشة تظهر هكذا"}
    bad = _post(
        c,
        cash,
        "/api/support/feedback",
        {**base, "client_id": str(uuid.uuid4()), "attachment": "data:text/html;base64,PGI+"},
    )
    assert bad.json()["detail"] == "attachment_invalid"
    big = "data:image/png;base64," + "A" * 2_000_001
    assert (
        _post(
            c,
            cash,
            "/api/support/feedback",
            {**base, "client_id": str(uuid.uuid4()), "attachment": big},
        ).json()["detail"]
        == "attachment_invalid"
    )
    r = _post(
        c,
        cash,
        "/api/support/feedback",
        {
            **base,
            "client_id": str(uuid.uuid4()),
            "attachment": PNG,
            "attachment_name": "screen.png",
        },
    )
    assert r.status_code == 201 and r.json()["has_attachment"] is True
    fid = r.json()["id"]
    # القائمة لا تحمل الصورة؛ تُطلب عند الفتح
    sup = _support_headers()
    row = c.get("/api/platform/feedback", headers=sup).json()["items"][0]
    assert row["has_attachment"] is True and "data_url" not in row
    url = f"/api/platform/feedback/{ctx['tenant'].id}/{fid}/attachment"
    a = c.get(url, headers=sup).json()
    assert a == {"data_url": PNG, "name": "screen.png"}
    assert c.get(url, headers=_h(ctx["tokens"]["owner"])).status_code == 403
    missing = f"/api/platform/feedback/{ctx['tenant'].id}/{uuid.uuid4()}/attachment"
    assert c.get(missing, headers=sup).status_code == 404

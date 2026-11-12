"""0005 §٢٦٣: ملاحظات التجار — أي دور يرسل، الأرقام تُخفى، الحدود، إعادة الإرسال الآمنة، و«الملاحظات»
في وارد المنصة بالحالة والردّ الذي يراه المرسل."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from django.test import Client

from core.tenancy import platform_context, tenant_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from stingops.models import OperatorNotice
from stingops.tests.test_inbox import _support_headers
from sync.feedback import PER_USER_PER_DAY, mask_phones
from sync.models import Feedback

pytestmark = pytest.mark.django_db(transaction=True)

URL = "/api/support/feedback"


def _body(**over: Any) -> dict[str, Any]:
    b: dict[str, Any] = {
        "client_id": str(uuid.uuid4()),
        "kind": "suggestion",
        "text": "أريد تقريراً للمبيعات حسب الساعة",
        "contact_ok": True,
        "screen": "REP-01",
        "platform": "web",
        "app_version": "0.1.4",
    }
    b.update(over)
    return b


def test_mask_phones() -> None:
    assert mask_phones("اتصل على 0912 447 099 الآن") == "اتصل على ••• الآن"
    assert mask_phones("+249912447099") == "•••"
    assert mask_phones("رقمه ٠٩١٢٤٤٧٠٩٩") == "رقمه •••"
    # الأرقام القصيرة (كمية، سعر، سنة) لا تُمس
    assert mask_phones("بعت 12 كرتونة بسعر 4500 في 2026") == "بعت 12 كرتونة بسعر 4500 في 2026"


def test_any_role_sends_and_sees_own(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    cash = _h(ctx["tokens"]["cashier"])
    r = _post(c, cash, URL, _body(text="الرقم 0912447099 لا يظهر في الفاتورة", kind="problem"))
    assert r.status_code == 201, r.content
    out = r.json()
    assert out["reference"].startswith("FB-") and out["status"] == "new"
    assert out["status_label"] == "جديدة" and out["kind_label"] == "مشكلة"
    assert "0912447099" not in out["text"] and "•••" in out["text"]
    # إعادة الإرسال بالمعرّف نفسه (الطابور المحلي) تعيد الأولى ولا تكرّر
    again = _post(c, cash, URL, _body(client_id=out["client_id"], text="غير ذلك"))
    assert again.status_code == 200 and again.json()["id"] == out["id"]
    with tenant_context(ctx["tenant"].id):
        assert Feedback.objects.count() == 1
        f = Feedback.objects.get()
        assert f.user_name == "أحمد ياسين" and f.device == ctx["device_ids"]["cashier"]
        assert f.platform == "web" and f.screen == "REP-01"
    # كل مستخدم يرى ملاحظاته هو
    mine = c.get(URL, headers=cash).json()
    assert [i["id"] for i in mine["items"]] == [out["id"]] and mine["unseen"] == 0
    assert c.get(URL, headers=_h(ctx["tokens"]["owner"])).json()["items"] == []
    # إشعار لفريق المنصة بلا رقم الهاتف
    with platform_context():
        n = OperatorNotice.objects.get(kind="feedback")
    assert out["reference"] in n.title and "0912447099" not in n.body
    assert n.href == "/platform/feedback"


def test_validation_and_limits(ctx: dict[str, Any]) -> None:  # noqa: F811
    c, h = Client(), _h(ctx["tokens"]["manager"])
    assert _post(c, h, URL, _body(kind="rating")).json()["detail"] == "kind_invalid"
    assert _post(c, h, URL, _body(text="   ")).json()["detail"] == "text_required"
    assert _post(c, h, URL, _body(text="س" * 1001)).json()["detail"] == "text_too_long"
    for _ in range(PER_USER_PER_DAY):
        assert _post(c, h, URL, _body()).status_code == 201
    r = _post(c, h, URL, _body())
    assert r.status_code == 429 and r.json()["detail"] == "rate_limited"
    # مستخدم آخر في المنشأة نفسها ما زال يستطيع
    assert _post(c, _h(ctx["tokens"]["owner"]), URL, _body()).status_code == 201
    assert c.get(URL).status_code in {401, 403}


def test_operator_lists_updates_and_sender_sees_reply(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    owner = _h(ctx["tokens"]["owner"])
    a = _post(c, owner, URL, _body(kind="suggestion")).json()
    _post(c, owner, URL, _body(kind="opinion", text="التطبيق سريع"))
    sup = _support_headers()
    # المالك لا يرى وارد المنصة
    assert c.get("/api/platform/feedback", headers=owner).status_code == 403
    body = c.get("/api/platform/feedback", headers=sup).json()
    assert body["filter"] == "open" and body["counts"]["new"] == 2 and len(body["items"]) == 2
    assert body["items"][0]["tenant_name"] == ctx["tenant"].name
    assert body["items"][0]["from_name"] == "عثمان الطيب"
    only = c.get("/api/platform/feedback?kind=opinion", headers=sup).json()
    assert [i["kind"] for i in only["items"]] == ["opinion"]
    # الدعم يردّ ويغيّر الحالة
    path = f"/api/platform/feedback/{ctx['tenant'].id}/{a['id']}"
    r = _post(c, sup, path, {"status": "studying", "reply": "سنضيفه في الإصدار القادم"})
    assert r.status_code == 200, r.content
    assert r.json()["status_label"] == "قيد الدراسة" and r.json()["updated_by_name"] == "طيب — دعم"
    assert (
        _post(c, sup, path, {"status": "studying", "reply": "سنضيفه في الإصدار القادم"}).status_code
        == 409
    )
    assert _post(c, sup, path, {"status": "x"}).json()["detail"] == "status_invalid"
    assert _post(c, sup, path, {"status": "done", "reply": "ر" * 601}).status_code == 400
    missing = f"/api/platform/feedback/{ctx['tenant'].id}/{uuid.uuid4()}"
    assert _post(c, sup, missing, {"status": "done"}).status_code == 404
    # المرسل يرى الردّ «جديداً» حتى يفتح القائمة
    mine = c.get(URL, headers=owner).json()
    row = next(i for i in mine["items"] if i["id"] == a["id"])
    assert row["reply"] == "سنضيفه في الإصدار القادم" and row["unseen"] is True
    assert mine["unseen"] == 1
    seen = _post(c, owner, f"{URL}/seen").json()
    assert seen["unseen"] == 0
    # «نُفّذت» يخرج من «مفتوحة»
    _post(c, sup, path, {"status": "done", "reply": "أُضيف"})
    assert len(c.get("/api/platform/feedback", headers=sup).json()["items"]) == 1
    done = c.get("/api/platform/feedback?status=done", headers=sup).json()
    assert [i["id"] for i in done["items"]] == [a["id"]] and done["counts"]["done"] == 1


def test_feedback_is_tenant_isolated(ctx: dict[str, Any], two_tenants: Any) -> None:  # noqa: F811
    c = Client()
    _post(c, _h(ctx["tokens"]["owner"]), URL, _body())
    with tenant_context(two_tenants.b.id):
        assert Feedback.objects.count() == 0

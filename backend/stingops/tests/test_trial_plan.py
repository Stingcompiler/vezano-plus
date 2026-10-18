"""0005 §١٧٠ (بأمر المالك 2026-10-18): التجريبية تُبنى على باقة تحدّدها إدارة المنصّة — ميزاتها
وحدودها وتجاوزاتها من الباقة الأساس، والمشغّل يحدّد الأساس والمدة فقط؛ لا تجريبية ثانية، ولا سعر
لها، ولا تُؤرشف الباقة التي تقوم عليها، والتجديد بعدها يقترح الباقة نفسها."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import Client

from core.subscription import PLANS
from core.tenancy import tenant_context
from core.tests.test_org import _h, _post, ctx  # noqa: F401
from stingops.tests.test_operator import _operator_headers

pytestmark = pytest.mark.django_db(transaction=True)

PLANS_URL = "/api/platform/plans"


def _plan(payload: dict[str, Any], code: str) -> dict[str, Any]:
    return next(p for p in payload["plans"] if p["code"] == code)


def _feature(ent: dict[str, Any], code: str) -> str:
    return str(next(f for f in ent["features"] if f["code"] == code)["status"])


def test_trial_follows_platform_chosen_base_plan(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    oh = _operator_headers("ops_trial", "هدى — تشغيل")
    owner = _h(ctx["tokens"]["owner"])
    with tenant_context(ctx["tenant"].id):
        from core.subscription import ensure_subscription

        assert ensure_subscription().plan_code == "trial"  # يُبذر تجريبياً كسولاً

    # البذر: التجريبية على «فرع واحد» — ميزاتها وحدودها ووصفها من الأساس
    cat = c.get(PLANS_URL, headers=oh).json()
    trial = _plan(cat, "trial")
    single = _plan(cat, "single")
    assert trial["trial_base_code"] == "single" and trial["trial_base_name"] == "فرع واحد"
    assert trial["features"] == sorted(single["features"])
    assert trial["max_devices"] == single["max_devices"]
    assert trial["blurb"].startswith("كل ميزات باقة «فرع واحد» لمدة 30 يوماً.")
    ent = c.get("/api/org/subscription", headers=owner).json()
    assert ent["plan"]["trial"] is True and ent["plan"]["trial_base_name"] == "فرع واحد"
    assert _feature(ent, "market_private_prices") == "locked"

    # المشغّل ينقل التجريبية إلى «فرعان» ويغيّر المدة → المستأجر التجريبي يرث فوراً
    r = _post(
        c,
        oh,
        f"{PLANS_URL}/trial/update",
        {"trial_base_code": "dual", "trial_days": 14, "reason": "عرض الإطلاق"},
    )
    assert r.status_code == 200, r.json()
    trial = _plan(r.json(), "trial")
    assert trial["trial_base_name"] == "فرعان" and trial["trial_days"] == 14
    assert r.json()["changes"][0]["changes"]["trial_base_code"] == {"from": "single", "to": "dual"}
    assert PLANS["trial"].max_branches == PLANS["dual"].max_branches
    ent = c.get("/api/org/subscription", headers=owner).json()
    assert _feature(ent, "market_private_prices") == "open"
    assert ent["limits"]["branches"]["max"] == PLANS["dual"].max_branches
    pub = c.get("/api/public/plans").json()
    assert "«فرعان» لمدة 14 يوماً" in _plan(pub, "trial")["blurb"]
    # التجديد بعد التجربة يقترح الباقة التي جرّبها
    due = c.get("/api/org/subscription/proofs", headers=owner).json()["due"]
    assert due["plan_code"] == "dual"

    # حدود ما يُحرَّر في صفّ التجريبية
    bad = {"features": ["pos_core"], "reason": "x"}
    assert _post(c, oh, f"{PLANS_URL}/trial/update", bad).json()["detail"] == "trial_derived"
    price = {"price_monthly_minor": 1, "reason": "x"}
    assert _post(c, oh, f"{PLANS_URL}/trial/update", price).json()["detail"] == "trial_derived"
    sched = _post(
        c,
        oh,
        f"{PLANS_URL}/trial/price",
        {"monthly_minor": 1, "effective_at": "2099-01-01T00:00:00Z", "reason": "x"},
    )
    assert sched.json()["detail"] == "trial_derived"
    for base in ("trial", "nope"):
        r = _post(c, oh, f"{PLANS_URL}/trial/update", {"trial_base_code": base, "reason": "x"})
        assert r.json()["detail"] == "trial_base_invalid"
    # لا تجريبية ثانية، ولا أساس/مدة على باقة مدفوعة
    r = _post(c, oh, f"{PLANS_URL}/single/update", {"trial": True, "reason": "x"})
    assert r.json()["detail"] == "trial_single"
    r = _post(c, oh, f"{PLANS_URL}/single/update", {"trial_days": 10, "reason": "x"})
    assert r.json()["detail"] == "trial_only"
    # الباقة التي تقوم عليها التجريبية لا تُؤرشف
    r = _post(c, oh, f"{PLANS_URL}/dual/update", {"is_active": False, "reason": "x"})
    assert r.json()["detail"] == "trial_base_in_use"
    # والاستحقاقات: لا عمود للتجريبية — ترث تجاوزات أساسها
    e = c.get("/api/platform/entitlements", headers=oh).json()
    assert "trial" not in [p["code"] for p in e["plans"]] and e["trial_base_name"] == "فرعان"
    r = _post(
        c,
        oh,
        "/api/platform/entitlements",
        {"plan_code": "trial", "feature": "campaigns", "enabled": False},
    )
    assert r.json()["detail"] == "trial_follows_base"
    r = _post(
        c,
        oh,
        "/api/platform/entitlements",
        {"plan_code": "dual", "feature": "campaigns", "enabled": False},
    )
    assert r.status_code == 200
    with tenant_context(ctx["tenant"].id):
        from core.subscription import has_feature

        assert has_feature("campaigns") is False  # تجاوز «فرعان» يسري على التجريبية المبنية عليها
    # ORG-06 تقول الشيء نفسه: تجاوز «قوائم أسعار خاصة» على «فرعان» يظهر «مغلق» للتجريبية
    r = _post(
        c,
        oh,
        "/api/platform/entitlements",
        {"plan_code": "dual", "feature": "market_private_prices", "enabled": False},
    )
    assert r.status_code == 200
    ent = c.get("/api/org/subscription", headers=owner).json()
    assert _feature(ent, "market_private_prices") == "locked"

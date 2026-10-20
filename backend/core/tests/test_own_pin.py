"""0005 §١٧٣ — المستخدم يضبط PIN بنفسه بعد تأكيد كلمة مروره، فيصل متحققه إلى أجهزة فرعه (ACC-07).

كان PIN يُضبط في البذر وحده — فالقفل المحلي لكل حساب حقيقي بلا رمز.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from django.test import Client

from core.auth.pin import Verifier, check_pin
from core.models import PinVerifier
from core.scenario import faults
from core.scenario.seed import DEMO_CASHIER_IDENTIFIER, reset_scenario
from core.tenancy import platform_context
from core.tests.test_sessions import Api, account_login

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("STING_ENV", "test")
    monkeypatch.setenv("STING_FAULTS_ENABLED", "1")
    faults.clear()
    yield


def test_user_sets_own_pin_after_password_and_device_receives_it() -> None:
    reset_scenario()
    client = Client()
    data = account_login(client, DEMO_CASHIER_IDENTIFIER)
    user = Api(client, data["access"])
    reg = user.post("/api/devices/register", {"name": "جوال الكاشير"}).json()
    device = Api(client, reg["access"])

    # كلمة مرور خاطئة: لا تغيير
    r = user.post("/api/account/pin", {"pin": "246810", "password": "wrong-password"})
    assert (r.status_code, r.json()["detail"]) == (403, "password_invalid")
    # رمز غير صالح (ليس ستة أرقام)
    from core.scenario.seed import DEMO_PASSWORD

    r = user.post("/api/account/pin", {"pin": "12ab", "password": DEMO_PASSWORD})
    assert (r.status_code, r.json()["detail"]) == (400, "pin_invalid")
    assert r.json()["extra"]["length"] == 6
    # الضبط الصحيح: متحقق لا نص، ويظهر في متحققات جهاز الفرع
    r = user.post("/api/account/pin", {"pin": "246810", "password": DEMO_PASSWORD})
    assert r.status_code == 204
    with platform_context():
        v = PinVerifier.unscoped.get(user_id=data["user_id"])
    assert "246810" not in v.encoded
    assert check_pin("246810", Verifier.decode(v.encoded))
    rows = device.get("/api/devices/verifiers").json()["verifiers"]
    mine = [x for x in rows if x["user_id"] == data["user_id"]]
    assert mine and mine[0]["encoded"] == v.encoded

    # بلا جلسة: ممنوع
    anon = Client().post(
        "/api/account/pin", {"pin": "246810", "password": "x"}, content_type="application/json"
    )
    assert anon.status_code in {401, 403}

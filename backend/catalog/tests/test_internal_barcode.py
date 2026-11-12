"""الباركود الداخلي (0005 §٢٦٩): EAN-13 بالبادئة 20 من عدّاد المنشأة على الخادم — لا يتكرر ولو لم
يُحفظ الأول، يتخطى ما كُتب يدوياً، والتوليد الجماعي للمالك ومدير الفرع على دفعات."""

from __future__ import annotations

from typing import Any

import pytest

from catalog import services
from catalog.models import InternalBarcodeCounter, Item
from catalog.tests.test_prices import Api, _env  # noqa: F401
from core.scenario.seed import FIXED
from core.tenancy import tenant_context

pytestmark = pytest.mark.django_db(transaction=True)


def _new_item(api: Api, name: str, barcode: str = "") -> dict[str, Any]:
    units = api.get("/api/catalog/units").json()["units"]
    piece = next(u for u in units if u["code"] == "piece")
    r = api.post(
        "/api/catalog/items", {"name": name, "base_unit_id": piece["id"], "barcode": barcode}
    )
    assert r.status_code == 201, r.json()
    return api.item(name)


def _valid_ean13(code: str) -> bool:
    if len(code) != 13 or not code.isdigit():
        return False
    return services.ean13_check_digit(code[:12]) == int(code[12])


def test_check_digit_and_format() -> None:
    assert services.ean13_check_digit("400638133393") == 1  # 4006381333931 مثال GS1 المعروف
    assert services.internal_barcode(1) == "2000000000015"
    assert services.internal_barcode(2) == "2000000000022"
    assert services.internal_barcode(9_999_999_999).startswith("209999999999")
    assert services.is_store_internal_barcode("2000000000015")
    assert services.is_store_internal_barcode("2512345000013")
    assert not services.is_store_internal_barcode("6291000000142")
    assert not services.is_store_internal_barcode("200123")


def test_generate_is_sequential_unique_and_skips_taken_codes() -> None:
    api = Api(owner=True)
    a = api.post("/api/catalog/barcode/generate", {}).json()["barcode"]
    b = api.post("/api/catalog/barcode/generate", {}).json()["barcode"]
    assert a == "2000000000015" and b == "2000000000022"  # الأول لم يُحفظ ولا يُعاد
    # رقم كتبه أحدهم يدوياً يُتخطّى
    _new_item(api, "حلاوة طحينية", barcode="2000000000039")
    c = api.post("/api/catalog/barcode/generate", {}).json()["barcode"]
    assert c == "2000000000046" and _valid_ean13(c)
    # المولَّد يُحفظ كأي باركود ويُرفض لصنف ثانٍ
    item = _new_item(api, "بسكويت", barcode=c)
    assert item["barcode"] == c
    units = api.get("/api/catalog/units").json()["units"]
    r = api.post(
        "/api/catalog/items",
        {"name": "بسكويت آخر", "base_unit_id": units[0]["id"], "barcode": c},
    )
    assert r.status_code == 400 and r.json()["errors"][0]["code"] == "barcode_taken"
    with tenant_context(FIXED["tenant_a"]):
        assert InternalBarcodeCounter.objects.get().last_value == 4


def test_cashier_generates_but_only_owner_or_manager_assigns_in_bulk() -> None:
    cashier = Api(owner=False)
    r = cashier.post("/api/catalog/barcode/generate", {})
    assert r.status_code == 200 and r.json()["barcode"].startswith("20")
    assert cashier.get("/api/catalog/items").json()["can_assign_barcodes"] is False
    r = cashier.post("/api/catalog/barcode/assign-missing", {})
    assert r.status_code == 403 and r.json()["detail"] == "barcode_owner_or_manager"


def test_bulk_assigns_active_items_in_batches(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(services, "ASSIGN_BATCH", 2)
    api = Api(owner=True)
    for n in ("عدس", "فول", "بليلة"):
        _new_item(api, n)
    inactive = _new_item(api, "صنف موقوف")
    r = api.client.post(
        f"/api/catalog/items/{inactive['id']}/active",
        {"is_active": False},
        content_type="application/json",
        **api.h,  # type: ignore[arg-type]
    )
    assert r.status_code == 200, r.json()
    listing = api.get("/api/catalog/items").json()
    assert listing["can_assign_barcodes"] is True and listing["missing_barcode_count"] == 3

    r = api.post("/api/catalog/barcode/assign-missing", {})
    assert r.status_code == 200 and r.json() == {"assigned": 2, "remaining": 1}
    r = api.post("/api/catalog/barcode/assign-missing", {})
    assert r.json() == {"assigned": 1, "remaining": 0}
    r = api.post("/api/catalog/barcode/assign-missing", {})
    assert r.json() == {"assigned": 0, "remaining": 0}

    codes = [api.item(n)["barcode"] for n in ("عدس", "فول", "بليلة")]
    assert len(set(codes)) == 3 and all(_valid_ean13(c) and c.startswith("20") for c in codes)
    assert api.item("صنف موقوف")["barcode"] == ""  # المعطَّل لا يُمسّ
    # الأصناف التي تحمل باركود المصنع لا تتغيّر
    assert api.item("سكر")["barcode"] == "6291000000142"
    with tenant_context(FIXED["tenant_a"]):
        assert Item.objects.filter(barcode="").count() == 1

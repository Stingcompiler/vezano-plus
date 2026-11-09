"""ترقيم قوائم المشغّل (0005 §٢٢٨): الصفحة ووصفها، والحدود، وصفحة خارج المدى تعود إلى الأقرب."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import Client
from rest_framework.test import APIRequestFactory

from core.tests.test_org import ctx  # noqa: F401
from stingops.paging import MAX_PAGE_SIZE, paginate
from stingops.tests.test_operator import _operator_headers

pytestmark = pytest.mark.django_db(transaction=True)


def _req(query: str) -> Any:
    from rest_framework.request import Request

    return Request(APIRequestFactory().get("/x" + query))


def test_paginate_slices_and_describes() -> None:
    rows = [{"i": i} for i in range(53)]
    out = paginate({"rows": list(rows), "count": 53}, "rows", _req("?page=3&page_size=25"))
    assert [r["i"] for r in out["rows"]] == [50, 51, 52]
    assert out["page"] == {"number": 3, "size": 25, "total": 53, "pages": 3}
    # العدّادات عن القائمة كلها لا عن الصفحة
    assert out["count"] == 53


def test_paginate_clamps_bad_input() -> None:
    rows = [{"i": i} for i in range(10)]
    out = paginate({"rows": list(rows)}, "rows", _req("?page=99&page_size=4"))
    assert out["page"] == {"number": 3, "size": 4, "total": 10, "pages": 3}
    out = paginate({"rows": list(rows)}, "rows", _req("?page=x&page_size=100000"))
    assert out["page"]["number"] == 1 and out["page"]["size"] == MAX_PAGE_SIZE
    empty = paginate({"rows": []}, "rows", _req("?page=1"))
    assert empty["page"] == {"number": 1, "size": 25, "total": 0, "pages": 1}
    # بلا `page`: القائمة كاملة لعميل أقدم أو شاشة تقسمها بنفسها
    whole = paginate({"rows": list(rows)}, "rows", _req(""))
    assert len(whole["rows"]) == 10 and whole["page"]["pages"] == 1


def test_tenants_list_is_paged(ctx: dict[str, Any]) -> None:  # noqa: F811
    c = Client()
    h = _operator_headers("paging-op", "مشغّل الترقيم")
    body = c.get("/api/platform/tenants?page=1&page_size=1", headers=h).json()
    assert body["page"]["size"] == 1 and len(body["tenants"]) == 1
    assert body["page"]["total"] == body["total"] or body["page"]["total"] >= 1

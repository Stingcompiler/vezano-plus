"""ترقيم صفحات قوائم المشغّل (0005 §٢٢٨).

القائمة تُحسب كما كانت (بفلاترها وعدّاداتها)، ثم يُعاد منها جزء الصفحة المطلوبة ومعه وصف الصفحة:
`{"page": {"number", "size", "total", "pages"}}`. العدّادات في الحمولة (المعلّق، الجديد…) تبقى عن
القائمة كلها لا عن الصفحة. صفحة خارج المدى تعود إلى أقرب صفحة صالحة بدل قائمة فارغة.
بلا `page` في الاستعلام تعود القائمة كاملة: العملاء الأقدم والشاشات التي تقسم القائمة
بنفسها لا تتأثّر.
"""

from __future__ import annotations

from typing import Any

from drf_spectacular.utils import OpenApiParameter
from rest_framework.request import Request

PAGE_SIZE = 25
MAX_PAGE_SIZE = 100

#: معاملا الاستعلام لكل قائمة مرقّمة — يُضافان إلى `extend_schema(parameters=…)`
PAGE_PARAMS = [
    OpenApiParameter("page", int, OpenApiParameter.QUERY, required=False),
    OpenApiParameter("page_size", int, OpenApiParameter.QUERY, required=False),
]


def _int(raw: Any, default: int) -> int:
    try:
        return int(str(raw))
    except (TypeError, ValueError):
        return default


def paginate(payload: dict[str, Any], key: str, request: Request) -> dict[str, Any]:
    """يقصّ `payload[key]` إلى الصفحة المطلوبة ويضيف `page`. يعيد الحمولة نفسها معدّلة."""
    rows = payload.get(key) or []
    total = len(rows)
    if "page" not in request.query_params:
        # شاشة لم تطلب صفحة (أو عميل أقدم: الجوال، نسخة حاسوب لم تتحدّث): القائمة كاملة كما كانت
        payload["page"] = {"number": 1, "size": max(total, 1), "total": total, "pages": 1}
        return payload
    size = min(max(_int(request.query_params.get("page_size"), PAGE_SIZE), 1), MAX_PAGE_SIZE)
    pages = max((total + size - 1) // size, 1)
    number = min(max(_int(request.query_params.get("page"), 1), 1), pages)
    start = (number - 1) * size
    payload[key] = rows[start : start + size]
    payload["page"] = {"number": number, "size": size, "total": total, "pages": pages}
    return payload

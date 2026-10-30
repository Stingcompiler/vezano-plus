"""CORS لتطبيق الحاسوب وحده (docs/desktop-plan.md ط٣، 0005 §٢٠٧).

الويب على نطاق الخادم نفسه فلا يحتاج CORS. تطبيق Tauri يرسم شاشاته من أصل محلي — `tauri://localhost`
على ماك و`http://tauri.localhost` على ويندوز — ويطلب `/api` بـ`Authorization: Bearer`. يُسمح لهذين
الأصلين وحدهما، على مسارات `/api/` وحدها، وبلا Cookies (`Allow-Credentials` غير مُرسل):
الجلسة في مخزن مفاتيح النظام لا في Cookie، فلا يفتح هذا باباً لطلبات مُزوَّرة بهوية المتصفح.
"""

from __future__ import annotations

from collections.abc import Callable

from django.conf import settings
from django.http import HttpRequest, HttpResponse

ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
ALLOWED_HEADERS = "Authorization, Content-Type, X-Select-Ticket"
MAX_AGE = "600"


class DesktopCorsMiddleware:
    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        origin = request.headers.get("Origin", "")
        allowed = request.path.startswith("/api/") and origin in settings.DESKTOP_ORIGINS
        if (
            allowed
            and request.method == "OPTIONS"
            and "Access-Control-Request-Method" in request.headers
        ):
            response = HttpResponse(status=204)
            response["Access-Control-Allow-Methods"] = ALLOWED_METHODS
            response["Access-Control-Allow-Headers"] = ALLOWED_HEADERS
            response["Access-Control-Max-Age"] = MAX_AGE
        else:
            response = self.get_response(request)
        if allowed:
            response["Access-Control-Allow-Origin"] = origin
        if request.path.startswith("/api/"):
            # الكاش الوسيط لا يعيد رداً بترويسة أصلٍ لأصلٍ آخر
            response["Vary"] = ", ".join(filter(None, [response.get("Vary", ""), "Origin"]))
        return response

"""الدولة التي يعمل منها كل مستأجر (0005 §٢٢٩).

بعد ردّ ناجح على طلب بجلسة متجر، تُستخرج الدولة من عنوان الطلب (DB-IP Lite كتحليلات الزوار) وتُكتب
في `Tenant.last_country` — مرة في الساعة لكل مستأجر في كل عملية على الأكثر، فلا كتابة مع كل طلب.
العنوان نفسه لا يُحفظ، والعنوان الخاص أو المجهول لا يمسح دولة معروفة.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from django.core.cache import cache
from django.http import HttpRequest, HttpResponse
from django.utils import timezone

log = logging.getLogger(__name__)

#: ثوانٍ بين كتابتين لمستأجر واحد
EVERY_SECONDS = 3600


def note(tenant_id: Any, ip: str) -> bool:
    """يكتب دولة المستأجر إن مضت الساعة؛ يعيد True إن كتب."""
    from core.models import Tenant
    from core.tenancy import platform_context
    from stingops.analytics import country_of

    if not cache.add(f"tenant-country:{tenant_id}", 1, EVERY_SECONDS):
        return False
    code = country_of(ip)
    if not code:
        return False
    with platform_context():
        Tenant.unscoped.filter(id=tenant_id).update(
            last_country=code, last_country_at=timezone.now()
        )
    return True


class TenantCountryMiddleware:
    """يقرأ هوية الطلب بعد أن صادقه DRF (يضع `auth` على الطلب الأصلي)، فلا يكرّر المصادقة."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> Any:
        response = self.get_response(request)
        try:
            auth = getattr(request, "auth", None)
            tenant_id = getattr(auth, "tenant_id", None)
            if tenant_id is not None and 200 <= response.status_code < 300:
                from core.public_views import client_ip

                note(tenant_id, client_ip(request))  # type: ignore[arg-type]
        except Exception:  # noqa: BLE001 — تسجيل الدولة لا يُسقط طلباً
            log.warning("tenant_country_failed", exc_info=True)
        return response

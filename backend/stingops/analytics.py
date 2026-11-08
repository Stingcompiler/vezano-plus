"""PLT-19 — تحليلات زوار الصفحات العامة (بأمر المالك 2026-11-08؛ 0005 §٢١٩).

عدّ بلا كوكيز ولا هوية:
- الزيارة تصل من إشارة خفيفة في الصفحات العامة (`/api/public/beacon`)، ولا تُرسل أصلاً إن طلب
  المتصفح «عدم التتبّع» أو GPC.
- عنوان الشبكة يُستعمل لحظة الوصول لاستخراج الدولة (DB-IP Lite) وللبصمة اليومية، ثم يُرمى.
- البصمة HMAC بمفتاح الخادم واليوم: تعدّ الزائر مرة في اليوم ولا تربط يومين.

التقرير للمشغّل: الزيارات والزوار يومياً مع الفترة السابقة، والدول والصفحات والمصادر والأجهزة، ومسار
التحويل حتى المتجر الجديد والدفع الأول — الخطوتان الأخيرتان من السجلّ لا من الإشارة.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import logging
import re
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone
from functools import lru_cache
from typing import Any
from urllib.parse import parse_qs, urlsplit

from django.conf import settings
from django.db.models import CharField, Count, Min
from django.db.models.functions import Cast, Concat
from django.utils import timezone

from core.models import SubscriptionReceipt, Tenant
from core.tenancy import platform_context
from stingops.models import SiteVisit

log = logging.getLogger(__name__)

#: الخرطوم UTC+2 بلا توقيت صيفي — اليوم يُحسب بتوقيت التاجر لا UTC
KHARTOUM = dt_timezone(timedelta(hours=2))
RANGES = (7, 30, 90)
#: سقف إشارات زائر واحد في اليوم: ما فوقه آلي أو عبث، ولا يُضخّم العدّ
MAX_PER_VISITOR_DAY = 300
BOT_UA = re.compile(
    r"bot|crawl|spider|slurp|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|"
    r"httpclient|preview|facebookexternalhit|whatsapp|telegram",
    re.IGNORECASE,
)
TABLET_UA = re.compile(r"ipad|tablet|(android(?!.*mobile))", re.IGNORECASE)
MOBILE_UA = re.compile(r"mobi|iphone|android", re.IGNORECASE)
#: المسار الذي يعني «بدأ التسجيل» في مسار التحويل
SIGNUP_PATH = "/register"
SELF_HOSTS = {"plus.vezano.app", "localhost", "127.0.0.1"}


def today_local(now: datetime | None = None) -> date:
    return (now or timezone.now()).astimezone(KHARTOUM).date()


@lru_cache(maxsize=1)
def _reader() -> Any:
    """قارئ قاعدة الدولة — مرة لكل عملية. غيابها (التطوير أو تعذّر التنزيل) يعيد None."""
    path = settings.GEOIP_DB
    if not path.is_file():
        return None
    try:
        import maxminddb

        return maxminddb.open_database(str(path))
    except Exception:  # noqa: BLE001 — قاعدة تالفة لا توقف العدّ
        log.warning("geoip_open_failed", exc_info=True)
        return None


def country_of(ip: str) -> str:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return ""
    if addr.is_private or addr.is_loopback:
        return ""
    reader = _reader()
    if reader is None:
        return ""
    try:
        rec = reader.get(ip)
    except Exception:  # noqa: BLE001
        return ""
    code = ""
    if isinstance(rec, dict):
        country = rec.get("country")
        if isinstance(country, dict):
            code = str(country.get("iso_code") or "")
    return code.upper() if re.fullmatch(r"[A-Za-z]{2}", code) else ""


def visitor_key(ip: str, ua: str, day: date) -> str:
    """بصمة يومية: لا تُعكس إلى العنوان، ويتغيّر مفتاحها كل يوم."""
    key = hmac.new(
        settings.SECRET_KEY.encode(), f"visit:{day.isoformat()}".encode(), hashlib.sha256
    ).digest()
    return hmac.new(key, f"{ip}|{ua}".encode(), hashlib.sha256).hexdigest()[:16]


def is_bot(ua: str) -> bool:
    return not ua or bool(BOT_UA.search(ua))


def device_of(ua: str) -> str:
    if TABLET_UA.search(ua):
        return "tablet"
    if MOBILE_UA.search(ua):
        return "mobile"
    return "desktop"


def clean_path(raw: str) -> str:
    """المسار وحده: بلا استعلام ولا مرساة، وبلا معرّفات طويلة (رموز الدعوة ونحوها)."""
    path = urlsplit(raw or "/").path or "/"
    if not path.startswith("/"):
        path = "/" + path
    parts = [
        ":id" if re.fullmatch(r"[0-9a-fA-F-]{16,}|[A-Za-z0-9_-]{24,}", p) else p
        for p in path.split("/")
    ]
    path = "/".join(parts)
    if len(path) > 1:
        path = path.rstrip("/")
    return path[:200]


def source_of(page_url: str, referrer: str) -> str:
    """`utm_source` إن وُجد، وإلا مضيف المُحيل من خارج الموقع، وإلا «مباشر» (فارغ)."""
    query = parse_qs(urlsplit(page_url or "").query)
    utm = (query.get("utm_source") or [""])[0].strip().lower()
    if utm:
        return re.sub(r"[^a-z0-9._-]", "", utm)[:80]
    host = (urlsplit(referrer or "").hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if not host or host in SELF_HOSTS or host.endswith(".vezano.app"):
        return ""
    return host[:80]


def record(*, ip: str, ua: str, page_url: str, referrer: str) -> bool:
    """يسجّل زيارة؛ False إن رُفضت (آلي أو تجاوز السقف). لا يحفظ العنوان ولا المتصفح."""
    if is_bot(ua):
        return False
    now = timezone.now()
    day = today_local(now)
    visitor = visitor_key(ip, ua, day)
    if SiteVisit.objects.filter(day=day, visitor=visitor).count() >= MAX_PER_VISITOR_DAY:
        return False
    SiteVisit.objects.create(
        day=day,
        occurred_at=now,
        path=clean_path(page_url),
        country=country_of(ip),
        source=source_of(page_url, referrer),
        device=device_of(ua),
        visitor=visitor,
    )
    return True


def prune(now: datetime | None = None) -> int:
    cutoff = today_local(now) - timedelta(days=settings.ANALYTICS_RETENTION_DAYS)
    deleted, _ = SiteVisit.objects.filter(day__lt=cutoff).delete()
    return deleted


# ------------------------------------------------------------------ التقرير


def _visitors(qs: Any) -> int:
    """الزائر يُعدّ مرة في اليوم: أزواج (اليوم، البصمة) المختلفة."""
    return int(qs.values("day", "visitor").distinct().count())


def _pair() -> Concat:
    """(اليوم، البصمة) نصاً واحداً لعدّ الزائر مرة في كل يوم عبر فترة."""
    return Concat(Cast("day", output_field=CharField()), "visitor", output_field=CharField())


def _top(qs: Any, field: str, limit: int) -> list[dict[str, Any]]:
    rows = (
        qs.annotate(k=_pair())
        .values(field)
        .annotate(visitors=Count("k", distinct=True), views=Count("id"))
        .order_by("-visitors", "-views", field)
    )
    out = [
        {"key": r[field], "visitors": int(r["visitors"]), "views": int(r["views"])} for r in rows
    ]
    if len(out) <= limit:
        return out
    rest = out[limit:]
    return [
        *out[:limit],
        {
            "key": "*",
            "visitors": sum(r["visitors"] for r in rest),
            "views": sum(r["views"] for r in rest),
        },
    ]


def _start_of(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, tzinfo=KHARTOUM)


def report(days: int, now: datetime | None = None) -> dict[str, Any]:
    if days not in RANGES:
        days = RANGES[0]
    end = today_local(now)
    start = end - timedelta(days=days - 1)
    prev_start = start - timedelta(days=days)
    qs = SiteVisit.objects.filter(day__gte=start, day__lte=end)
    prev = SiteVisit.objects.filter(day__gte=prev_start, day__lt=start)

    per_day = {
        r["day"]: r
        for r in qs.values("day").annotate(
            views=Count("id"), visitors=Count("visitor", distinct=True)
        )
    }
    daily: list[dict[str, Any]] = []
    for i in range(days):
        d = start + timedelta(days=i)
        r = per_day.get(d)
        daily.append(
            {
                "day": d.isoformat(),
                "views": int(r["views"]) if r else 0,
                "visitors": int(r["visitors"]) if r else 0,
            }
        )

    visitors = sum(r["visitors"] for r in daily)
    signup = _visitors(qs.filter(path__startswith=SIGNUP_PATH))
    window_from, window_to = _start_of(start), _start_of(end + timedelta(days=1))
    with platform_context():
        new_stores = Tenant.unscoped.filter(
            created_at__gte=window_from, created_at__lt=window_to
        ).count()
        first_paid = (
            SubscriptionReceipt.unscoped.values("tenant_id")
            .annotate(first=Min("issued_at"))
            .filter(first__gte=window_from, first__lt=window_to)
            .count()
        )
    return {
        "range": {"days": days, "from": start.isoformat(), "to": end.isoformat()},
        "totals": {
            "views": sum(r["views"] for r in daily),
            "visitors": visitors,
            "prev_views": prev.count(),
            "prev_visitors": _visitors(prev),
        },
        "daily": daily,
        "countries": _top(qs, "country", 10),
        "pages": _top(qs, "path", 10),
        "sources": _top(qs, "source", 8),
        "devices": _top(qs, "device", 3),
        "funnel": [
            {"key": "visitors", "label": "زاروا الموقع", "value": visitors},
            {"key": "signup", "label": "فتحوا صفحة التسجيل", "value": signup},
            {"key": "stores", "label": "أنشؤوا متجراً", "value": new_stores},
            {"key": "paid", "label": "دفعوا أول اشتراك", "value": first_paid},
        ],
        "geo_ready": _reader() is not None,
        "retention_days": settings.ANALYTICS_RETENTION_DAYS,
    }

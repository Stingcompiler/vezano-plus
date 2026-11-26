"""الرئيسية والبحث العام (HOME-01/02/03): سجلّ مزوّدين تُسهم فيه الوحدات حين تُبنى.

- كل رقم يحمل مصدره (رابطاً) ووقته (R-01)؛ لا بطاقة مؤشر بلا مصدر.
- رئيسية الموظف ليست رئيسية المالك منقوصة: بطاقاتها مهامه، والمحجوب لا يُعرض رمادياً بل لا يُعرض.
- البحث لا يُظهر ما لا يُفتح؛ داخل المنشأة يُعلَن العدد والنوع بلا محتوى، وخارجها لا شيء.

حتى تُبنى POS/PTY/INV/CAT، المزوّدون المسجَّلون هنا: المزامنة (المعلّق على أجهزة المنشأة)
والورديات (لاحقاً). البقية تُضيف مزوّديها في مهامها.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from typing import Any

from django.utils import timezone

from core.models import Branch, Device, Role, Session, Tenant, User, UserBranchAccess

# ---------- الأدوار والصلاحيات ----------

#: «يرى المال» (تقارير المبيعات والصندوق والمخزون، والمعلّق على الأجهزة) — ليس من مفاتيح المصفوفة.
#: البيع والذمم والسداد وغيرها من `core.permissions.can` (مصفوفة ORG-02 · 0005 §٢٩٢).
FINANCE_ROLES = {"owner", "manager"}


@dataclass(frozen=True)
class Viewer:
    user: User
    is_owner: bool
    role_code: str
    role_name: str
    branch: Branch | None
    device: Device | None

    @property
    def can_sell(self) -> bool:
        from core.permissions import can

        return can(self, "sell").allowed

    @property
    def can_see_finance(self) -> bool:
        return self.is_owner or self.role_code in FINANCE_ROLES


def viewer_for(user: User, device: Device | None) -> Viewer:
    # الدور من العضوية في فرع الجهاز: مدير في فرع وكاشير في آخر هو كاشير على جهاز الثاني، وبلا
    # عضوية في فرع الجهاز لا دور له فيه (مراجعة 2026-11-05 بند ٩). بلا جهاز: أقدم عضوية كما كان.
    memberships = UserBranchAccess.objects.filter(user=user, revoked_at__isnull=True)
    if device is not None and device.branch_id is not None:
        memberships = memberships.filter(branch_id=device.branch_id)
    access = memberships.select_related("role", "branch").order_by("granted_at").first()
    role: Role | None = access.role if access else None
    branch = device.branch if device else (access.branch if access else None)
    return Viewer(
        user=user,
        is_owner=user.is_owner,
        role_code=role.code if role else ("owner" if user.is_owner else ""),
        role_name="مالك" if user.is_owner else (role.name if role else ""),
        branch=branch,
        device=device,
    )


# ---------- سجلّ المزوّدين ----------

Provider = Callable[[Viewer, dict[str, Any]], None]
HOME_PROVIDERS: list[Provider] = []
SEARCH_PROVIDERS: list[Callable[[Viewer, str, dict[str, Any]], None]] = []


def home_provider(fn: Provider) -> Provider:
    HOME_PROVIDERS.append(fn)
    return fn


def _pending_attention(viewer: Viewer, out: dict[str, Any]) -> None:
    """المزامنة: أجهزة المنشأة التي أبلغت معلّقاً (Session.reported_pending) — للمالك والمدير."""
    if not viewer.can_see_finance:
        return
    now = timezone.now()
    for s in (
        Session.objects.filter(
            device__isnull=False, revoked_at__isnull=True, reported_pending__gt=0
        )
        .select_related("device")
        .order_by("-reported_pending")
    ):
        minutes = int((now - (s.reported_pending_at or now)).total_seconds() // 60)
        out["attention"].append(
            {
                "id": f"pending:{s.id}",
                "title_count": s.reported_pending,
                "title": "عمليات معلقة منذ",
                "minutes": minutes,
                "detail": f"{s.device.name if s.device else ''} — لا اتصال بالخادم",
                "action": "مركز المزامنة",
                "href": "/sync",
            }
        )


HOME_PROVIDERS.append(_pending_attention)


def money_short(minor: int) -> str:
    """مبلغ بطاقة/قرار في الرئيسية: الجنيه الكامل بلا «.00» والعملة ظاهرة (0005 §١٢٨)."""
    whole, frac = divmod(abs(minor), 100)
    text = f"{whole:,}" if frac == 0 else f"{whole:,}.{frac:02d}"
    return f"{'−' if minor < 0 else ''}{text} ج.س"


def counted(n: int, one: str, two: str, few: str, many: str) -> str:
    """العدد مع معدوده كما يُقرأ: «صنف نفد»، «صنفان نفدا»، «3 أصناف نفدت»، «12 صنفاً نفد»."""
    if n == 1:
        return one
    if n == 2:
        return two
    return f"{n} {few if 3 <= n % 100 <= 10 else many}"


def _quarantine_decision(viewer: Viewer, out: dict[str, Any]) -> None:
    """«قرارات تنتظرك»: عمليات محجوزة (تعارض أو رفض) لم تُحسم — لمن يحسمها في المصفوفة
    (`conflict_review`، SYS-03)."""
    from core.permissions import can

    if not can(viewer, "conflict_review"):
        return
    from sync.models import QuarantinedOperation

    n = QuarantinedOperation.objects.filter(reviewed_at__isnull=True).count()
    if n:
        out["decisions"].append(
            {
                "id": "quarantine",
                "title": counted(
                    n,
                    "عملية محجوزة تنتظر حسمك",
                    "عمليتان محجوزتان تنتظران حسمك",
                    "عمليات محجوزة تنتظر حسمك",
                    "عملية محجوزة تنتظر حسمك",
                ),
                "detail": "النسختان محفوظتان — لا شيء يُحذف قبل قرارك",
                "action": "راجع التعارضات",
                "href": "/sync/review",
                "severity": "danger",
            }
        )


def _approvals_decision(viewer: Viewer, out: dict[str, Any]) -> None:
    """«طلبات تنتظرك» (S-04؛ 0005 §٢٩٣): سحب وخصم وتجاوز حدّ ائتمان بانتظار من يملك قرارها."""
    if not viewer.can_see_finance:
        return
    from core import approvals

    branch_id = None if viewer.is_owner or viewer.branch is None else viewer.branch.id
    items = [i for i in approvals.inbox(viewer.user, branch_id) if i.get("can_decide")]
    if not items:
        return
    first = items[0]
    out["decisions"].append(
        {
            "id": "approvals",
            "title": counted(
                len(items),
                "طلب ينتظر قرارك",
                "طلبان ينتظران قرارك",
                "طلبات تنتظر قرارك",
                "طلباً ينتظر قرارك",
            ),
            "detail": (
                f"طلب {approvals.KIND_WORDS[first['kind']]}"
                f" {money_short(int(first['amount_minor']))} من {first['requested_by_name']}"
            ),
            "action": "طلبات تنتظرك",
            "href": "/approvals",
            "severity": "warn",
        }
    )


def _market_decisions(viewer: Viewer, out: dict[str, Any]) -> None:
    """عروض أسعار من الموردين تنتظر قبول المشتري (الطلب ملك المشتري)."""
    if not viewer.can_see_finance:
        return
    from market.models import MarketOrder

    for o in MarketOrder.objects.filter(status=MarketOrder.Status.QUOTED).order_by("created_at")[
        :3
    ]:
        out["decisions"].append(
            {
                "id": f"market-quote:{o.id}",
                "title": f"عرض سعر من {o.supplier_name} ينتظر قبولك",
                "detail": f"طلب السوق {o.number}",
                "action": "قارن واقبل",
                "href": f"/market/orders/{o.id}",
                "severity": "warn",
            }
        )


HOME_PROVIDERS.append(_quarantine_decision)
HOME_PROVIDERS.append(_approvals_decision)
HOME_PROVIDERS.append(_market_decisions)


#: فترات الرئيسية (HOME-01) — مفاتيح مدى تقرير المبيعات نفسه (`sales.reports.parse_range`)
HOME_PERIODS = ("today", "7d", "month")
#: قيمة «كل الفروع» في مرشّح الفرع (الفارغ = الافتراضي: فرع الجهاز أو كل الفروع)
ALL_BRANCHES = "all"


def home_branch(viewer: Viewer, branch_id: str, branches: list[Branch]) -> Branch | None:
    """نطاق أرقام الرئيسية (مراجعة التقارير R-01/R-02 — 0005 §٢٩١). None = كل الفروع.

    المالك: فرعٌ يختاره، أو «all»، وبلا اختيار فرعُ جهازه إن كان على جهاز فرع وإلا كل الفروع —
    لا أقدم عضوية له (كانت تعرض فرعاً واحداً تحت «كل الفروع»). غير المالك: فرعه دائماً، والمرشّح
    لا يوسّع نطاقه. هذا نطاق الرئيسية وحدها: `viewer.branch` لبقية الشاشات والصلاحيات لا يتغيّر."""
    if not viewer.is_owner:
        return viewer.branch
    if branch_id == ALL_BRANCHES:
        return None
    chosen = next((b for b in branches if str(b.id) == branch_id), None)
    if chosen is not None:
        return chosen
    if viewer.device is not None and viewer.device.branch_id is not None:
        return next((b for b in branches if b.id == viewer.device.branch_id), viewer.device.branch)
    return None


def home_summary(
    tenant_id: uuid.UUID, viewer: Viewer, *, period: str = "today", branch_id: str = ""
) -> dict[str, Any]:
    from core.permissions import can, rules_payload

    tenant = Tenant.objects.get(id=tenant_id)
    branches = list(Branch.objects.filter(is_active=True).order_by("created_at"))
    devices_pending = Session.objects.filter(
        device__isnull=False, revoked_at__isnull=True, reported_pending__gt=0
    ).exists()
    # فحص 2026-10-17 F08: «كلها زامنت» بلا أي جهاز ليست حقيقة — العدد يميّز «لا أجهزة بعد»
    devices_total = Device.objects.filter(status=Device.Status.ACTIVE).count()
    period = period if period in HOME_PERIODS else "today"
    scope_branch = home_branch(viewer, branch_id, branches)
    # المزوّدون يرون نطاق الرئيسية في `viewer.branch` (None = كل الفروع) — نسخة للرئيسية وحدها
    scoped = replace(viewer, branch=scope_branch)
    out: dict[str, Any] = {
        "kind": "owner" if viewer.can_see_finance else "employee",
        "tenant_name": tenant.name,
        "user": {
            "display_name": viewer.user.display_name,
            "role_name": viewer.role_name,
            "branch_name": viewer.branch.name if viewer.branch else "",
            "device_name": viewer.device.name if viewer.device else "",
        },
        "period": period,
        "branch_id": str(scope_branch.id) if scope_branch is not None else ALL_BRANCHES,
        "scope": {
            "kind": "branch" if scope_branch is not None else "all",
            "branch_id": str(scope_branch.id) if scope_branch is not None else "",
            "branch_name": scope_branch.name if scope_branch is not None else "",
            "can_choose": viewer.is_owner,
        },
        "branches": [{"id": str(b.id), "name": b.name} for b in branches],
        "branches_synced": not devices_pending,
        "devices_total": devices_total,
        "coverage_at": timezone.now().isoformat().replace("+00:00", "Z"),
        "decisions": [],
        "kpis": [],
        "attention": [],
        "tasks": [],
        # الأفعال السريعة بقرار المصفوفة نفسه الذي تقرّره شاشاتها (0005 §٢٩٢)
        "quick_actions": [
            a
            for a, key in (("sale", "sell"), ("payment", "record_payment"), ("return", "refund"))
            if can(viewer, key)
        ],
        "can_see_finance": viewer.can_see_finance,
        "permissions": rules_payload(viewer),
        "margin_locked": True,
        "shift": None,
    }
    for provider in HOME_PROVIDERS:
        provider(scoped, out)
    # الأخطر أولاً (ترتيب مستقر داخل كل درجة)
    out["decisions"].sort(key=lambda d: 0 if d.get("severity") == "danger" else 1)
    out["decisions_count"] = len(out["decisions"])
    return out


SEARCH_KINDS: tuple[tuple[str, str], ...] = (
    ("parties", "أطراف"),
    ("documents", "مستندات"),
    ("items", "أصناف"),
)


def search(viewer: Viewer, q: str) -> dict[str, Any]:
    """الأنواع بترتيب ثابت لا يتبدّل بعدد النتائج؛ المحجوب داخل المنشأة يُعدّ ولا يُعرض."""
    started = timezone.now()
    out: dict[str, Any] = {
        "query": q,
        "groups": [{"kind": k, "label": label, "results": []} for k, label in SEARCH_KINDS],
        "restricted": [],
        "suggestions": {
            "nearest": [],
            "other_branches": len(Branch.objects.all()) > 1,
            "create": True,
        },
    }
    for provider in SEARCH_PROVIDERS:
        provider(viewer, q, out)
    out["total"] = sum(len(g["results"]) for g in out["groups"])
    out["kinds_with_results"] = sum(1 for g in out["groups"] if g["results"])
    out["elapsed_ms"] = int((timezone.now() - started).total_seconds() * 1000)
    return out


@dataclass
class NoticeList:
    items: list[dict[str, Any]] = field(default_factory=list)


def notices(tenant_id: uuid.UUID, viewer: Viewer) -> dict[str, Any]:
    """إشعارات سريعة: ما يحتاج فعلاً من الرئيسية (قرارات وانتباه) بوقته."""
    summary = home_summary(tenant_id, viewer)
    items: list[dict[str, Any]] = []
    for d in summary["decisions"]:
        items.append({**d, "needs_action": True})
    for a in summary["attention"]:
        items.append({**a, "needs_action": True})
    return {"items": items, "needs_action": sum(1 for i in items if i["needs_action"])}

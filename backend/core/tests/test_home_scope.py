"""مراجعة التقارير 2026-11-22، المرحلتان ١–٢ (0005 §٢٩١).

R-01: رئيسية المالك بلا جهاز = كل الفروع (لا أقدم عضوية)، وعلى جهاز فرع = فرع الجهاز معلَناً.
R-02: مرشّحا الفترة والفرع يغيّران الأرقام فعلاً؛ المدير والكاشير على فرعهما مهما طلبا.
R-03: «صافي المبيعات» في الرئيسية = صافي تقرير المبيعات للمدى والفرع نفسيهما (المرتجع مطروح،
والملغى بمستند عكسي خارج).
R-04: يوم العمل بتوقيت الخرطوم — منتصف الليل الفاصل 22:00 UTC لا 00:00 UTC.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from conftest import _install_clock
from core import home
from core.auth.devices import register_device
from core.models import Role, User, UserBranchAccess
from core.tenancy import platform_context, tenant_context
from sales.models import Sale, SaleReturn, SaleReversal
from sales.reports import parse_range, sales_report
from sales.tests.test_sale import ctx, do_push, sale_op  # noqa: F401
from shifts.tests.test_shifts import shift_open

pytestmark = pytest.mark.django_db(transaction=True)


def _sale(c: dict[str, Any], *, invoice: str, day: date, price: str = "10000") -> Sale:
    op = sale_op(c, invoice=invoice, price=price)
    head = op["members"][0]["payload"]
    head["business_date"] = day.isoformat()
    head["occurred_at"] = f"{day.isoformat()}T08:34:00Z"
    assert do_push(c, op) == ["accepted"]
    with tenant_context(c["tenant"].id):
        sale: Sale = Sale.objects.get(invoice_number=invoice)
    return sale


def _return(c: dict[str, Any], sale: Sale, *, number: str, total: int, day: date) -> None:
    with tenant_context(c["tenant"].id):
        SaleReturn.objects.create(
            tenant_id=c["tenant"].id,
            sale=sale,
            return_number=number,
            branch_id=sale.branch_id,
            device_id=sale.device_id,
            user_id=c["owner"].id,
            condition="good",
            destination="cash",
            total_minor=total,
            cash_minor=total,
            business_date=day,
        )


def _reverse(c: dict[str, Any], sale: Sale) -> None:
    with tenant_context(c["tenant"].id):
        SaleReversal.objects.create(
            tenant_id=c["tenant"].id,
            sale=sale,
            branch_id=sale.branch_id,
            reason="فاتورة مكرّرة",
            decided_by_user_id=c["owner"].id,
        )


@pytest.fixture
def two(ctx: dict[str, Any], two_tenants: Any) -> dict[str, Any]:  # noqa: F811
    """فرعان: الرئيسي (جهاز `ctx`) وبحري (جهاز ثانٍ)، ومديرة في الرئيسي."""
    bahri = two_tenants.a_branches[1]
    with platform_context():
        owner_role = Role.unscoped.get(tenant=ctx["tenant"], code="owner")
        UserBranchAccess.unscoped.create(
            tenant=ctx["tenant"], user=ctx["owner"], branch=bahri, role=owner_role
        )
        mgr_role = Role.unscoped.create(tenant=ctx["tenant"], code="manager", name="مدير")
        manager = User.objects.create_user(
            tenant=ctx["tenant"], username="sara", display_name="سارة"
        )
        UserBranchAccess.unscoped.create(
            tenant=ctx["tenant"], user=manager, branch=ctx["branch"], role=mgr_role
        )
    with tenant_context(ctx["tenant"].id):
        reg = register_device(user=ctx["owner"], branch=bahri, name="كاشير بحري")
    c2 = {**ctx, "branch": bahri, "device": reg.device}
    return {"c1": ctx, "c2": c2, "bahri": bahri, "manager": manager}


def _home(c: dict[str, Any], viewer: home.Viewer, **kw: str) -> dict[str, Any]:
    with tenant_context(c["tenant"].id):
        return home.home_summary(c["tenant"].id, viewer, **kw)


def _kpi(out: dict[str, Any], key: str) -> dict[str, Any] | None:
    return next((k for k in out["kpis"] if k["key"] == key), None)


def _report_net(c: dict[str, Any], viewer: home.Viewer, key: str, branch_id: Any = None) -> str:
    with tenant_context(c["tenant"].id):
        rng = parse_range(key, start=None, end=None)
        return str(sales_report(viewer=viewer, rng=rng, branch_id=branch_id)["totals"]["net_minor"])


def test_owner_home_sums_branches_nets_returns_and_matches_report(two: dict[str, Any]) -> None:
    c1, c2 = two["c1"], two["c2"]
    today = timezone.localdate()
    # الرئيسي: 100 + 100 (الثانية مكرّرة أُلغيت بمستند عكسي) ومرتجع 30؛ بحري: 250
    s1 = _sale(c1, invoice="INV-KRT-1", day=today)
    dup = _sale(c1, invoice="INV-KRT-2", day=today)
    _reverse(c1, dup)
    _return(c1, s1, number="RET-KRT-1", total=3000, day=today)
    _sale(c2, invoice="INV-BHR-1", day=today, price="25000")
    # قبل ثلاثة أيام في بحري: خارج «اليوم» وداخل «آخر 7 أيام» و(غالباً) «هذا الشهر»
    old_day = today - timedelta(days=3)
    _sale(c2, invoice="INV-BHR-0", day=old_day, price="40000")

    with tenant_context(c1["tenant"].id):
        no_device = home.viewer_for(c1["owner"], None)
        on_device = home.viewer_for(c1["owner"], c1["device"])

    # R-01: المالك بلا جهاز = كل الفروع: 10000 − 3000 + 25000 (الملغاة خارج)
    out = _home(c1, no_device)
    assert out["scope"] == {"kind": "all", "branch_id": "", "branch_name": "", "can_choose": True}
    assert out["branch_id"] == home.ALL_BRANCHES and out["period"] == "today"
    k = _kpi(out, "sales")
    assert k is not None and k["label"] == "صافي مبيعات اليوم"
    assert k["value"]["amount_minor"] == "32000" and k["scope"] == "من 2 فروع"
    assert k["href"] == "/reports"
    # R-03: يطابق صافي التقرير حرفياً
    assert k["value"]["amount_minor"] == _report_net(c1, no_device, "today")
    assert out["sales"]["revenue_minor"] == "35000" and out["sales"]["returns_minor"] == "3000"
    assert out["sales"]["count"] == 2

    # على جهاز الرئيسي: فرع الجهاز افتراضياً، معلَناً
    out = _home(c1, on_device)
    assert out["scope"]["kind"] == "branch" and out["scope"]["branch_name"] == "الرئيسي"
    k = _kpi(out, "sales")
    assert k is not None and k["value"]["amount_minor"] == "7000" and k["scope"] == "الرئيسي"
    assert k["value"]["amount_minor"] == _report_net(c1, on_device, "today", c1["branch"].id)
    # «كل الفروع» صراحةً من الجهاز نفسه
    k = _kpi(_home(c1, on_device, branch_id="all"), "sales")
    assert k is not None and k["value"]["amount_minor"] == "32000"

    # R-02: مرشّح الفرع يغيّر الرقم: بحري وحده
    out = _home(c1, no_device, branch_id=str(two["bahri"].id))
    assert out["branch_id"] == str(two["bahri"].id) and out["scope"]["branch_name"] == "بحري"
    k = _kpi(out, "sales")
    assert k is not None and k["value"]["amount_minor"] == "25000" and k["scope"] == "بحري"
    assert k["value"]["amount_minor"] == _report_net(c1, no_device, "today", two["bahri"].id)
    # الذمم للمنشأة كلها — تحت نطاق فرع يُسمّى نطاقها (لا ذمم هنا فلا بطاقة)
    assert _kpi(out, "receivables") is None
    # معرّف غير صالح أو فرع من منشأة أخرى: الافتراضي (كل الفروع بلا جهاز)
    assert _home(c1, no_device, branch_id=str(uuid.uuid4()))["scope"]["kind"] == "all"

    # R-02: مرشّح الفترة يغيّر الرقم والعنوان
    out = _home(c1, no_device, period="7d")
    k = _kpi(out, "sales")
    assert k is not None and k["label"] == "صافي مبيعات آخر 7 أيام"
    assert k["value"]["amount_minor"] == "72000" == _report_net(c1, no_device, "7d")
    out = _home(c1, no_device, period="month")
    k = _kpi(out, "sales")
    assert k is not None and k["label"] == "صافي مبيعات هذا الشهر"
    assert k["value"]["amount_minor"] == _report_net(c1, no_device, "month")
    expected_month = 72000 if old_day.month == today.month else 32000
    assert k["value"]["amount_minor"] == str(expected_month)
    assert out["sales"]["start"] == today.replace(day=1).isoformat()
    # فترة غير معروفة: اليوم
    assert _home(c1, no_device, period="1y")["period"] == "today"


def test_manager_and_cashier_stay_on_their_branch(two: dict[str, Any]) -> None:
    c1, c2 = two["c1"], two["c2"]
    today = timezone.localdate()
    _sale(c1, invoice="INV-KRT-1", day=today)
    _sale(c2, invoice="INV-BHR-1", day=today, price="25000")
    with tenant_context(c1["tenant"].id):
        mgr = home.viewer_for(two["manager"], None)
    for branch_id in ("", "all", str(two["bahri"].id)):
        out = _home(c1, mgr, branch_id=branch_id)
        assert out["scope"]["kind"] == "branch" and out["scope"]["can_choose"] is False
        assert out["branch_id"] == str(c1["branch"].id)
        k = _kpi(out, "sales")
        assert k is not None and k["value"]["amount_minor"] == "10000" and k["scope"] == "الرئيسي"
    # نطاق الرئيسية لا يغيّر نطاق المشاهد في غيرها
    assert mgr.branch is not None and mgr.branch.id == c1["branch"].id
    # الكاشير: لا أرقام مالية مهما طلب
    with platform_context():
        role = Role.unscoped.create(tenant=c1["tenant"], code="cashier", name="كاشير")
        cashier = User.objects.create_user(tenant=c1["tenant"], username="ali", display_name="علي")
        UserBranchAccess.unscoped.create(
            tenant=c1["tenant"], user=cashier, branch=c1["branch"], role=role
        )
    with tenant_context(c1["tenant"].id):
        cv = home.viewer_for(cashier, None)
    out = _home(c1, cv, branch_id="all", period="month")
    assert out["kind"] == "employee" and out["kpis"] == [] and "sales" not in out
    assert out["scope"]["branch_id"] == str(c1["branch"].id)


def test_owner_cash_card_covers_every_branch(two: dict[str, Any]) -> None:
    c1, c2 = two["c1"], two["c2"]
    assert do_push(c1, shift_open(c1, str(uuid.uuid4()), opening="20000")) == ["accepted"]
    assert do_push(c2, shift_open(c2, str(uuid.uuid4()), opening="15000")) == ["accepted"]
    with tenant_context(c1["tenant"].id):
        owner = home.viewer_for(c1["owner"], None)
    cash = _kpi(_home(c1, owner), "cash")
    assert cash is not None and cash["value"]["amount_minor"] == "35000"
    assert cash["scope"] == "2 ورديات مفتوحة في المنشأة"
    cash = _kpi(_home(c1, owner, branch_id=str(two["bahri"].id)), "cash")
    assert cash is not None and cash["value"]["amount_minor"] == "15000"
    assert cash["scope"] == "وردية مفتوحة في بحري"


def test_home_endpoint_passes_period_and_branch(two: dict[str, Any]) -> None:
    c1, c2 = two["c1"], two["c2"]
    today = timezone.localdate()
    _sale(c1, invoice="INV-KRT-1", day=today)
    _sale(c2, invoice="INV-BHR-1", day=today, price="25000")
    with tenant_context(c1["tenant"].id):
        reg = register_device(user=c1["owner"], branch=c1["branch"], name="جهاز المالك")
    h = {"Authorization": f"Bearer {reg.access}"}
    c = Client()
    p = c.get("/api/home", headers=h).json()
    assert p["scope"]["kind"] == "branch" and _kpi(p, "sales")["value"]["amount_minor"] == "10000"  # type: ignore[index]
    p = c.get("/api/home?branch_id=all&period=7d", headers=h).json()
    k = _kpi(p, "sales")
    assert k is not None and k["value"]["amount_minor"] == "35000"
    assert k["label"] == "صافي مبيعات آخر 7 أيام" and p["period"] == "7d"


# ---------------------------------------------------------------- R-04: يوم العمل بتوقيت الخرطوم


def test_settings_business_day_is_khartoum() -> None:
    assert timezone.get_current_timezone_name() == "Africa/Khartoum"
    # 23:30 بتوقيت الخرطوم = 21:30 UTC؛ 00:30 = 22:30 UTC من اليوم السابق بتوقيت غرينتش
    assert timezone.localdate(datetime(2026, 11, 22, 21, 30, tzinfo=UTC)) == date(2026, 11, 22)
    assert timezone.localdate(datetime(2026, 11, 22, 22, 30, tzinfo=UTC)) == date(2026, 11, 23)
    # 01:59 و02:00 بتوقيت الخرطوم: اليوم نفسه (كانت 02:00 حدّ اليوم بتوقيت UTC)
    assert timezone.localdate(datetime(2026, 11, 22, 23, 59, tzinfo=UTC)) == date(2026, 11, 23)
    assert timezone.localdate(datetime(2026, 11, 23, 0, 0, tzinfo=UTC)) == date(2026, 11, 23)


@pytest.mark.parametrize(
    ("now_utc", "khartoum_day"),
    [
        (datetime(2026, 11, 22, 21, 30, tzinfo=UTC), date(2026, 11, 22)),  # 23:30 الخرطوم
        (datetime(2026, 11, 22, 22, 30, tzinfo=UTC), date(2026, 11, 23)),  # 00:30 الخرطوم
        (datetime(2026, 11, 22, 23, 59, tzinfo=UTC), date(2026, 11, 23)),  # 01:59 الخرطوم
        (datetime(2026, 11, 23, 0, 0, tzinfo=UTC), date(2026, 11, 23)),  # 02:00 الخرطوم
    ],
)
def test_home_today_follows_khartoum_midnight(
    two: dict[str, Any], monkeypatch: pytest.MonkeyPatch, now_utc: datetime, khartoum_day: date
) -> None:
    c1 = two["c1"]
    _install_clock(monkeypatch, lambda: now_utc)
    # بيع 23:30 الخرطوم (21:30 UTC) يوم 22، وبيع 00:30 الخرطوم (22:30 UTC يوم 22) يوم 23
    late = sale_op(c1, invoice="INV-LATE", price="10000")
    late["members"][0]["payload"].update(
        business_date="2026-11-22", occurred_at="2026-11-22T21:30:00Z"
    )
    early = sale_op(c1, invoice="INV-EARLY", price="25000")
    early["members"][0]["payload"].update(
        business_date="2026-11-23", occurred_at="2026-11-22T22:30:00Z"
    )
    assert do_push(c1, late, early) == ["accepted", "accepted"]
    with tenant_context(c1["tenant"].id):
        owner = home.viewer_for(c1["owner"], None)
        assert parse_range("today", start=None, end=None).start == khartoum_day
        # الوقت المحلي للبيعين يقع في يوم عملهما
        for inv, day in (("INV-LATE", date(2026, 11, 22)), ("INV-EARLY", date(2026, 11, 23))):
            s = Sale.objects.get(invoice_number=inv)
            assert timezone.localdate(s.occurred_at) == s.business_date == day
            assert Sale.objects.filter(id=s.id, occurred_at__date=day).exists()
    k = _kpi(_home(c1, owner), "sales")
    assert k is not None
    assert k["value"]["amount_minor"] == ("10000" if khartoum_day.day == 22 else "25000")


def test_stock_report_day_bounds_are_khartoum_midnight() -> None:
    from inventory.reports import _bounds as stock_bounds
    from sales.reports import Range
    from shifts.reports import _bounds as cash_bounds

    rng = Range("custom", date(2026, 11, 23), date(2026, 11, 23))
    for bounds in (stock_bounds, cash_bounds):
        start, end = bounds(rng)
        assert start == datetime(2026, 11, 22, 22, 0, tzinfo=UTC)
        assert end == datetime(2026, 11, 23, 22, 0, tzinfo=UTC)
        # 23:30 الخرطوم يوم 22 خارج يوم 23، و00:30 الخرطوم داخله
        assert not start <= datetime(2026, 11, 22, 21, 30, tzinfo=UTC) < end
        assert start <= datetime(2026, 11, 22, 22, 30, tzinfo=UTC) < end

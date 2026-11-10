"""مراجعة 2026-11-10 (ع-٢، ع-٥): الفرع والبائع يُقاسان بالجهاز والجلسة المصادَقين لا بحمولة الجهاز،
وما يُرفع عبر HTTP يصل الجهاز الآخر في فرعه بالسحب.

كل الطلبات عبر `/api/sync/push` بدور التطبيق — اختبارات الوحدة تنادي `push(branch_id=…)` مباشرة
فلم تكشف أن العرض لا يمرّر الفرع."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

import pytest
from django.db import connection
from django.test import Client

from catalog import services as catalog_services
from conftest import TwoTenants
from core.auth.devices import register_device
from core.models import Role, User, UserBranchAccess
from core.tenancy import platform_context, tenant_context
from core.tests.test_org import _h, ctx  # noqa: F401
from sales.models import Sale
from sales.tests.test_sale import sale_op
from sync.counter import ensure_state
from sync.models import QuarantinedOperation
from sync.models_log import SyncLog
from sync.push import PROTOCOL_VERSION

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.usefixtures("pinned_clock")]

OVER_CAP = ("amount", "500000", "500000")  # سقف الكاشير 1,000 للعملية


def _as(c: dict[str, Any], who: str, branch: Any = None) -> dict[str, Any]:
    """سياق `sale_op` لمستخدم بعينه على جهازه المسجَّل، مع رمز جلسته."""
    with tenant_context(c["tenant"].id):
        epoch = ensure_state(c["tenant"].id).sync_epoch
    return {
        "tenant": c["tenant"],
        "branch": branch or c["branch"],
        "device": SimpleNamespace(id=c["device_ids"][who]),
        "owner": c["users"][who],
        "epoch": epoch,
        "token": c["tokens"][who],
    }


def _push(c: dict[str, Any], *ops: dict[str, Any]) -> list[tuple[str, str]]:
    with connection.cursor() as cur:
        cur.execute("SET ROLE sting_app")
    try:
        r = Client().post(
            "/api/sync/push",
            {
                "protocol_version": PROTOCOL_VERSION,
                "sync_epoch": c["epoch"],
                "request_id": str(uuid.uuid4()),
                "operations": list(ops),
            },
            content_type="application/json",
            headers=_h(c["token"]),
        )
    finally:
        with connection.cursor() as cur:
            cur.execute("RESET ROLE")
    assert r.status_code == 200, r.content
    return [(x["status"], x.get("code", "")) for x in r.json()["results"]]


def _head(op: dict[str, Any]) -> dict[str, Any]:
    head: dict[str, Any] = next(m for m in op["members"] if m["entity"] == "sales.Sale")["payload"]
    return head


def _sales(c: dict[str, Any]) -> dict[str, Sale]:
    with tenant_context(c["tenant"].id):
        return {s.invoice_number: s for s in Sale.objects.all()}


def test_cashier_cannot_borrow_the_owner_cap(ctx: dict[str, Any]) -> None:  # noqa: F811
    """كاشير ينسب بيعه إلى المالك في الحمولة: السقف يُقاس بأدنى الدورين فيبقى موسوماً."""
    cashier = _as(ctx, "cashier")
    op = sale_op(cashier, invoice="INV-1", price="600000", discount=OVER_CAP)
    _head(op)["user_id"] = str(ctx["users"]["owner"].id)
    assert _push(cashier, op) == [("accepted", "")]
    assert _sales(ctx)["INV-1"].exceeds_discount_cap is True


def test_offline_sale_keeps_its_seller_when_another_session_uploads(
    ctx: dict[str, Any],  # noqa: F811
) -> None:
    """جهاز مشترك: الكاشير باع دون اتصال ثم رفع المالك — البيع للكاشير وسقفه سقف الكاشير؛ وبيع
    المالك نفسه بجلسته بلا سقف."""
    owner = _as(ctx, "owner")
    by_cashier = sale_op(owner, invoice="INV-1", price="600000", discount=OVER_CAP)
    _head(by_cashier)["user_id"] = str(ctx["users"]["cashier"].id)
    own = sale_op(owner, invoice="INV-2", price="600000", discount=OVER_CAP)
    assert _push(owner, by_cashier, own) == [("accepted", ""), ("accepted", "")]
    sales = _sales(ctx)
    assert sales["INV-1"].user_name == "أحمد ياسين" and sales["INV-1"].exceeds_discount_cap
    assert sales["INV-2"].exceeds_discount_cap is False


def test_sale_for_another_branch_is_rejected(
    ctx: dict[str, Any],  # noqa: F811
    two_tenants: TwoTenants,
) -> None:
    """جهاز الفرع الأول لا يكتب بيعاً ولا مخزوناً في الفرع الثاني، ولو كانت الجلسة للمالك."""
    second = two_tenants.a_branches[1]
    for who, invoice in (("cashier", "INV-1"), ("owner", "INV-2")):
        c = _as(ctx, who, branch=second)
        assert _push(c, sale_op(c, invoice=invoice)) == [("rejected", "branch_out_of_scope")]
    assert _sales(ctx) == {}
    with tenant_context(ctx["tenant"].id):
        assert catalog_services.branch_balances(second.id) == {}
        held = QuarantinedOperation.objects.filter(code="branch_out_of_scope")
        assert held.count() == 2


def test_unknown_and_foreign_branch_are_rejected(
    ctx: dict[str, Any],  # noqa: F811
    two_tenants: TwoTenants,
) -> None:
    """فرع غير موجود كان يُقبل بيعاً بلا أثر مخزني؛ وفرع منشأة أخرى كان يُخزَّن معرّفه."""
    owner = _as(ctx, "owner")
    ghost = dict(owner, branch=SimpleNamespace(id=uuid.uuid4()))
    foreign = dict(owner, branch=two_tenants.b_branches[0])
    assert _push(owner, sale_op(ghost, invoice="INV-1"), sale_op(foreign, invoice="INV-2")) == [
        ("rejected", "branch_out_of_scope"),
        ("rejected", "branch_out_of_scope"),
    ]
    assert _sales(ctx) == {}


def test_seller_must_be_a_user_of_this_tenant(
    ctx: dict[str, Any],  # noqa: F811
    two_tenants: TwoTenants,
) -> None:
    with platform_context():
        outsider = User.objects.create_user(
            tenant=two_tenants.b, username="other", display_name="من منشأة أخرى", is_owner=True
        )
    cashier = _as(ctx, "cashier")
    unknown = sale_op(cashier, invoice="INV-1")
    _head(unknown)["user_id"] = str(uuid.uuid4())
    foreign = sale_op(cashier, invoice="INV-2")
    _head(foreign)["user_id"] = str(outsider.id)
    assert _push(cashier, unknown, foreign) == [
        ("rejected", "user_out_of_scope"),
        ("rejected", "user_out_of_scope"),
    ]
    assert _sales(ctx) == {}


def test_replay_of_an_accepted_operation_stays_duplicate(
    ctx: dict[str, Any],  # noqa: F811
) -> None:
    """الفحص للعملية الجديدة وحدها: إعادة المعتمَد تعود `duplicate` كما كانت."""
    owner = _as(ctx, "owner")
    op = sale_op(owner, invoice="INV-1")
    assert _push(owner, op) == [("accepted", "")]
    assert _push(owner, op) == [("duplicate", "")]


def test_http_push_reaches_the_other_device_by_pull(ctx: dict[str, Any]) -> None:  # noqa: F811
    """ع-٥: العرض لم يكن يمرّر فرع الجهاز فيُفهرَس البيع بمفتاح فارغ لا يقرؤه أحد."""
    owner, manager = _as(ctx, "owner"), _as(ctx, "manager")
    assert _push(owner, sale_op(owner, invoice="INV-1")) == [("accepted", "")]
    with tenant_context(ctx["tenant"].id):
        scopes = set(SyncLog.objects.filter(scope="branch").values_list("scope_id", flat=True))
    assert scopes == {str(ctx["branch"].id)}
    r = Client().post(
        "/api/sync/pull",
        {
            "protocol_version": PROTOCOL_VERSION,
            "sync_epoch": manager["epoch"],
            "request_id": str(uuid.uuid4()),
        },
        content_type="application/json",
        headers=_h(manager["token"]),
    )
    assert r.status_code == 200
    assert {e["entity"] for e in r.json()["entities"]} == {
        "sales.Sale",
        "sales.SaleLine",
        "sales.Payment",
        "inventory.StockMovement",
    }


def test_device_of_another_tenant_cannot_use_this_tenants_branch(
    ctx: dict[str, Any],  # noqa: F811
    two_tenants: TwoTenants,
) -> None:
    with platform_context():
        owner_b = User.objects.create_user(
            tenant=two_tenants.b, username="ob", display_name="مالك ب", is_owner=True
        )
        role_b = Role.unscoped.create(tenant=two_tenants.b, code="owner", name="مالك")
        UserBranchAccess.unscoped.create(
            tenant=two_tenants.b, user=owner_b, branch=two_tenants.b_branches[0], role=role_b
        )
    with tenant_context(two_tenants.b.id):
        reg = register_device(user=owner_b, branch=two_tenants.b_branches[0], name="جهاز ب")
        epoch = ensure_state(two_tenants.b.id).sync_epoch
    b = {
        "tenant": two_tenants.b,
        "branch": ctx["branch"],  # فرع المنشأة الأخرى
        "device": reg.device,
        "owner": owner_b,
        "epoch": epoch,
        "token": reg.access,
    }
    assert _push(b, sale_op(b, invoice="INV-X")) == [("rejected", "branch_out_of_scope")]
    with tenant_context(two_tenants.b.id):
        assert not Sale.objects.exists()


def test_backfill_gives_old_rows_their_device_branch(ctx: dict[str, Any]) -> None:  # noqa: F811
    """الهجرة 0009: صفوف ما قبل الإصلاح (مفتاح فارغ) تأخذ فرع جهاز عمليتها — بدور غير متجاوز
    لـRLS كما تُشغَّل الهجرات في الإنتاج — فيقرؤها السحب."""
    import importlib

    from django.db import transaction

    backfill = importlib.import_module("sync.migrations.0009_backfill_branch_scope").BACKFILL_SQL
    owner = _as(ctx, "owner")
    assert _push(owner, sale_op(owner, invoice="INV-1")) == [("accepted", "")]
    with transaction.atomic(), connection.cursor() as cur:
        cur.execute("LOCK TABLE sync_syncstate IN ROW EXCLUSIVE MODE")
        cur.execute("UPDATE sync_log SET scope_id = '' WHERE scope = 'branch'")
    with transaction.atomic(), connection.cursor() as cur:
        cur.execute("SET LOCAL ROLE sting_app")
        cur.execute(backfill)
    with tenant_context(ctx["tenant"].id):
        scopes = set(SyncLog.objects.filter(scope="branch").values_list("scope_id", flat=True))
    assert scopes == {str(ctx["branch"].id)}

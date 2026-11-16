"""Operational milestones. Only timestamps and technical counts leave the database."""

from __future__ import annotations

from typing import Any

from django.db.models import Count, F, Max, Min, OuterRef, Q, QuerySet, Subquery
from django.utils.dateparse import parse_datetime

from core.models import Session, SubscriptionReceipt, TenantSubscription
from market.models import MarketOrder
from sales.models import Sale
from sync.models import Operation, QuarantinedOperation, SupportReport


def trials(now: Any) -> QuerySet[TenantSubscription]:
    orders = MarketOrder.unscoped.filter(
        tenant_id=OuterRef("tenant_id"),
        kind=MarketOrder.Kind.ORDER,
        sent_at__gte=OuterRef("started_at"),
        sent_at__lt=OuterRef("trial_ends_at"),
        sent_at__lte=now,
    ).order_by("sent_at")
    payments = SubscriptionReceipt.unscoped.filter(
        tenant_id=OuterRef("tenant_id"),
        proof__kind="renewal",
        amount_minor__gt=0,
        issued_at__gte=OuterRef("trial_ends_at"),
        issued_at__lte=now,
    ).order_by("issued_at")
    rows: QuerySet[TenantSubscription] = TenantSubscription.unscoped.filter(
        trial_ends_at__isnull=False
    ).annotate(
        order_at=Subquery(orders.values("sent_at")[:1]),
        paid_at=Subquery(payments.values("issued_at")[:1]),
    )
    return rows


def renewal_counts(now: Any) -> dict[str, int]:
    return (
        trials(now)
        .filter(trial_ends_at__lte=now)
        .filter(
            Q(order_at__isnull=False)
            | Q(
                first_trial_report_at__gte=F("started_at"),
                first_trial_report_at__lt=F("trial_ends_at"),
            )
        )
        .aggregate(eligible=Count("pk"), paid=Count("paid_at"))
    )


def stamp(value: Any) -> str:
    return value.isoformat() if value else ""


def annotate_followup(rows: list[dict[str, Any]], now: Any) -> None:
    ids = [r["id"] for r in rows]
    if not ids:
        return
    milestones = {str(s.tenant_id): s for s in trials(now).filter(tenant_id__in=ids)}
    first_sale = {
        str(k): v
        for k, v in Sale.unscoped.filter(tenant_id__in=ids)
        .values("tenant_id")
        .annotate(at=Min("occurred_at"))
        .values_list("tenant_id", "at")
    }
    accepted = {
        str(k): v
        for k, v in Operation.unscoped.filter(tenant_id__in=ids)
        .values("tenant_id")
        .annotate(at=Max("received_at"))
        .values_list("tenant_id", "at")
    }
    errors = {
        str(k): (code, at)
        for k, code, at in QuarantinedOperation.unscoped.filter(
            tenant_id__in=ids, reason__in=["rejected", "conflicted"]
        )
        .order_by("tenant_id", "-received_at", "-pk")
        .distinct("tenant_id")
        .values_list("tenant_id", "code", "received_at")
    }
    reports = {
        str(k): (pending, at, ok)
        for k, pending, at, ok in SupportReport.unscoped.filter(tenant_id__in=ids)
        .order_by("tenant_id", "-created_at", "-pk")
        .distinct("tenant_id")
        .values_list("tenant_id", "payload__sync__pending", "created_at", "payload__sync__last_ok")
    }
    heartbeats = {
        str(k): (n, at)
        for k, n, at in Session.unscoped.filter(
            tenant_id__in=ids,
            device__isnull=False,
            revoked_at__isnull=True,
            reported_pending__isnull=False,
            reported_pending_at__isnull=False,
        )
        .order_by("tenant_id", "-reported_pending_at", "-pk")
        .distinct("tenant_id")
        .values_list("tenant_id", "reported_pending", "reported_pending_at")
    }
    for row in rows:
        key = row["id"]
        sub = milestones.get(key)
        error, error_at = errors.get(key, ("", None))
        pending, report_at, ok = reports.get(key, (None, None, None))
        heartbeat = heartbeats.get(key)
        if heartbeat and (not report_at or heartbeat[1] >= report_at):
            pending, report_at = heartbeat
        last_ok = None
        if isinstance(ok, str):
            try:
                last_ok = parse_datetime(ok)
            except ValueError:
                pass

        row["followup"] = {
            "trial_end": stamp(sub.trial_ends_at if sub else None),
            "first_sale": stamp(first_sale.get(key)),
            "report": stamp(sub.first_trial_report_at if sub else None),
            "order": stamp(getattr(sub, "order_at", None)),
            "paid": stamp(getattr(sub, "paid_at", None)),
            "accepted": stamp(accepted.get(key)),
            "last_ok": stamp(last_ok),
            "error": error,
            "error_at": stamp(error_at),
            "pending": pending if type(pending) is int and pending >= 0 else None,
            "reported_at": stamp(report_at),
        }

"""REP-02 — تقرير الذمم بلا تقادم مخترَع (G-15؛ ACC-79): الرصيد، وتاريخ آخر سداد، وتاريخ أقدم حركة
لم يغطها سداد لاحق — لا جدول أعمار (30/60/90) لأن السداد يُخفض الرصيد الإجمالي دون ربطه بفاتورة.
الأرقام من الحركات المؤكَّدة خادمياً؛ «قد لا تشمل سداداً وقع في فرع لم يُزامن»."""

from __future__ import annotations

from datetime import date
from typing import Any

from django.utils import timezone

from core import home
from parties.models import OpeningBalance, Party
from parties.services import (
    balance_minor,
    identity_ids,
    party_figures,
    receivables_visible_ids,
    statement_lines,
    supplier_documents,
    supplier_owed_minor,
    supplier_statement_lines,
)


def _iso_date(d: date | None) -> str:
    return d.isoformat() if d else ""


def _customer_row(party: Party, balance: int | None = None) -> dict[str, Any] | None:
    balance = balance_minor(party) if balance is None else balance
    if balance <= 0:
        return None
    lines = [ln for ln in statement_lines(party) if not ln.info]
    payments = [ln for ln in lines if ln.kind in {"payment", "refund"} and ln.credit_minor > 0]
    last_payment = max((ln.business_date or ln.occurred_at.date() for ln in payments), default=None)
    debits = [ln for ln in lines if ln.debit_minor > 0]
    # أقدم حركة لم يغطها سداد لاحق: أقدم مدين بعد آخر سداد (أو أقدم مدين إن لم يقع سداد)
    uncovered = [
        ln
        for ln in debits
        if last_payment is None or (ln.business_date or ln.occurred_at.date()) > last_payment
    ]
    oldest = min(
        (ln.business_date or ln.occurred_at.date() for ln in uncovered),
        default=None,
    )
    invoices = [ln for ln in debits if ln.kind == "sale"]
    openings = [ln for ln in debits if ln.kind == "opening"]
    if invoices and openings:
        source = f"رصيد افتتاحي + {len(invoices)} فواتير آجلة"
    elif len(invoices) == 1:
        source = "فاتورة واحدة"
    elif invoices:
        source = "فواتير آجلة"
    elif openings:
        source = "رصيد افتتاحي — بلا فواتير"
    else:
        source = ""
    return {
        "id": str(party.id),
        "name": party.name,
        "balance_minor": str(balance),
        "last_payment_date": _iso_date(last_payment),
        "oldest_unpaid_date": _iso_date(oldest),
        "invoices": len(invoices),
        "source": source,
    }


def _supplier_row(party: Party, owed: int | None = None) -> dict[str, Any] | None:
    owed = supplier_owed_minor(party) if owed is None else owed
    if owed <= 0:
        return None
    # المصدر من الحركات الفعلية لا نصّ ثابت: كان «رصيد افتتاحي — بلا فواتير» حتى لذمّة من مستندات
    # شراء معتمدة (مراجعة الأطراف 2026-11-20، G-06)
    docs = supplier_documents(party)
    opening = OpeningBalance.objects.filter(
        party_id__in=identity_ids(party), side="supplier_owed"
    ).exists()
    if docs and opening:
        source = f"رصيد افتتاحي + {docs} مستندات شراء"
    elif docs == 1:
        source = "مستند شراء واحد"
    elif docs:
        source = "مستندات شراء"
    elif opening:
        source = "رصيد افتتاحي — بلا فواتير"
    else:
        source = ""
    # آخر سند صرف فعّال (المرحلة ٣ من مراجعة الأطراف) — كان فارغاً دائماً لأن الدفع لم يُبنَ
    paid = [
        ln.business_date or ln.occurred_at.date()
        for ln in supplier_statement_lines(party)
        if ln.kind == "payment" and ln.debit_minor > 0
    ]
    return {
        "id": str(party.id),
        "name": party.name,
        "balance_minor": str(owed),
        "last_payment_date": _iso_date(max(paid, default=None)),
        "oldest_unpaid_date": "",
        "invoices": docs,
        "source": source,
    }


def receivables_report(*, viewer: home.Viewer, side: str = "customers") -> dict[str, Any]:
    side = "suppliers" if side == "suppliers" else "customers"
    rows: list[dict[str, Any]] = []
    qs = Party.objects.filter(merged_into__isnull=True).order_by("name_normalized")
    qs = qs.filter(is_supplier=True) if side == "suppliers" else qs.filter(is_customer=True)
    # «فرعه» في «رؤية ذمم كل العملاء»: عملاء فرعه وحدهم (0005 §٢٩٢؛ مراجعة 2026-11-22 O-01)
    visible = receivables_visible_ids(viewer) if side == "customers" else None
    if visible is not None:
        qs = qs.filter(id__in=visible)
    parties = list(qs)
    figures = party_figures(parties)  # الرصيد لكل طرف باستعلامات ثابتة؛ الكشف لمن عليه فقط (§٢٨٧)
    for party in parties:
        f = figures[party.id]
        row = (
            _supplier_row(party, f.supplier_owed_minor)
            if side == "suppliers"
            else _customer_row(party, f.balance_minor)
        )
        if row:
            rows.append(row)
    rows.sort(key=lambda r: -int(r["balance_minor"]))
    total = sum(int(r["balance_minor"]) for r in rows)
    return {
        "side": side,
        "scope": "all" if visible is None else "branch",
        "rows": rows,
        "totals": {"balance_minor": str(total), "parties": len(rows)},
        "computed_at": timezone.now().isoformat().replace("+00:00", "Z"),
        # G-15: لا جدول أعمار — غير مفعّل بسببه المعلَن
        "ageing": "disabled",
    }


def export_csv(payload: dict[str, Any]) -> str:
    head = (
        f"# تقرير الذمم · {'للموردين علينا' if payload['side'] == 'suppliers' else 'على العملاء'}"
        f" · حُسب في {payload['computed_at']} · بلا جدول أعمار (G-15)"
    )
    lines = [head, "name,balance_minor,last_payment_date,oldest_unpaid_date,source"]
    for r in payload["rows"]:
        lines.append(
            ",".join(
                [
                    str(r["name"]).replace(",", " "),
                    str(r["balance_minor"]),
                    r["last_payment_date"],
                    r["oldest_unpaid_date"],
                    str(r["source"]).replace(",", " "),
                ]
            )
        )
    return "\n".join(lines) + "\n"

"""يشغّل refund vectors على النظير Python — نفس النتائج على الطرفين (§٤.٤؛ 0005 §٢٩٠)."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from core.money import DomainError
from core.refund import (
    RefundChannels,
    SaleLineAmount,
    allocate_invoice_discount,
    refund_split,
    return_line_value_minor,
    return_value_cap_minor,
)

VECTORS = Path(__file__).resolve().parents[3] / "packages" / "domain" / "vectors"
V: dict[str, Any] = json.loads((VECTORS / "refund.json").read_text(encoding="utf-8"))


def code(fn: Callable[[], object]) -> str:
    try:
        fn()
    except DomainError as e:
        return e.code
    return "no_error"


def ch(c: dict[str, str]) -> RefundChannels:
    return RefundChannels(int(c["credit"]), int(c["bank"]), int(c["cash"]))


@pytest.mark.parametrize("c", V["allocate"])
def test_allocate(c: dict[str, Any]) -> None:
    def run() -> list[int]:
        return allocate_invoice_discount(
            [SaleLineAmount(k, int(t)) for k, t in c["lines"]], int(c["discount"])
        )

    if "error" in c:
        assert code(run) == c["error"]
        return
    net = run()
    assert [str(n) for n in net] == c["net"]
    subtotal = sum(int(t) for _, t in c["lines"])
    assert sum(net) == subtotal - int(c["discount"])
    assert all(0 <= n <= int(c["lines"][i][1]) for i, n in enumerate(net))


@pytest.mark.parametrize("c", V["line_value"])
def test_line_value(c: dict[str, Any]) -> None:
    def run() -> int:
        return return_line_value_minor(
            int(c["net"]), int(c["sold"]), int(c["prior"]), int(c["qty"])
        )

    if "error" in c:
        assert code(run) == c["error"]
        return
    assert str(run()) == c["value"]


@pytest.mark.parametrize("c", V["cumulative"])
def test_cumulative_never_exceeds_paid(c: dict[str, Any]) -> None:
    prior = total = 0
    got = []
    for s in c["steps"]:
        v = return_line_value_minor(int(c["net"]), int(c["sold"]), prior, int(s))
        prior += int(s)
        total += v
        assert total <= return_value_cap_minor(int(c["net"]), int(c["sold"]), prior)
        got.append(str(v))
    assert got == c["values"]
    if prior == int(c["sold"]):
        assert total == int(c["net"])


@pytest.mark.parametrize("c", V["split"])
def test_split(c: dict[str, Any]) -> None:
    def run() -> RefundChannels:
        return refund_split(int(c["total"]), ch(c["paid"]), ch(c["refunded"]))

    if "error" in c:
        assert code(run) == c["error"]
        return
    s = run()
    assert {
        "credit": str(s.credit_minor),
        "bank": str(s.bank_minor),
        "cash": str(s.cash_minor),
    } == c["split"]

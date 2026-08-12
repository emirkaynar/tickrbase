from __future__ import annotations

import time
import pytest
from backend.services.snapshots import _replay_ledger, to_utc_midnight, LedgerEntry
from backend.core.models_db import PortfolioTransaction


def test_to_utc_midnight():
    ts = 1754800000  # Example unix timestamp
    midnight = to_utc_midnight(ts)
    assert midnight % 86400 == 0


def test_replay_ledger_buy_only():
    txs = [
        PortfolioTransaction(
            id="tx1",
            portfolio_id="port1",
            user_id=1,
            ticker="THYAO.IS",
            type="BUY",
            quantity=10.0,
            unit_price=100.0,
            fee=5.0,
            tax=0.0,
            currency="TRY",
            fx_rate_to_base=1.0,
            executed_at=1700000000,
            created_at=1700000000,
        )
    ]
    holdings = _replay_ledger(txs, 1700086400)
    assert "THYAO.IS" in holdings
    entry = holdings["THYAO.IS"]
    assert entry.quantity == 10.0
    assert entry.net_invested_native == 1005.0
    assert entry.avg_price_native == 100.5


def test_replay_ledger_partial_sell():
    txs = [
        PortfolioTransaction(
            id="tx1",
            portfolio_id="port1",
            user_id=1,
            ticker="AAPL",
            type="BUY",
            quantity=10.0,
            unit_price=150.0,
            fee=0.0,
            tax=0.0,
            currency="USD",
            fx_rate_to_base=30.0,
            executed_at=1700000000,
            created_at=1700000000,
        ),
        PortfolioTransaction(
            id="tx2",
            portfolio_id="port1",
            user_id=1,
            ticker="AAPL",
            type="SELL",
            quantity=4.0,
            unit_price=180.0,
            fee=0.0,
            tax=0.0,
            currency="USD",
            fx_rate_to_base=32.0,
            executed_at=1700100000,
            created_at=1700100000,
        ),
    ]
    holdings = _replay_ledger(txs, 1700200000)
    assert "AAPL" in holdings
    entry = holdings["AAPL"]
    assert entry.quantity == 6.0
    assert entry.avg_price_native == 150.0
    assert entry.avg_price_base == 4500.0
    assert entry.net_invested_native == 900.0
    assert entry.net_invested_base == 27000.0


def test_replay_ledger_full_sell():
    txs = [
        PortfolioTransaction(
            id="tx1",
            portfolio_id="port1",
            user_id=1,
            ticker="AAPL",
            type="BUY",
            quantity=10.0,
            unit_price=150.0,
            fee=0.0,
            tax=0.0,
            currency="USD",
            fx_rate_to_base=30.0,
            executed_at=1700000000,
            created_at=1700000000,
        ),
        PortfolioTransaction(
            id="tx2",
            portfolio_id="port1",
            user_id=1,
            ticker="AAPL",
            type="SELL",
            quantity=10.0,
            unit_price=180.0,
            fee=0.0,
            tax=0.0,
            currency="USD",
            fx_rate_to_base=32.0,
            executed_at=1700100000,
            created_at=1700100000,
        ),
    ]
    holdings = _replay_ledger(txs, 1700200000)
    assert "AAPL" not in holdings

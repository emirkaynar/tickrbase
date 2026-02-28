from __future__ import annotations

from datetime import datetime, timezone

from ..core.db import execute, fetchall, fetchone
from ..core.provider import DataProvider
from ..core.cache import TTLCache
from ..core.yahoo import normalize_ticker
from .prices import get_price


def _iso_now() -> str:
    return datetime.now(tz=timezone.utc).isoformat().replace("+00:00", "Z")


def list_positions(
    provider: DataProvider, cache: TTLCache[float]
) -> list[dict]:
    rows = fetchall("SELECT ticker, quantity, avg_price FROM portfolio")
    results: list[dict] = []
    for row in rows:
        ticker = row["ticker"]
        qty = float(row["quantity"])
        avg = float(row["avg_price"])
        price, _, _ = get_price(provider, cache, ticker)
        pnl = (price - avg) * qty
        pnl_pct = ((price - avg) / avg * 100.0) if avg != 0 else 0.0
        results.append(
            {
                "ticker": ticker,
                "quantity": qty,
                "avg_price": avg,
                "current_price": price,
                "pnl": pnl,
                "pnl_percent": pnl_pct,
            }
        )
    return results


def upsert_position(ticker: str, quantity: float, avg_price: float) -> None:
    normalized = normalize_ticker(ticker)
    execute(
        """
        INSERT INTO portfolio (ticker, quantity, avg_price, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(ticker) DO UPDATE SET quantity = excluded.quantity, avg_price = excluded.avg_price
        """,
        (normalized, quantity, avg_price, _iso_now()),
    )


def delete_position(ticker: str) -> None:
    normalized = normalize_ticker(ticker)
    execute("DELETE FROM portfolio WHERE ticker = ?", (normalized,))

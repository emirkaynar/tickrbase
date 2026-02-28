from __future__ import annotations

from datetime import datetime, timezone

from ..core.cache import TTLCache
from ..core.db import execute, fetchall
from ..core.provider import DataProvider
from ..core.yahoo import normalize_ticker
from .prices import get_price


def _iso_now() -> str:
    return datetime.now(tz=timezone.utc).isoformat().replace("+00:00", "Z")


def list_alerts() -> list[dict]:
    rows = fetchall(
        """
        SELECT id, ticker, condition, threshold, active, created_at, last_triggered_at
        FROM alerts WHERE active = 1
        ORDER BY id DESC
        """
    )
    return [
        {
            "id": int(row["id"]),
            "ticker": row["ticker"],
            "condition": row["condition"],
            "threshold": float(row["threshold"]),
            "active": bool(row["active"]),
            "created_at": row["created_at"],
            "last_triggered_at": row["last_triggered_at"],
        }
        for row in rows
    ]


def create_alert(ticker: str, condition: str, threshold: float) -> None:
    normalized = normalize_ticker(ticker)
    execute(
        """
        INSERT INTO alerts (ticker, condition, threshold, active, created_at, last_triggered_at)
        VALUES (?, ?, ?, 1, ?, NULL)
        """,
        (normalized, condition, threshold, _iso_now()),
    )


def delete_alert(alert_id: int) -> None:
    execute("DELETE FROM alerts WHERE id = ?", (alert_id,))


def evaluate_alerts(provider: DataProvider, cache: TTLCache[float]) -> None:
    rows = fetchall(
        "SELECT id, ticker, condition, threshold FROM alerts WHERE active = 1"
    )
    if not rows:
        return

    prices: dict[str, float] = {}
    for row in rows:
        ticker = row["ticker"]
        if ticker in prices:
            continue
        price, _, _ = get_price(provider, cache, ticker)
        prices[ticker] = price

    for row in rows:
        alert_id = int(row["id"])
        ticker = row["ticker"]
        condition = row["condition"]
        threshold = float(row["threshold"])
        price = prices.get(ticker)
        if price is None:
            continue
        triggered = (condition == "above" and price >= threshold) or (
            condition == "below" and price <= threshold
        )
        if triggered:
            execute(
                """
                UPDATE alerts
                SET active = 0, last_triggered_at = ?
                WHERE id = ?
                """,
                (_iso_now(), alert_id),
            )

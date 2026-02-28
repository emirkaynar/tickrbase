from __future__ import annotations

import time

from ..core.config import WATCHLIST_STALE_SECONDS
from ..core.db import execute, fetchall
from ..core.yahoo import normalize_ticker


def upsert_watchlist(items: list[dict]) -> None:
    now_ts = int(time.time())
    for item in items:
        ticker = normalize_ticker(item["ticker"])
        interval = item["interval"]
        execute(
            """
            INSERT INTO watchlist (ticker, interval, last_seen)
            VALUES (?, ?, ?)
            ON CONFLICT(ticker, interval) DO UPDATE SET last_seen = excluded.last_seen
            """,
            (ticker, interval, now_ts),
        )


def list_watchlist() -> list[dict]:
    cutoff = int(time.time()) - WATCHLIST_STALE_SECONDS
    rows = fetchall(
        """
        SELECT ticker, interval, last_seen FROM watchlist
        WHERE last_seen >= ?
        ORDER BY ticker ASC
        """,
        (cutoff,),
    )
    return [
        {
            "ticker": row["ticker"],
            "interval": row["interval"],
            "last_seen": int(row["last_seen"]),
        }
        for row in rows
    ]

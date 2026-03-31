from __future__ import annotations

import time
from datetime import datetime, timezone

from .config import (
    DEFAULT_PERIOD,
    HISTORY_TTL_SECONDS,
    INTERVAL_SECONDS,
    YAHOO_MAX_RANGE,
)
from .db import execute, executemany, fetchall, fetchone
from .models import Candle
from .provider import DataProvider
from .yahoo import normalize_ticker


def _now_ts() -> int:
    return int(time.time())


def _period_start(period: str, now_ts: int) -> int:
    if period == "max":
        return 0
    if period == "ytd":
        year_start = datetime.fromtimestamp(now_ts, tz=timezone.utc).replace(
            month=1, day=1, hour=0, minute=0, second=0, microsecond=0
        )
        return int(year_start.timestamp())
    if period.endswith("mo"):
        try:
            value = int(period[:-2])
        except ValueError:
            return 0
        return now_ts - value * 30 * 24 * 60 * 60
    if period.endswith("wk"):
        try:
            value = int(period[:-2])
        except ValueError:
            return 0
        return now_ts - value * 7 * 24 * 60 * 60
    unit = period[-1]
    try:
        value = int(period[:-1])
    except ValueError:
        return 0
    if unit == "d":
        return now_ts - value * 24 * 60 * 60
    if unit == "w":
        return now_ts - value * 7 * 24 * 60 * 60
    if unit == "m":
        return now_ts - value * 30 * 24 * 60 * 60
    if unit == "y":
        return now_ts - value * 365 * 24 * 60 * 60
    return 0


def _get_last_refresh(ticker: str, interval: str) -> int | None:
    row = fetchone(
        "SELECT last_refresh FROM history_meta WHERE ticker = ? AND interval = ?",
        (ticker, interval),
    )
    if not row:
        return None
    return int(row["last_refresh"])


def _set_last_refresh(ticker: str, interval: str, timestamp: int) -> None:
    execute(
        "INSERT OR REPLACE INTO history_meta (ticker, interval, last_refresh) VALUES (?, ?, ?)",
        (ticker, interval, timestamp),
    )


def _get_latest_time(ticker: str, interval: str) -> int | None:
    row = fetchone(
        "SELECT MAX(time) AS max_time FROM ohlc WHERE ticker = ? AND interval = ?",
        (ticker, interval),
    )
    if not row or row["max_time"] is None:
        return None
    return int(row["max_time"])


def _read_history(ticker: str, interval: str, start_time: int, since: int | None = None) -> list[Candle]:
    if since is not None:
        rows = fetchall(
            """
            SELECT time, open, high, low, close, volume
            FROM ohlc
            WHERE ticker = ? AND interval = ? AND time > ?
            ORDER BY time ASC
            """,
            (ticker, interval, since),
        )
    else:
        rows = fetchall(
            """
            SELECT time, open, high, low, close, volume
            FROM ohlc
            WHERE ticker = ? AND interval = ? AND time >= ?
            ORDER BY time ASC
            """,
            (ticker, interval, start_time),
        )
    return [
        Candle(
            time=int(r["time"]),
            open=float(r["open"]),
            high=float(r["high"]),
            low=float(r["low"]),
            close=float(r["close"]),
            volume=None if r["volume"] is None else float(r["volume"]),
        )
        for r in rows
    ]


def _upsert_history(ticker: str, interval: str, candles: list[Candle]) -> None:
    if not candles:
        return
    params = [
        (
            ticker,
            interval,
            c.time,
            c.open,
            c.high,
            c.low,
            c.close,
            c.volume,
        )
        for c in candles
    ]
    executemany(
        """
        INSERT OR REPLACE INTO ohlc
            (ticker, interval, time, open, high, low, close, volume)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        params,
    )


def get_history(
    provider: DataProvider,
    ticker: str,
    interval: str,
    period: str | None = None,
    since: int | None = None,
) -> tuple[list[Candle], bool, int]:
    normalized = normalize_ticker(ticker)
    now_ts = _now_ts()
    period = period or DEFAULT_PERIOD

    if interval not in YAHOO_MAX_RANGE:
        raise ValueError("Unsupported interval")

    last_refresh = _get_last_refresh(normalized, interval)
    has_cache = _get_latest_time(normalized, interval) is not None
    stale = False

    if not has_cache:
        candles = provider.get_history(
            normalized, interval, period=YAHOO_MAX_RANGE.get(interval)
        )
        if not candles:
            raise ValueError("No history data returned")
        _upsert_history(normalized, interval, candles)
        _set_last_refresh(normalized, interval, now_ts)
        last_refresh = now_ts
    else:
        if last_refresh is None or now_ts - last_refresh > HISTORY_TTL_SECONDS:
            stale = True
            latest_time = _get_latest_time(normalized, interval)
            start = None
            if latest_time is not None:
                pad = INTERVAL_SECONDS.get(interval, 60) * 2
                start = max(latest_time - pad, 0)
                max_range_period = YAHOO_MAX_RANGE.get(interval)
                if max_range_period and max_range_period != "max":
                    # Keep start within provider-supported lookback for this interval.
                    start = max(start, _period_start(max_range_period, now_ts))
            try:
                delta = provider.get_history(
                    normalized,
                    interval,
                    start=start,
                    end=now_ts,
                )
                if delta:
                    _upsert_history(normalized, interval, delta)
                _set_last_refresh(normalized, interval, now_ts)
                last_refresh = now_ts
                stale = False
            except Exception:
                if last_refresh is None:
                    raise

    if since is not None:
        candles = _read_history(normalized, interval, 0, since=since)
    else:
        start_time = _period_start(period, now_ts)
        candles = _read_history(normalized, interval, start_time)
    last_updated = last_refresh or now_ts
    return candles, stale, last_updated

from __future__ import annotations

import time
from datetime import datetime, timezone
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..providers.base import DataProvider
from ..providers.yahoo import normalize_ticker
from ..schemas.models import Candle
from .config import (
    DEFAULT_PERIOD,
    HISTORY_TTL_SECONDS,
    INTERVAL_SECONDS,
    YAHOO_MAX_RANGE,
)
from .models_db import OHLC, HistoryMeta


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


async def _get_last_refresh(db: AsyncSession, ticker: str, interval: str) -> int | None:
    stmt = select(HistoryMeta.last_refresh).where(
        HistoryMeta.ticker == ticker, HistoryMeta.interval == interval
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def _set_last_refresh(db: AsyncSession, ticker: str, interval: str, timestamp: int) -> None:
    stmt = insert(HistoryMeta).values(
        ticker=ticker, interval=interval, last_refresh=timestamp
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["ticker", "interval"],
        set_={"last_refresh": timestamp},
    )
    await db.execute(stmt)


async def _get_latest_time(db: AsyncSession, ticker: str, interval: str) -> int | None:
    stmt = select(func.max(OHLC.time)).where(
        OHLC.ticker == ticker, OHLC.interval == interval
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def _read_history(
    db: AsyncSession, ticker: str, interval: str, start_time: int, since: int | None = None
) -> list[Candle]:
    stmt = select(OHLC.time, OHLC.open, OHLC.high, OHLC.low, OHLC.close, OHLC.volume).where(
        OHLC.ticker == ticker, OHLC.interval == interval
    )
    if since is not None:
        stmt = stmt.where(OHLC.time > since)
    else:
        stmt = stmt.where(OHLC.time >= start_time)

    stmt = stmt.order_by(OHLC.time.asc())
    result = await db.execute(stmt)
    rows = result.all()

    return [
        Candle(
            time=int(r.time),
            open=float(r.open),
            high=float(r.high),
            low=float(r.low),
            close=float(r.close),
            volume=None if r.volume is None else float(r.volume),
        )
        for r in rows
    ]


async def _upsert_history(db: AsyncSession, ticker: str, interval: str, candles: list[Candle]) -> None:
    if not candles:
        return

    values = [
        {
            "ticker": ticker,
            "interval": interval,
            "time": c.time,
            "open": c.open,
            "high": c.high,
            "low": c.low,
            "close": c.close,
            "volume": c.volume,
        }
        for c in candles
    ]

    stmt = insert(OHLC).values(values)
    stmt = stmt.on_conflict_do_update(
        index_elements=["ticker", "interval", "time"],
        set_={
            "open": stmt.excluded.open,
            "high": stmt.excluded.high,
            "low": stmt.excluded.low,
            "close": stmt.excluded.close,
            "volume": stmt.excluded.volume,
        },
    )
    await db.execute(stmt)


async def get_history(
    db: AsyncSession,
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

    last_refresh = await _get_last_refresh(db, normalized, interval)
    latest_time = await _get_latest_time(db, normalized, interval)
    has_cache = latest_time is not None
    stale = False

    if not has_cache:
        candles = await provider.get_history_async(
            normalized, interval, period=YAHOO_MAX_RANGE.get(interval)
        )
        if not candles:
            raise ValueError("No history data returned")
        await _upsert_history(db, normalized, interval, candles)
        await _set_last_refresh(db, normalized, interval, now_ts)
        last_refresh = now_ts
    else:
        if last_refresh is None or now_ts - last_refresh > HISTORY_TTL_SECONDS:
            stale = True
            start = None
            if latest_time is not None:
                pad = INTERVAL_SECONDS.get(interval, 60) * 2
                start = max(latest_time - pad, 0)
                max_range_period = YAHOO_MAX_RANGE.get(interval)
                if max_range_period and max_range_period != "max":
                    start = max(start, _period_start(max_range_period, now_ts))
            try:
                delta = await provider.get_history_async(
                    normalized,
                    interval,
                    start=start,
                    end=now_ts,
                )

                if delta:
                    await _upsert_history(db, normalized, interval, delta)
                await _set_last_refresh(db, normalized, interval, now_ts)
                last_refresh = now_ts
                stale = False
            except Exception:
                if last_refresh is None:
                    raise

    if since is not None:
        candles = await _read_history(db, normalized, interval, 0, since=since)
    else:
        start_time = _period_start(period, now_ts)
        candles = await _read_history(db, normalized, interval, start_time)

    last_updated = last_refresh or now_ts
    return candles, stale, last_updated

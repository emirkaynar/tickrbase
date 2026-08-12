from __future__ import annotations

import json
import time
import redis.asyncio as aioredis

from ..providers.base import DataProvider
from ..providers.yahoo import normalize_ticker
from .prices import iso_timestamp

OVERVIEW_TTL_SECONDS = 4 * 3600  # 4 hours


def _coerce_float(val: object) -> float | None:
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    return None


async def get_overview(
    provider: DataProvider,
    redis: aioredis.Redis,
    ticker: str,
) -> tuple[dict, bool, int]:
    normalized = normalize_ticker(ticker)
    now = int(time.time())
    cache_key = f"overview:{normalized}"

    cached_str = await redis.get(cache_key)
    stale_fallback: dict | None = None
    stale_fetched_at: int | None = None

    if cached_str:
        try:
            item = json.loads(cached_str)
            fetched_at = int(item["fetched_at"])
            payload = item["data"]
            stale = (now - fetched_at) > OVERVIEW_TTL_SECONDS
            if not stale:
                payload["stale"] = False
                payload["last_updated"] = iso_timestamp(fetched_at)
                return payload, False, fetched_at
            stale_fallback = payload
            stale_fetched_at = fetched_at
        except (json.JSONDecodeError, KeyError, ValueError):
            pass


    import asyncio

    # Fetch info and VWAP 5m candles concurrently in worker threads
    info_task = provider.get_company_info_async(normalized)
    history_task = provider.get_history_async(normalized, interval="5m", period="1d")

    info_res, candles_res = await asyncio.gather(info_task, history_task, return_exceptions=True)

    info = info_res if isinstance(info_res, dict) else {}
    candles = candles_res if isinstance(candles_res, list) else []

    vwap: float | None = None
    if candles:
        tot_tp_v = sum(((c.high + c.low + c.close) / 3.0) * (c.volume or 0) for c in candles)
        tot_v = sum((c.volume or 0) for c in candles)
        if tot_v > 0:
            vwap = round(tot_tp_v / tot_v, 4)


    company_name = (
        info.get("longName")
        or info.get("shortName")
        or info.get("name")
        or normalized
    )

    currency = (
        info.get("currency")
        or info.get("financialCurrency")
        or ("TRY" if normalized.endswith(".IS") else "USD")
    )

    payload = {
        "symbol": normalized,
        "currency": str(currency).upper(),
        "company_name": str(company_name),
        "market_cap": _coerce_float(info.get("marketCap")),
        "pe_ratio": _coerce_float(info.get("trailingPE")),
        "forward_pe": _coerce_float(info.get("forwardPE")),
        "eps": _coerce_float(info.get("trailingEps")),
        "forward_eps": _coerce_float(info.get("forwardEps")),
        "dividend_yield": _coerce_float(info.get("dividendYield")),
        "dividend_rate": _coerce_float(info.get("dividendRate")),
        "beta": _coerce_float(info.get("beta")),
        "fifty_two_week_high": _coerce_float(info.get("fiftyTwoWeekHigh")),
        "fifty_two_week_low": _coerce_float(info.get("fiftyTwoWeekLow")),
        "fifty_day_average": _coerce_float(info.get("fiftyDayAverage")),
        "two_hundred_day_average": _coerce_float(info.get("twoHundredDayAverage")),
        "shares_outstanding": _coerce_float(info.get("sharesOutstanding")),
        "float_shares": _coerce_float(info.get("floatShares")),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "description": info.get("longBusinessSummary"),
        "vwap": vwap,
        "stale": False,
        "last_updated": iso_timestamp(now),
    }

    try:
        await redis.set(
            cache_key,
            json.dumps({"data": payload, "fetched_at": now}),
            ex=OVERVIEW_TTL_SECONDS,
        )
    except Exception:
        pass

    return payload, False, now


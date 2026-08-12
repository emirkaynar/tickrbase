from __future__ import annotations

import time
import redis.asyncio as aioredis
from ..providers.base import DataProvider

_REDIS_TTL = 3600  # 1 hour


def _pair_key(from_c: str, to_c: str) -> str:
    return f"fx:{from_c.upper()}:{to_c.upper()}"


def _fetch_single_pair_price(provider: DataProvider, pair_ticker: str) -> float | None:
    try:
        price, _ = provider.get_price(pair_ticker)
        if price is not None and price > 0:
            return float(price)
    except Exception:
        pass
    return None


def _get_direct_rate(provider: DataProvider, from_u: str, to_u: str) -> float | None:
    """
    Attempts direct ticker lookup e.g. NOKUSD=X or USDNOK=X on Yahoo Finance.
    """
    # 1. Try FROMTO=X (e.g. NOKUSD=X)
    direct_ticker = f"{from_u}{to_u}=X"
    price = _fetch_single_pair_price(provider, direct_ticker)
    if price is not None:
        return price

    # 2. Try TOFROM=X inverted (e.g. USDNOK=X -> 1/price)
    inverted_ticker = f"{to_u}{from_u}=X"
    inv_price = _fetch_single_pair_price(provider, inverted_ticker)
    if inv_price is not None:
        return 1.0 / inv_price

    return None


async def get_fx_rate(
    redis: aioredis.Redis,
    provider: DataProvider,
    from_currency: str,
    to_currency: str,
) -> float:
    """
    Returns the live FX rate to convert 1 unit of from_currency → to_currency.
    Cached in Redis for 1 hour. Automatically handles direct lookup and USD cross-rate triangulation.
    """
    from_u = from_currency.upper().strip()
    to_u = to_currency.upper().strip()

    if from_u == to_u:
        return 1.0

    cache_key = _pair_key(from_u, to_u)
    try:
        cached = await redis.get(cache_key)
        if cached is not None:
            val = float(cached)
            if val > 0 and val != 1.0:
                return val
    except Exception:
        pass

    # 1. Direct Pair Lookup (e.g., USD -> TRY, EUR -> USD, NOK -> USD)
    rate = _get_direct_rate(provider, from_u, to_u)

    # 2. Triangulation via USD if direct pair lookup fails (e.g. NOK -> TRY via NOK->USD * USD->TRY)
    if rate is None:
        if from_u != "USD" and to_u != "USD":
            rate_from_usd = _get_direct_rate(provider, from_u, "USD")
            rate_usd_to = _get_direct_rate(provider, "USD", to_u)
            if rate_from_usd is not None and rate_usd_to is not None:
                rate = rate_from_usd * rate_usd_to

    if rate is None or rate <= 0:
        return 1.0

    try:
        await redis.setex(cache_key, _REDIS_TTL, str(rate))
        await redis.setex(_pair_key(to_u, from_u), _REDIS_TTL, str(1.0 / rate))
    except Exception:
        pass

    return rate


async def get_historical_fx_rate(
    db: any,
    provider: DataProvider,
    redis: aioredis.Redis,
    from_currency: str,
    to_currency: str,
    executed_at: int,
) -> float:
    """
    Returns the historical FX rate on or immediately prior to executed_at date.
    If executed_at is within the last 24h, uses live FX rate.
    """
    from_u = from_currency.upper().strip()
    to_u = to_currency.upper().strip()

    if from_u == to_u:
        return 1.0

    now_sec = int(time.time())
    tx_sec = executed_at if executed_at < 1e11 else int(executed_at / 1000)

    # If executed within last 24 hours, use live rate
    if now_sec - tx_sec < 86400:
        return await get_fx_rate(redis, provider, from_u, to_u)

    # Try resolving historical daily candle from history cache
    try:
        from ..core.history_cache import get_history
        direct_ticker = f"{from_u}{to_u}=X"
        candles, _, _ = await get_history(db, provider, direct_ticker, "1d", "max")
        if candles:
            matching = [c for c in candles if c.time <= tx_sec + 86400]
            if matching:
                return float(matching[-1].close)
    except Exception:
        pass

    # Fallback to live FX rate
    return await get_fx_rate(redis, provider, from_u, to_u)


def get_fx_rates_timestamp() -> int:
    """Returns current unix timestamp for the 'rates as of' indicator."""
    return int(time.time())

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
import redis.asyncio as aioredis

from ..core.config import PRICE_TTL_SECONDS
from ..providers.base import DataProvider
from ..providers.yahoo import normalize_ticker
from .cache_control import optional_get, optional_set, single_flight


def iso_timestamp(ts: int) -> str:
    return (
        datetime.fromtimestamp(ts, tz=timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


async def _get_price(
    provider: DataProvider,
    redis: aioredis.Redis,
    ticker: str,
) -> tuple[float, bool, int]:
    normalized = normalize_ticker(ticker)
    cache_key = f"price:{provider.source_id}:{normalized}"

    cached_str = await optional_get(redis, cache_key)
    now = int(time.time())

    stale_fallback: float | None = None
    stale_fetched_at: int | None = None

    if cached_str:
        try:
            data = json.loads(cached_str)
            price = float(data["price"])
            fetched_at = int(data["fetched_at"])
            stale = (now - fetched_at) > PRICE_TTL_SECONDS
            if not stale:
                return price, False, fetched_at
            stale_fallback = price
            stale_fetched_at = fetched_at
        except (json.JSONDecodeError, KeyError, ValueError, TypeError):
            pass

    try:
        price, fetched_at = await provider.get_price_async(normalized)
        payload = json.dumps({"price": price, "fetched_at": fetched_at})
        await optional_set(redis, cache_key, payload, ex=PRICE_TTL_SECONDS * 10)
        return price, False, fetched_at
    except Exception:
        if stale_fallback is not None and stale_fetched_at is not None:
            return stale_fallback, True, stale_fetched_at
        raise




def to_price_payload(ticker: str, price: float, stale: bool, fetched_at: int) -> dict:
    iso_str = iso_timestamp(fetched_at)
    return {
        "ticker": ticker,
        "current_price": price,
        "timestamp": iso_str,
        "stale": stale,
        "last_updated": iso_str,
    }


async def get_price(provider, redis, ticker):
    key = f"price:{provider.source_id}:{normalize_ticker(ticker)}"
    return await single_flight(key, lambda: _get_price(provider, redis, ticker))

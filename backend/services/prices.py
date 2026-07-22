from __future__ import annotations

import json
import time
from datetime import datetime, timezone
import redis.asyncio as aioredis

from ..core.config import PRICE_TTL_SECONDS
from ..providers.base import DataProvider
from ..providers.yahoo import normalize_ticker


def iso_timestamp(ts: int) -> str:
    return (
        datetime.fromtimestamp(ts, tz=timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


async def get_price(
    provider: DataProvider,
    redis: aioredis.Redis,
    ticker: str,
) -> tuple[float, bool, int]:
    normalized = normalize_ticker(ticker)
    cache_key = f"price:{normalized}"

    cached_str = await redis.get(cache_key)
    now = int(time.time())

    if cached_str:
        try:
            data = json.loads(cached_str)
            price = float(data["price"])
            fetched_at = int(data["fetched_at"])
            stale = (now - fetched_at) > PRICE_TTL_SECONDS
            return price, stale, fetched_at
        except (json.JSONDecodeError, KeyError, ValueError):
            pass

    price, fetched_at = provider.get_price(normalized)
    payload = json.dumps({"price": price, "fetched_at": fetched_at})
    await redis.set(cache_key, payload, ex=PRICE_TTL_SECONDS * 2)

    return price, False, fetched_at


def to_price_payload(ticker: str, price: float, stale: bool, fetched_at: int) -> dict:
    iso_str = iso_timestamp(fetched_at)
    return {
        "ticker": ticker,
        "current_price": price,
        "timestamp": iso_str,
        "stale": stale,
        "last_updated": iso_str,
    }

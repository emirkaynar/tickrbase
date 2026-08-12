from __future__ import annotations

import json
import time
import redis.asyncio as aioredis

from ..core.config import (
    LOOKUP_MAX_RESULTS,
    LOOKUP_MIN_QUERY_LENGTH,
    LOOKUP_TTL_SECONDS,
)
from ..providers.base import DataProvider


async def search_lookup(
    redis: aioredis.Redis,
    provider: DataProvider,
    query: str,
) -> tuple[str, list[dict], bool, int]:
    cleaned = query.strip()
    if len(cleaned) < LOOKUP_MIN_QUERY_LENGTH:
        raise ValueError(
            f"Query must be at least {LOOKUP_MIN_QUERY_LENGTH} characters"
        )

    now = int(time.time())
    cache_key = f"lookup:{cleaned.lower()}"

    stale_items: list[dict] | None = None
    stale_fetched_at: int | None = None

    cached_str = await redis.get(cache_key)
    if cached_str:
        try:
            data = json.loads(cached_str)
            items = data["items"]
            fetched_at = int(data["fetched_at"])
            stale = (now - fetched_at) > LOOKUP_TTL_SECONDS
            if not stale:
                return cleaned, items, False, fetched_at
            stale_items = items
            stale_fetched_at = fetched_at
        except (json.JSONDecodeError, KeyError, ValueError):
            pass

    try:
        items = await provider.lookup_async(cleaned, count=LOOKUP_MAX_RESULTS)
        payload = json.dumps({"items": items, "fetched_at": now})
        await redis.set(cache_key, payload, ex=LOOKUP_TTL_SECONDS)
        return cleaned, items, False, now
    except Exception:

        if stale_items is not None and stale_fetched_at is not None:
            return cleaned, stale_items, True, stale_fetched_at
        raise

from __future__ import annotations

import json
import time
import redis.asyncio as aioredis

from ..core.config import FALLBACK_SYMBOLS, SYMBOLS_TTL_SECONDS


async def get_symbol_items(redis: aioredis.Redis) -> tuple[list[dict], bool, int]:
    now = int(time.time())
    cache_key = "symbols:bist"

    cached_str = await redis.get(cache_key)
    if cached_str:
        try:
            data = json.loads(cached_str)
            items = data["items"]
            fetched_at = int(data["fetched_at"])
            stale = (now - fetched_at) > SYMBOLS_TTL_SECONDS
            if not stale:
                return items, False, fetched_at
            return items, True, fetched_at
        except (json.JSONDecodeError, KeyError, ValueError):
            pass

    items = FALLBACK_SYMBOLS
    payload = json.dumps({"items": items, "fetched_at": now})
    await redis.set(cache_key, payload, ex=SYMBOLS_TTL_SECONDS)

    return items, False, now

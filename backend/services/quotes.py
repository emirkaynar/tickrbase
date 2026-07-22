from __future__ import annotations

import json
import time
import redis.asyncio as aioredis

from ..core.config import QUOTES_TTL_SECONDS
from ..providers.base import DataProvider
from ..providers.yahoo import normalize_ticker
from .prices import iso_timestamp


def normalize_symbols(symbols: list[str]) -> list[str]:
    seen: set[str] = set()
    results: list[str] = []
    for s in symbols:
        norm = normalize_ticker(s)
        if norm and norm not in seen:
            seen.add(norm)
            results.append(norm)
    return results


async def get_quotes(
    provider: DataProvider,
    redis: aioredis.Redis,
    symbols: list[str],
    fields: set[str],
) -> tuple[list[dict], bool, int]:
    now = int(time.time())
    results: list[dict] = []
    any_stale = False
    max_fetched_at = 0
    field_key = ",".join(sorted(fields))

    missing_symbols: list[str] = []

    for sym in symbols:
        cache_key = f"quote:{sym}:{field_key}"
        cached_str = await redis.get(cache_key)
        if cached_str:
            try:
                item = json.loads(cached_str)
                fetched_at = int(item["fetched_at"])
                payload = item["data"]
                stale = (now - fetched_at) > QUOTES_TTL_SECONDS
                payload["stale"] = stale
                payload["last_updated"] = iso_timestamp(fetched_at)
                results.append(payload)
                if stale:
                    any_stale = True
                max_fetched_at = max(max_fetched_at, fetched_at)
                continue
            except (json.JSONDecodeError, KeyError, ValueError):
                pass
        missing_symbols.append(sym)

    for sym in missing_symbols:
        try:
            payload, fetched_at = provider.get_quote_snapshot(sym, groups=fields)
            payload["stale"] = False
            payload["last_updated"] = iso_timestamp(fetched_at)
            results.append(payload)
            max_fetched_at = max(max_fetched_at, fetched_at)

            cache_key = f"quote:{sym}:{field_key}"
            await redis.set(
                cache_key,
                json.dumps({"data": payload, "fetched_at": fetched_at}),
                ex=QUOTES_TTL_SECONDS * 2,
            )
        except Exception:
            results.append(
                {
                    "symbol": sym,
                    "current_price": None,
                    "stale": True,
                    "last_updated": iso_timestamp(now),
                }
            )
            any_stale = True

    return results, any_stale, max_fetched_at or now

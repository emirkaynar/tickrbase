from __future__ import annotations

import json
import asyncio
import time
import redis.asyncio as aioredis

from ..core.config import QUOTES_TTL_SECONDS
from ..providers.base import DataProvider
from ..providers.yahoo import normalize_ticker
from .prices import iso_timestamp
from .cache_control import single_flight
from ..core.telemetry import increment


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

    cached_stale_fallbacks: dict[str, tuple[dict, int]] = {}

    keys = [f"quote:{provider.source_id}:{sym}:{field_key}" for sym in symbols]
    try:
        cached_values = await asyncio.wait_for(redis.mget(keys), timeout=1)
        for value in cached_values:
            increment("cache_get_hit" if value is not None else "cache_get_miss")
    except Exception:
        increment("cache_read_failed")
        cached_values = [None] * len(keys)
    writes = []
    for sym, cached_str in zip(symbols, cached_values):
        if cached_str:
            try:
                item = json.loads(cached_str)
                fetched_at = int(item["fetched_at"])
                payload = item["data"]
                stale = (now - fetched_at) > QUOTES_TTL_SECONDS
                if not stale:
                    payload = {**payload, "symbol": sym}
                    payload["stale"] = False
                    payload["last_updated"] = iso_timestamp(fetched_at)
                    results.append(payload)
                    max_fetched_at = max(max_fetched_at, fetched_at)
                    continue
                cached_stale_fallbacks[sym] = (payload, fetched_at)
            except (json.JSONDecodeError, KeyError, ValueError, TypeError):
                pass
        missing_symbols.append(sym)



    if missing_symbols:
        async def _fetch_one(sym: str) -> tuple[str, dict | None, int | None]:
            try:
                payload, fetched_at = await single_flight(
                    f"quote:{provider.source_id}:{sym}:{field_key}",
                    lambda: provider.get_quote_snapshot_async(sym, groups=fields),
                )
                return sym, payload, fetched_at
            except Exception:
                return sym, None, None

        tasks = [_fetch_one(sym) for sym in missing_symbols]
        quote_results = await asyncio.gather(*tasks)

        for sym, payload, fetched_at in quote_results:
            if payload is not None and fetched_at is not None:
                payload = {**payload, "symbol": sym}
                payload["stale"] = False
                payload["last_updated"] = iso_timestamp(fetched_at)
                results.append(payload)
                max_fetched_at = max(max_fetched_at, fetched_at)

                cache_key = f"quote:{provider.source_id}:{sym}:{field_key}"
                writes.append((cache_key, json.dumps({"data": payload, "fetched_at": fetched_at})))
            elif sym in cached_stale_fallbacks:
                fallback_payload, fallback_ts = cached_stale_fallbacks[sym]
                fallback_payload["stale"] = True
                fallback_payload["last_updated"] = iso_timestamp(fallback_ts)
                results.append(fallback_payload)
                any_stale = True
                max_fetched_at = max(max_fetched_at, fallback_ts)
            else:
                results.append(
                    {
                        "symbol": sym,
                        "current_price": None,
                        "stale": True,
                        "last_updated": iso_timestamp(now),
                    }
                )
                any_stale = True


    if writes:
        try:
            pipe = redis.pipeline(transaction=False)
            for key, value in writes:
                pipe.set(key, value, ex=QUOTES_TTL_SECONDS * 10)
            await asyncio.wait_for(pipe.execute(), timeout=1)
        except Exception:
            increment("cache_write_failed")
            pass  # Optional market cache must not discard successful quotes.
    by_symbol = {item["symbol"]: item for item in results}
    return [by_symbol[sym] for sym in symbols], any_stale, max_fetched_at or now


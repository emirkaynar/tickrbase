"""Optional market-cache degradation and bounded, per-process miss coalescing.

Security stores must use Redis directly: these helpers intentionally fail open.
Single API worker owns streaming until a shared upstream lease is introduced.
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from ..core.telemetry import increment

logger = logging.getLogger(__name__)
_flights: dict[tuple[asyncio.AbstractEventLoop, str], asyncio.Task] = {}
MAX_FLIGHTS = 64
PROVIDER_DEADLINE_SECONDS = 12


async def optional_get(redis, key):
    try:
        value = await asyncio.wait_for(redis.get(key), timeout=1)
        increment("cache_get_hit" if value is not None else "cache_get_miss")
        return value
    except Exception:
        increment('cache_read_failed')
        logger.warning('market_cache_read_failed')
        return None


async def optional_set(redis, key, value, **kwargs):
    try:
        return await asyncio.wait_for(redis.set(key, value, **kwargs), timeout=1)
    except Exception:
        increment('cache_write_failed')
        logger.warning('market_cache_write_failed')
        return None


async def single_flight(key: str, factory: Callable[[], Awaitable[Any]]):
    flight_key = (asyncio.get_running_loop(), key)
    task = _flights.get(flight_key)
    if task is None:
        if len(_flights) >= MAX_FLIGHTS:
            increment("singleflight_rejected")
            raise RuntimeError('Market provider capacity exhausted')
        async def run():
            try:
                return await asyncio.wait_for(factory(), PROVIDER_DEADLINE_SECONDS)
            finally:
                _flights.pop(flight_key, None)
        task = asyncio.create_task(run())
        # Retrieve failures even when all original callers disconnected.
        task.add_done_callback(lambda t: t.exception() if not t.cancelled() else None)
        _flights[flight_key] = task
    else:
        increment("singleflight_joined")
    return await asyncio.shield(task)

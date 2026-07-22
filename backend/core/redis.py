from __future__ import annotations

from typing import AsyncGenerator
import redis.asyncio as aioredis
from .config import REDIS_URL

_redis_pool: aioredis.Redis | None = None


def get_redis_client() -> aioredis.Redis:
    global _redis_pool
    if _redis_pool is None:
        _redis_pool = aioredis.from_url(
            REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis_pool


async def close_redis() -> None:
    global _redis_pool
    if _redis_pool is not None:
        await _redis_pool.aclose()
        _redis_pool = None


async def get_redis() -> AsyncGenerator[aioredis.Redis, None]:
    client = get_redis_client()
    try:
        yield client
    finally:
        pass

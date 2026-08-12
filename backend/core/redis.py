from __future__ import annotations

import time
from typing import Any, AsyncGenerator
import redis.asyncio as aioredis
from .config import ENABLE_REDIS_LOGGING, REDIS_URL

_redis_pool: aioredis.Redis | None = None


class LoggingRedisProxy:
    """Proxy around aioredis.Redis to log key operations in dev mode."""
    def __init__(self, client: aioredis.Redis) -> None:
        self._client = client

    async def get(self, name: str) -> str | None:
        start = time.perf_counter()
        val = await self._client.get(name)
        ms = (time.perf_counter() - start) * 1000.0
        if val is not None:
            print(f"🟢 [REDIS GET HIT  {ms:5.2f}ms] {name}")
        else:
            print(f"🟡 [REDIS GET MISS {ms:5.2f}ms] {name}")
        return val

    async def set(self, name: str, value: Any, ex: int | None = None, **kwargs: Any) -> Any:
        start = time.perf_counter()
        res = await self._client.set(name, value, ex=ex, **kwargs)
        ms = (time.perf_counter() - start) * 1000.0
        ex_str = f" (ex={ex}s)" if ex else ""
        print(f"🟢 [REDIS SET      {ms:5.2f}ms] {name}{ex_str}")
        return res

    async def delete(self, *names: str) -> int:
        start = time.perf_counter()
        res = await self._client.delete(*names)
        ms = (time.perf_counter() - start) * 1000.0
        print(f"🔴 [REDIS DEL      {ms:5.2f}ms] {', '.join(names)}")
        return res

    def __getattr__(self, item: str) -> Any:
        return getattr(self._client, item)


def get_redis_client() -> aioredis.Redis:
    global _redis_pool
    if _redis_pool is None:
        client = aioredis.from_url(
            REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
        )
        if ENABLE_REDIS_LOGGING:
            _redis_pool = LoggingRedisProxy(client)  # type: ignore
        else:
            _redis_pool = client
    return _redis_pool


async def close_redis() -> None:
    global _redis_pool
    if _redis_pool is not None:
        client = getattr(_redis_pool, "_client", _redis_pool)
        await client.aclose()
        _redis_pool = None


async def get_redis() -> AsyncGenerator[aioredis.Redis, None]:
    client = get_redis_client()
    try:
        yield client
    finally:
        pass


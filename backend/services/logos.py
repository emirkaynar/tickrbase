from __future__ import annotations

import base64
from datetime import datetime

import httpx

from ..core.config import (
    LOGO_CACHE_TTL_SECONDS,
    LOGO_DEV_MONTHLY_LIMIT,
    LOGO_DEV_TOKEN,
)
from ..core.redis import get_redis_client

_CACHE_PREFIX = "logo:bytes:"
_COUNTER_PREFIX = "logo:monthly:"


def _counter_key() -> str:
    now = datetime.utcnow()
    return f"{_COUNTER_PREFIX}{now.year}:{now.month:02}"


async def get_logo(symbol: str) -> bytes | None:
    """
    Fetch a logo image for *symbol* directly from logo.dev via backend proxy.
    Passes full ticker (e.g., THYAO.IS) with fallback=404.
    """
    if not LOGO_DEV_TOKEN:
        return None

    redis = get_redis_client()
    cache_key = f"{_CACHE_PREFIX}{symbol.upper()}"

    # 1. Redis cache hit
    cached_b64 = await redis.get(cache_key)
    if cached_b64:
        if cached_b64 != "NOT_FOUND":
            print(f"🟢 [LOGO REDIS CACHE HIT] {symbol.upper()}")
            return base64.b64decode(cached_b64)
        print(f"🟡 [LOGO REDIS CACHE NEGATIVE] {symbol.upper()} (cached 404)")
        return None

    print(f"⚡ [LOGO REDIS CACHE MISS] {symbol.upper()} -> fetching live upstream from logo.dev")

    # 2. Monthly rate-limit check
    counter_key = _counter_key()
    count_raw = await redis.get(counter_key)
    if count_raw and int(count_raw) >= LOGO_DEV_MONTHLY_LIMIT:
        return None

    # 3. Upstream fetch using raw symbol & fallback=404
    url = (
        f"https://img.logo.dev/ticker/{symbol}"
        f"?token={LOGO_DEV_TOKEN}&fallback=404&size=128&theme=dark&format=webp"
    )

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Authorization": f"Bearer {LOGO_DEV_TOKEN}",
    }

    try:
        async with httpx.AsyncClient(timeout=5.0, headers=headers) as client:
            resp = await client.get(url)
            print(f"[LOGO.DEV] GET {url} -> {resp.status_code}")
    except Exception as exc:
        print(f"[LOGO.DEV ERROR] {url}: {exc}")
        return None

    if resp.status_code != 200:
        # Cache 404 negative result for 60s
        await redis.set(cache_key, "NOT_FOUND", ex=60)
        return None

    # 4. Persist valid image to Redis as base64 + increment monthly counter
    encoded = base64.b64encode(resp.content).decode("ascii")
    await redis.set(cache_key, encoded, ex=LOGO_CACHE_TTL_SECONDS)

    pipe = redis.pipeline()
    pipe.incr(counter_key)
    pipe.expire(counter_key, 60 * 60 * 24 * 32)  # 32 days
    await pipe.execute()

    return resp.content

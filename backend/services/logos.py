from __future__ import annotations

import base64
import re
from datetime import datetime

import httpx

from ..core.config import (
    LOGO_CACHE_TTL_SECONDS,
    LOGO_DEV_MONTHLY_LIMIT,
    LOGO_DEV_TOKEN,
    LOGO_NEGATIVE_CACHE_TTL_SECONDS,
)
from ..core.redis import get_redis_client

_CACHE_PREFIX = "logo:bytes:"
_COUNTER_PREFIX = "logo:monthly:"
_TICKER_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,15}$")


def _counter_key() -> str:
    now = datetime.utcnow()
    return f"{_COUNTER_PREFIX}{now.year}:{now.month:02}"


async def _fetch_logo_from_dev(client: httpx.AsyncClient, ticker_str: str) -> tuple[int, bytes | None]:
    url = (
        f"https://img.logo.dev/ticker/{ticker_str}"
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
        resp = await client.get(url, headers=headers)
        print(f"[LOGO.DEV] GET {url} -> {resp.status_code}")
        if resp.status_code == 200:
            return 200, resp.content
        return resp.status_code, None
    except Exception as exc:
        print(f"[LOGO.DEV ERROR] {url}: {exc}")
        return 500, None


async def get_logo(symbol: str) -> bytes | None:
    """
    Fetch a logo image for *symbol* directly from logo.dev via backend proxy.
    Checks Redis cache first. If 404, caches negative NOT_FOUND result for 30 days.
    """
    if not LOGO_DEV_TOKEN:
        return None

    sym_clean = symbol.upper().strip()
    if not _TICKER_PATTERN.fullmatch(sym_clean):
        return None

    redis = get_redis_client()
    cache_key = f"{_CACHE_PREFIX}{sym_clean}"

    # 1. Redis cache hit check
    cached_b64 = await redis.get(cache_key)
    if cached_b64:
        if cached_b64 != "NOT_FOUND":
            print(f"🟢 [LOGO REDIS CACHE HIT] {sym_clean}")
            return base64.b64decode(cached_b64)
        print(f"🟡 [LOGO REDIS CACHE NEGATIVE] {sym_clean} (cached 404)")
        return None

    print(f"⚡ [LOGO REDIS CACHE MISS] {sym_clean} -> fetching live upstream from logo.dev")

    # 2. Monthly rate-limit check
    counter_key = _counter_key()
    count_raw = await redis.get(counter_key)
    if count_raw and int(count_raw) >= LOGO_DEV_MONTHLY_LIMIT:
        return None

    # 3. Fetch from logo.dev (full ticker first)
    async with httpx.AsyncClient(timeout=5.0) as client:
        status, content = await _fetch_logo_from_dev(client, sym_clean)

        # Fallback to base symbol if full ticker returns 404 (e.g. THYAO.IS -> THYAO)
        if status == 404 and "." in sym_clean:
            base_symbol = sym_clean.split(".")[0]
            if base_symbol and base_symbol != sym_clean:
                print(f"⚡ [LOGO FALLBACK ATTEMPT] {sym_clean} -> trying base ticker {base_symbol}")
                status, content = await _fetch_logo_from_dev(client, base_symbol)

    if status != 200 or content is None:
        # Cache 404 negative result in Redis for 30 days to avoid repeated upstream calls
        await redis.set(cache_key, "NOT_FOUND", ex=LOGO_NEGATIVE_CACHE_TTL_SECONDS)
        return None

    # 4. Save valid image to Redis as base64 + increment monthly counter
    encoded = base64.b64encode(content).decode("ascii")
    await redis.set(cache_key, encoded, ex=LOGO_CACHE_TTL_SECONDS)

    pipe = redis.pipeline()
    pipe.incr(counter_key)
    pipe.expire(counter_key, 60 * 60 * 24 * 32)  # 32 days
    await pipe.execute()

    return content

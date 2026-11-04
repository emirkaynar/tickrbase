from __future__ import annotations

import base64
import asyncio
from uuid import uuid4
import logging
import re
from datetime import datetime, timezone
from urllib.parse import quote, quote_plus

import httpx

from ..core.config import (
    LOGO_CACHE_TTL_SECONDS,
    LOGO_DEV_MONTHLY_LIMIT,
    LOGO_DEV_TOKEN,
    LOGO_NEGATIVE_CACHE_TTL_SECONDS,
)
from ..core.redis import get_redis_client
from ..core.telemetry import increment, adjust

_CACHE_PREFIX = "logo:bytes:"
_COUNTER_PREFIX = "logo:monthly:"
_TICKER_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,15}$")
logger = logging.getLogger(__name__)
_client: httpx.AsyncClient | None = None
_inflight: dict[str, asyncio.Task] = {}
MAX_IMAGE_BYTES = 256 * 1024
_RESERVE = """
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count >= tonumber(ARGV[1]) then return 0 end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
"""
_UNLOCK = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0"


class LogoUnavailable(Exception):
    """Quota or dependencies unavailable; never a confirmed missing logo."""


def _get_client():
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(5, pool=1),
            limits=httpx.Limits(max_connections=8, max_keepalive_connections=8), follow_redirects=False)
    return _client


async def close_logo_client():
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


async def reserve_request(principal: int):
    """Authenticated reads have a distributed per-principal one-minute budget."""
    try:
        allowed = await get_redis_client().eval(_RESERVE, 1, f'logo:requests:{principal}', 60, 60)
    except Exception:
        raise LogoUnavailable() from None
    if not allowed:
        increment('logo_budget_rejected')
        raise LogoUnavailable()


class _RedactLogoToken(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        if LOGO_DEV_TOKEN:
            for value in (LOGO_DEV_TOKEN, quote(LOGO_DEV_TOKEN, safe=""), quote_plus(LOGO_DEV_TOKEN)):
                message = message.replace(value, "[REDACTED]")
        record.msg = message
        record.args = ()
        return True


# HTTPX logs full request URLs at INFO, including the provider's query token.
logging.getLogger("httpx").addFilter(_RedactLogoToken())


def _counter_key() -> str:
    now = datetime.now(timezone.utc)
    return f"{_COUNTER_PREFIX}{now.year}:{now.month:02}"


async def _fetch_logo_from_dev(client: httpx.AsyncClient, ticker_str: str) -> tuple[int, bytes | None]:
    url = f"https://img.logo.dev/ticker/{ticker_str}"
    params = {"token": LOGO_DEV_TOKEN, "fallback": "404", "size": "128", "theme": "dark", "format": "webp"}
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Authorization": f"Bearer {LOGO_DEV_TOKEN}",
    }
    try:
        async with client.stream('GET', url, params=params, headers=headers) as resp:
            logger.info("Logo provider response ticker=%s status=%s", ticker_str, resp.status_code)
            if resp.status_code != 200:
                return resp.status_code, None
            if resp.headers.get('content-type', '').split(';')[0] != 'image/webp':
                return 502, None
            chunks = bytearray()
            async for chunk in resp.aiter_bytes(chunk_size=16384):
                chunks.extend(chunk)
                if len(chunks) > MAX_IMAGE_BYTES:
                    return 502, None
            content = bytes(chunks)
            if len(content) < 12 or content[:4] != b'RIFF' or content[8:12] != b'WEBP':
                return 502, None
            return 200, content
    except Exception as exc:
        # Exception text may contain the authenticated request URL.
        logger.warning("Logo provider request failed ticker=%s error_type=%s", ticker_str, type(exc).__name__)
        return 500, None


async def get_logo(symbol: str) -> bytes | None:
    if not LOGO_DEV_TOKEN:
        return None

    sym_clean = symbol.upper().strip()
    if not _TICKER_PATTERN.fullmatch(sym_clean):
        return None

    # Bound queued unique misses as well as the reusable HTTP connection pool.
    task = _inflight.get(sym_clean)
    if task is not None:
        increment('logo_coalesced')
    if task is None:
        if len(_inflight) >= 64:
            raise LogoUnavailable()
        task = asyncio.create_task(asyncio.wait_for(_load_logo(sym_clean), timeout=12))
        _inflight[sym_clean] = task
        adjust('logo_inflight', 1)
        def completed(done):
            _inflight.pop(sym_clean, None)
            adjust('logo_inflight', -1)
            if not done.cancelled():
                done.exception()  # Retrieve failures even after every shielded caller disconnected.
        task.add_done_callback(completed)
    try:
        return await asyncio.shield(task)
    except TimeoutError:
        raise LogoUnavailable() from None


async def _load_logo(sym_clean: str) -> bytes | None:
    redis = get_redis_client()
    cache_key = f"{_CACHE_PREFIX}{sym_clean}"
    owner = uuid4().hex
    lock_key = f'logo:lock:{sym_clean}'
    locked = False
    try:
        for _ in range(20):
            cached = await redis.get(cache_key)
            if cached:
                increment('logo_cache_hit')
                return None if cached == 'NOT_FOUND' else base64.b64decode(cached, validate=True)
            locked = await redis.set(lock_key, owner, nx=True, ex=15)
            if locked:
                break
            await asyncio.sleep(0.05)
        if not locked:
            raise LogoUnavailable()

        async def attempt(ticker):
            # Reserve before EVERY attempt, including fallback/404/timeouts; Redis fails closed.
            if not await redis.eval(_RESERVE, 1, _counter_key(), LOGO_DEV_MONTHLY_LIMIT, 32 * 86400):
                increment('logo_budget_rejected')
                raise LogoUnavailable()
            increment('logo_provider_attempt')
            return await asyncio.wait_for(_fetch_logo_from_dev(_get_client(), ticker), timeout=5)

        status, content = await attempt(sym_clean)
        if status == 404 and '.' in sym_clean:
            status, content = await attempt(sym_clean.split('.')[0])
        if status == 404:
            increment('logo_missing')
            await redis.set(cache_key, 'NOT_FOUND', ex=LOGO_NEGATIVE_CACHE_TTL_SECONDS)
            return None
        if status != 200 or content is None:
            increment('logo_provider_failed')
            raise LogoUnavailable()
        await redis.set(cache_key, base64.b64encode(content).decode('ascii'), ex=LOGO_CACHE_TTL_SECONDS)
        return content
    except LogoUnavailable:
        raise
    except Exception:
        raise LogoUnavailable() from None
    finally:
        if locked:
            try:
                await redis.eval(_UNLOCK, 1, lock_key, owner)
            except Exception:
                pass  # Lease expires; do not replace the original safe failure.

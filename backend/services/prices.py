from __future__ import annotations

from datetime import datetime, timezone

from ..core.cache import TTLCache
from ..core.provider import DataProvider


def iso_timestamp(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def get_price(
    provider: DataProvider,
    cache: TTLCache[float],
    ticker: str,
) -> tuple[float, bool, int]:
    cached = cache.get(ticker)
    if cached and not cached.stale:
        return cached.value, False, cached.fetched_at

    try:
        price, fetched_at = provider.get_price(ticker)
        cache.set(ticker, price, fetched_at)
        return price, False, fetched_at
    except Exception:
        if cached:
            return cached.value, True, cached.fetched_at
        raise


def to_price_payload(ticker: str, price: float, stale: bool, fetched_at: int) -> dict:
    return {
        "ticker": ticker,
        "current_price": price,
        "timestamp": iso_timestamp(fetched_at),
        "stale": stale,
        "last_updated": iso_timestamp(fetched_at),
    }

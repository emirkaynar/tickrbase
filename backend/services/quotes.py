from __future__ import annotations

import time

from ..core.cache import TTLCache
from ..core.provider import DataProvider
from .prices import iso_timestamp


def _normalize_symbol(symbol: str) -> str:
    return symbol.strip().upper()


def normalize_symbols(symbols: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []

    for raw in symbols:
        normalized = _normalize_symbol(raw)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(normalized)

    return ordered


def _group_key(groups: set[str]) -> str:
    return ",".join(sorted(groups))


def _cache_key(symbol: str, groups: set[str]) -> str:
    return f"{symbol}|{_group_key(groups)}"


def get_quotes(
    provider: DataProvider,
    cache: TTLCache[dict[str, object]],
    symbols: list[str],
    groups: set[str],
) -> tuple[list[dict[str, object]], bool, int]:
    normalized_symbols = normalize_symbols(symbols)
    now = int(time.time())

    quotes: list[dict[str, object]] = []
    stale_any = False
    latest_fetched_at = 0

    for symbol in normalized_symbols:
        key = _cache_key(symbol, groups)
        cached = cache.get(key)

        if cached and not cached.stale:
            payload = dict(cached.value)
            fetched_at = cached.fetched_at
            stale = False
        else:
            try:
                payload, fetched_at = provider.get_quote_snapshot(symbol, groups)
                cache.set(key, payload, fetched_at)
                stale = False
            except Exception:
                if cached:
                    payload = dict(cached.value)
                    fetched_at = cached.fetched_at
                    stale = True
                else:
                    payload = {
                        "symbol": symbol,
                        "current_price": None,
                        "previous_close": None,
                        "open": None,
                        "day_low": None,
                        "day_high": None,
                        "change": None,
                        "change_percent": None,
                        "volume": None,
                        "volume_value": None,
                        "bid": None,
                        "ask": None,
                    }
                    fetched_at = now
                    stale = True

        stale_any = stale_any or stale
        latest_fetched_at = max(latest_fetched_at, fetched_at)

        quotes.append(
            {
                **payload,
                "stale": stale,
                "last_updated": iso_timestamp(fetched_at),
            }
        )

    if latest_fetched_at == 0:
        latest_fetched_at = now

    return quotes, stale_any, latest_fetched_at

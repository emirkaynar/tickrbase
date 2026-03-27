from __future__ import annotations

import time

from ..core.config import LOOKUP_MAX_RESULTS, LOOKUP_MIN_QUERY_LENGTH, LOOKUP_TTL_SECONDS
from ..core.db import get_lookup, set_lookup
from ..core.provider import DataProvider


def _normalize_query(query: str) -> str:
    normalized = query.strip()
    if len(normalized) < LOOKUP_MIN_QUERY_LENGTH:
        raise ValueError(
            f"Lookup query must be at least {LOOKUP_MIN_QUERY_LENGTH} characters"
        )
    return normalized


def search_lookup(
    provider: DataProvider,
    query: str,
    count: int = LOOKUP_MAX_RESULTS,
) -> tuple[str, list[dict], bool, int]:
    normalized_query = _normalize_query(query)
    cache_key = normalized_query.lower()
    now_ts = int(time.time())
    limit = max(1, min(count, LOOKUP_MAX_RESULTS))

    cached = get_lookup(cache_key)
    if cached:
        items, fetched_at = cached
        stale = now_ts - fetched_at > LOOKUP_TTL_SECONDS
        if not stale:
            return normalized_query, items[:limit], False, fetched_at

    try:
        items = provider.lookup(normalized_query, limit)
        set_lookup(cache_key, items, now_ts)
        return normalized_query, items, False, now_ts
    except Exception:
        if cached:
            items, fetched_at = cached
            return normalized_query, items[:limit], True, fetched_at
        raise

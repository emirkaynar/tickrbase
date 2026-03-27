from __future__ import annotations

import time

import httpx

from ..core.config import FALLBACK_SYMBOLS, SYMBOLS_TTL_SECONDS, TRADINGVIEW_SCANNER_URL
from ..core.db import get_symbols, set_symbols


def get_symbol_items() -> tuple[list[dict], bool, int]:
    cached = get_symbols()
    now_ts = int(time.time())
    if cached:
        items, fetched_at = cached
        stale = now_ts - fetched_at > SYMBOLS_TTL_SECONDS
        if not stale and items:
            return items, False, fetched_at

    if cached:
        items, fetched_at = cached
        return items, True, fetched_at

    return FALLBACK_SYMBOLS, True, now_ts

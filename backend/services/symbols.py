from __future__ import annotations

import time

import httpx

from ..core.config import FALLBACK_SYMBOLS, SYMBOLS_TTL_SECONDS, TRADINGVIEW_SCANNER_URL
from ..core.db import get_symbols, set_symbols


def _fetch_from_tradingview() -> list[dict]:
    body = {"columns": []}
    with httpx.Client(timeout=10.0) as client:
        res = client.post(TRADINGVIEW_SCANNER_URL, json=body)
        res.raise_for_status()
        payload = res.json()
    rows = payload.get("data", [])
    items = []
    for row in rows:
        symbol = row.get("s") if isinstance(row, dict) else None
        if not symbol:
            continue
        ticker = symbol.replace("BIST:", "")
        items.append({"label": ticker, "value": f"{ticker}.IS"})
    items.sort(key=lambda item: item["label"])
    return items


def get_symbol_items() -> tuple[list[dict], bool, int]:
    cached = get_symbols()
    now_ts = int(time.time())
    if cached:
        items, fetched_at = cached
        stale = now_ts - fetched_at > SYMBOLS_TTL_SECONDS
        if not stale and items:
            return items, False, fetched_at

    try:
        items = _fetch_from_tradingview()
        if items:
            set_symbols(items, now_ts)
            return items, False, now_ts
    except Exception:
        pass

    if cached:
        items, fetched_at = cached
        return items, True, fetched_at

    return FALLBACK_SYMBOLS, True, now_ts

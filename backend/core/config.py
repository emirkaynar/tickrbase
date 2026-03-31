from __future__ import annotations

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "lima.db"

CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

PRICE_TTL_SECONDS = 60
HISTORY_TTL_SECONDS = 600
SYMBOLS_TTL_SECONDS = 86_400
LOOKUP_TTL_SECONDS = 900
LOOKUP_MIN_QUERY_LENGTH = 2
LOOKUP_MAX_RESULTS = 25
ALERT_INTERVAL_SECONDS = 180
WATCHLIST_STALE_SECONDS = 86_400

WS_PROTOCOL_VERSION = "1.0"
WS_MAX_CLIENTS = 200
WS_MAX_SYMBOLS_PER_CLIENT = 100
WS_MAX_GLOBAL_SYMBOLS = 2000
WS_COMMAND_RATE_LIMIT_PER_SEC = 20
WS_CLIENT_QUEUE_SIZE = 500
WS_RECONNECT_BACKOFF_MIN_SECONDS = 1.0
WS_RECONNECT_BACKOFF_MAX_SECONDS = 30.0

BIST_SUFFIX = ".IS"

DEFAULT_INTERVAL = "1d"
DEFAULT_PERIOD = "max"

INTERVAL_SECONDS = {
    "1m": 60,
    "5m": 5 * 60,
    "15m": 15 * 60,
    "30m": 30 * 60,
    "1h": 60 * 60,
    "1d": 24 * 60 * 60,
    "1wk": 7 * 24 * 60 * 60,
    "1mo": 30 * 24 * 60 * 60,
}

YAHOO_MAX_RANGE = {
    "1m": "8d",
    "5m": "5d",
    "15m": "1mo",
    "30m": "1mo",
    "1h": "3mo",
    "1d": "5y",
    "1wk": "10y",
    "1mo": "max",
}

TRADINGVIEW_SCANNER_URL = "https://scanner.tradingview.com/turkey/scan"

FALLBACK_SYMBOLS = [
    {"label": "ASELS", "value": "ASELS.IS"},
    {"label": "THYAO", "value": "THYAO.IS"},
    {"label": "BESTE", "value": "BESTE.IS"},
    {"label": "XU100", "value": "XU100.IS"},
    {"label": "XU030", "value": "XU030.IS"},
]

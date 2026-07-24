from __future__ import annotations

import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parents[1]

# Load .env.dev if present locally
env_dev = BASE_DIR / ".env.dev"
if env_dev.exists():
    load_dotenv(dotenv_path=env_dev)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://tickrbase:tickrbasepass@localhost:5432/tickrbase",
)
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

JWT_SECRET = os.getenv("JWT_SECRET", "dev_secret_key_change_in_production_987654321_tickrbase")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

COOKIE_SECURE = os.getenv("COOKIE_SECURE", "False").lower() in ("true", "1", "t")
COOKIE_SAMESITE = os.getenv("COOKIE_SAMESITE", "lax")

cors_env = os.getenv("CORS_ORIGINS")
if cors_env:
    CORS_ORIGINS = [o.strip() for o in cors_env.split(",") if o.strip()]
else:
    CORS_ORIGINS = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

PRICE_TTL_SECONDS = 60
QUOTES_TTL_SECONDS = 20
QUOTES_MAX_SYMBOLS_PER_REQUEST = 25
QUOTES_DEFAULT_GROUPS = ("session", "volume", "quote")
HISTORY_TTL_SECONDS = 600
SYMBOLS_TTL_SECONDS = 86_400
LOOKUP_TTL_SECONDS = 900
LOOKUP_MIN_QUERY_LENGTH = 2
LOOKUP_MAX_RESULTS = 25

WS_PROTOCOL_VERSION = "1.0"
WS_MAX_CLIENTS = 200
WS_MAX_SYMBOLS_PER_CLIENT = 100
WS_MAX_GLOBAL_SYMBOLS = 2000
WS_COMMAND_RATE_LIMIT_PER_SEC = 20
WS_CLIENT_QUEUE_SIZE = 500
WS_RECONNECT_BACKOFF_MIN_SECONDS = 1
WS_RECONNECT_BACKOFF_MAX_SECONDS = 30

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

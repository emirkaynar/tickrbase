from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlsplit
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parents[1]

ENV_NAME = os.getenv("ENV", "dev").strip().lower()
DEV_MODE = ENV_NAME in ("dev", "development", "local")
if ENV_NAME not in ("dev", "development", "local", "test", "testing", "staging", "prod", "production"):
    raise ValueError("ENV must name a supported environment")

# The process selects the environment before any local file is read.
env_dev = BASE_DIR / ".env.dev"
if DEV_MODE and env_dev.exists():
    load_dotenv(dotenv_path=env_dev, override=False)


def _boolean(name: str, default: bool) -> bool:
    value = os.getenv(name, str(default)).strip().lower()
    if value not in ("true", "false", "1", "0", "t", "f"):
        raise ValueError(f"{name} must be a boolean")
    return value in ("true", "1", "t")


def _positive_integer(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        raise ValueError(f"{name} must be a positive integer") from None
    if value <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return value


if not DEV_MODE:
    for name in ("DATABASE_URL", "REDIS_URL", "CORS_ORIGINS"):
        if not os.getenv(name, "").strip():
            raise ValueError(f"{name} must be explicitly configured outside local development")

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://tickrbase:tickrbasepass@localhost:5432/tickrbase",
)
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

JWT_SECRET = os.getenv("JWT_SECRET", "")
if len(JWT_SECRET.strip().encode("utf-8")) < 32 or any(
    marker in JWT_SECRET.lower() for marker in ("dev_secret", "change_me", "change_in_production", "replace_me")
):
    raise ValueError("JWT_SECRET must be an explicit random secret of at least 32 bytes")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
if JWT_ALGORITHM not in ("HS256", "HS384", "HS512"):
    raise ValueError("JWT_ALGORITHM must be HS256, HS384, or HS512")
ACCESS_TOKEN_EXPIRE_MINUTES = _positive_integer("ACCESS_TOKEN_EXPIRE_MINUTES", 1440)

COOKIE_SECURE = _boolean("COOKIE_SECURE", not DEV_MODE)
COOKIE_SAMESITE = os.getenv("COOKIE_SAMESITE", "lax").strip().lower()
if COOKIE_SAMESITE not in ("lax", "strict", "none"):
    raise ValueError("COOKIE_SAMESITE must be lax, strict, or none")
if not COOKIE_SECURE and (not DEV_MODE or COOKIE_SAMESITE == "none"):
    raise ValueError("COOKIE_SECURE is required outside local development and for SameSite=None")

ENABLE_DB_LOGGING = _boolean("ENABLE_DB_LOGGING", DEV_MODE)
ENABLE_REDIS_LOGGING = _boolean("ENABLE_REDIS_LOGGING", DEV_MODE)

cors_env = os.getenv("CORS_ORIGINS")
if cors_env:
    CORS_ORIGINS = [o.strip() for o in cors_env.split(",") if o.strip()]
else:
    CORS_ORIGINS = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

if not CORS_ORIGINS:
    raise ValueError("CORS_ORIGINS must contain at least one exact origin")
for origin in CORS_ORIGINS:
    parsed = urlsplit(origin)
    try:
        parsed.port
    except ValueError:
        raise ValueError("CORS_ORIGINS contains an invalid port") from None
    if (
        not parsed.hostname or parsed.username or parsed.password
        or parsed.path or parsed.query or parsed.fragment
        or parsed.scheme not in (("http", "https") if DEV_MODE else ("https",))
    ):
        raise ValueError("CORS_ORIGINS must contain exact origins (HTTPS outside local development)")

PRICE_TTL_SECONDS = 60
QUOTES_TTL_SECONDS = 20
QUOTES_MAX_SYMBOLS_PER_REQUEST = 25
QUOTES_DEFAULT_GROUPS = ("session", "volume", "quote")
HISTORY_TTL_SECONDS = 600
SYMBOLS_TTL_SECONDS = 86_400
LOOKUP_TTL_SECONDS = 604_800  # 7 days cache for search queries
LOOKUP_MIN_QUERY_LENGTH = 2

LOOKUP_MAX_RESULTS = 25

LOGO_DEV_TOKEN = os.getenv("LOGO_DEV_TOKEN", "")
LOGO_DEV_MONTHLY_LIMIT = _positive_integer("LOGO_DEV_MONTHLY_LIMIT", 500000)
LOGO_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30  # 30 days
LOGO_NEGATIVE_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30  # 30 days


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

FALLBACK_SYMBOLS = [

    {"label": "ASELS", "value": "ASELS.IS"},
    {"label": "THYAO", "value": "THYAO.IS"},
    {"label": "BESTE", "value": "BESTE.IS"},
    {"label": "XU100", "value": "XU100.IS"},
    {"label": "XU030", "value": "XU030.IS"},
]

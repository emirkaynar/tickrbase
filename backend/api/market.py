from __future__ import annotations

from typing import Annotated, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import (
    DEFAULT_INTERVAL,
    DEFAULT_PERIOD,
    QUOTES_DEFAULT_GROUPS,
    QUOTES_MAX_SYMBOLS_PER_REQUEST,
    YAHOO_MAX_RANGE,
)
from ..core.database import get_db
from ..core.history_cache import get_history
from ..core.models_db import User
from ..providers import get_provider
from ..providers.base import DataProvider
from ..schemas.models import (
    HistoryResponse,
    LookupResponse,
    PriceResponse,
    QuotesResponse,
    SymbolsResponse,
)
from ..services import lookup as lookup_service
from ..services import prices as prices_service
from ..services import quotes as quotes_service
from ..services import symbols as symbols_service
from .deps import get_current_user, get_redis

router = APIRouter(tags=["Market Data"])


@router.get("/health")
async def health_check():
    return {"status": "ok", "service": "tickrbase-backend-v2"}


@router.get("/price/{ticker}", response_model=PriceResponse)
async def get_price(
    ticker: str,
    current_user: Annotated[User, Depends(get_current_user)],
    redis=Depends(get_redis),
):
    provider = get_provider(current_user.tier)
    try:
        price, stale, fetched_at = await prices_service.get_price(
            provider, redis, ticker
        )
        return prices_service.to_price_payload(ticker, price, stale, fetched_at)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.get("/history/{ticker}", response_model=HistoryResponse)
async def get_history_route(
    ticker: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    interval: str = DEFAULT_INTERVAL,
    period: str = DEFAULT_PERIOD,
    since: Optional[int] = None,
):
    if interval not in YAHOO_MAX_RANGE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported interval"
        )
    provider = get_provider(current_user.tier)
    try:
        candles, stale, last_updated = await get_history(
            db, provider, ticker, interval, period, since=since
        )
        return {
            "ticker": ticker,
            "interval": interval,
            "candles": candles,
            "stale": stale,
            "last_updated": prices_service.iso_timestamp(last_updated),
        }
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.get("/quotes", response_model=QuotesResponse)
async def get_quotes(
    current_user: Annotated[User, Depends(get_current_user)],
    redis=Depends(get_redis),
    symbols: str = Query(..., description="Comma-separated ticker symbols"),
    fields: str | None = Query(
        None,
        description="Comma-separated field groups: session,volume,quote",
    ),
):
    normalized_symbols = quotes_service.normalize_symbols(symbols.split(","))
    if not normalized_symbols:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No valid symbols provided",
        )

    if len(normalized_symbols) > QUOTES_MAX_SYMBOLS_PER_REQUEST:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Too many symbols requested "
                f"(max {QUOTES_MAX_SYMBOLS_PER_REQUEST})"
            ),
        )

    groups: set[str]
    if fields is None or not fields.strip():
        groups = set(QUOTES_DEFAULT_GROUPS)
    else:
        groups = {
            value.strip().lower()
            for value in fields.split(",")
            if value.strip()
        }
        supported = {"session", "volume", "quote"}
        invalid = sorted(group for group in groups if group not in supported)
        if invalid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Unsupported fields: "
                    + ", ".join(invalid)
                    + ". Supported: session,volume,quote"
                ),
            )
        if not groups:
            groups = set(QUOTES_DEFAULT_GROUPS)

    provider = get_provider(current_user.tier)
    quotes, stale, fetched_at = await quotes_service.get_quotes(
        provider,
        redis,
        normalized_symbols,
        groups,
    )

    return {
        "symbols": normalized_symbols,
        "quotes": quotes,
        "stale": stale,
        "last_updated": prices_service.iso_timestamp(fetched_at),
    }


@router.get("/symbols", response_model=SymbolsResponse)
async def get_symbols(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    items, stale, fetched_at = await symbols_service.get_symbol_items(db)
    return {
        "items": items,
        "stale": stale,
        "last_updated": prices_service.iso_timestamp(fetched_at),
    }


@router.get("/lookup", response_model=LookupResponse)
async def get_lookup(
    q: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    provider = get_provider(current_user.tier)
    try:
        query, items, stale, fetched_at = await lookup_service.search_lookup(
            db,
            provider,
            q,
        )
        return {
            "query": query,
            "items": items,
            "stale": stale,
            "last_updated": prices_service.iso_timestamp(fetched_at),
        }
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))

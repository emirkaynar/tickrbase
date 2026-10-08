from __future__ import annotations

from typing import Annotated, Optional, Literal
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import (
    DEFAULT_INTERVAL,
    DEFAULT_PERIOD,
    QUOTES_DEFAULT_GROUPS,
    QUOTES_MAX_SYMBOLS_PER_REQUEST,
    INTERVAL_SECONDS,
)
from ..core.database import get_db
from ..core.history_cache import get_history
from ..core.models_db import User
from ..providers import get_provider
from ..schemas.models import (
    HistoryResponse,
    MarketContextResponse,
    LookupResponse,
    OverviewResponse,
    PriceResponse,
    QuotesResponse,
    SymbolsResponse,
)
from ..services.market_context import build_market_context
from ..services import logos as logos_service
from ..services import lookup as lookup_service
from ..services import overview as overview_service
from ..services import prices as prices_service
from ..services import quotes as quotes_service
from ..services import symbols as symbols_service
from .deps import get_current_user, get_redis

router = APIRouter(tags=["Market Data"])


@router.get("/health")
async def health_check():
    return {"status": "ok", "service": "tickrbase-backend-v2"}


@router.get("/logo/{ticker}")
async def get_ticker_logo(ticker: str):
    image_bytes = await logos_service.get_logo(ticker)
    if image_bytes is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Logo not found",
        )
    return Response(
        content=image_bytes,
        media_type="image/webp",
        headers={
            "Cache-Control": "public, max-age=604800",
            "Access-Control-Allow-Origin": "*",
        },
    )


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
    sessions: Literal["regular", "extended"] = "regular",
):
    if interval not in INTERVAL_SECONDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported interval"
        )
    provider = get_provider(current_user.tier)
    try:
        candles, stale, last_updated = await get_history(
            db, provider, ticker, interval, period, since=since, sessions=sessions
        )
        return {
            "ticker": ticker,
            "interval": interval,
            "source": provider.source_id,
            "sessions": sessions,
            "coverage": provider.history_capabilities(sessions),
            "snapshot_time": last_updated * 1000,
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
        "quotes": [{**quote, "source": provider.source_id} for quote in quotes],
        "stale": stale,
        "last_updated": prices_service.iso_timestamp(fetched_at),
    }


@router.get("/symbols", response_model=SymbolsResponse)
async def get_symbols(
    current_user: Annotated[User, Depends(get_current_user)],
    redis=Depends(get_redis),
):
    items, stale, fetched_at = await symbols_service.get_symbol_items(redis)
    return {
        "items": items,
        "stale": stale,
        "last_updated": prices_service.iso_timestamp(fetched_at),
    }



@router.get("/lookup", response_model=LookupResponse)
async def get_lookup(
    q: str,
    current_user: Annotated[User, Depends(get_current_user)],
    redis=Depends(get_redis),
):
    provider = get_provider(current_user.tier)
    try:
        query, items, stale, fetched_at = await lookup_service.search_lookup(
            redis,
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



@router.get("/overview/{ticker}", response_model=OverviewResponse)
async def get_overview_route(
    ticker: str,
    current_user: Annotated[User, Depends(get_current_user)],
    redis=Depends(get_redis),
):
    provider = get_provider(current_user.tier)
    try:
        payload, stale, fetched_at = await overview_service.get_overview(
            provider, redis, ticker
        )
        return payload
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.get("/market-context/{ticker}", response_model=MarketContextResponse)
async def get_market_context(
    ticker: str,
    current_user: Annotated[User, Depends(get_current_user)],
    start: int = Query(..., ge=0),
    end: int = Query(..., ge=0),
    redis=Depends(get_redis),
):
    if end <= start or end - start > 366 * 86400:
        raise HTTPException(status_code=400, detail="Date range must be positive and at most 366 days")
    import asyncio
    import json
    provider = get_provider(current_user.tier)
    normalized = provider.normalize_symbol(ticker)
    key = f"market-metadata:{provider.source_id}:{normalized}"
    cached = await redis.get(key)
    metadata = json.loads(cached) if cached else await provider.get_market_metadata_async(normalized)
    if not cached and metadata.get("exchange"):
        await redis.set(key, json.dumps(metadata), ex=86400)
    return await asyncio.to_thread(build_market_context, normalized, metadata, start, end)

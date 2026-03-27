from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException

from ..core.cache import TTLCache
from ..core.config import DEFAULT_INTERVAL, DEFAULT_PERIOD, YAHOO_MAX_RANGE
from ..core.history_cache import get_history
from ..core.models import (
    AlertCreate,
    AlertRecord,
    HistoryResponse,
    PortfolioCreate,
    PortfolioPosition,
    PriceResponse,
    LookupResponse,
    SymbolsResponse,
    WatchlistUpdate,
)
from ..core.provider import DataProvider
from ..services import alerts as alerts_service
from ..services import portfolio as portfolio_service
from ..services import prices as prices_service
from ..services import lookup as lookup_service
from ..services import symbols as symbols_service
from ..services import watchlist as watchlist_service


def build_router(provider: DataProvider, price_cache: TTLCache[float]) -> APIRouter:
    router = APIRouter()

    @router.get("/price/{ticker}", response_model=PriceResponse)
    def get_price(ticker: str):
        try:
            price, stale, fetched_at = prices_service.get_price(
                provider, price_cache, ticker
            )
            return prices_service.to_price_payload(ticker, price, stale, fetched_at)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc))

    @router.get("/history/{ticker}", response_model=HistoryResponse)
    def get_history_route(
        ticker: str,
        interval: str = DEFAULT_INTERVAL,
        period: str = DEFAULT_PERIOD,
        since: Optional[int] = None,
    ):
        if interval not in YAHOO_MAX_RANGE:
            raise HTTPException(status_code=400, detail="Unsupported interval")
        try:
            candles, stale, last_updated = get_history(
                provider, ticker, interval, period, since=since
            )
            return {
                "ticker": ticker,
                "interval": interval,
                "candles": candles,
                "stale": stale,
                "last_updated": prices_service.iso_timestamp(last_updated),
            }
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc))

    @router.get("/portfolio", response_model=list[PortfolioPosition])
    def get_portfolio():
        return portfolio_service.list_positions(provider, price_cache)

    @router.post("/portfolio")
    def upsert_portfolio(payload: PortfolioCreate):
        portfolio_service.upsert_position(
            payload.ticker, payload.quantity, payload.avg_price
        )
        return {"ok": True}

    @router.delete("/portfolio/{ticker}")
    def delete_portfolio(ticker: str):
        portfolio_service.delete_position(ticker)
        return {"ok": True}

    @router.get("/alerts", response_model=list[AlertRecord])
    def list_alerts():
        return alerts_service.list_alerts()

    @router.post("/alerts")
    def create_alert(payload: AlertCreate):
        alerts_service.create_alert(
            payload.ticker, payload.condition, payload.threshold
        )
        return {"ok": True}

    @router.delete("/alerts/{alert_id}")
    def delete_alert(alert_id: int):
        alerts_service.delete_alert(alert_id)
        return {"ok": True}

    @router.get("/symbols", response_model=SymbolsResponse)
    def get_symbols():
        items, stale, fetched_at = symbols_service.get_symbol_items()
        return {
            "items": items,
            "stale": stale,
            "last_updated": prices_service.iso_timestamp(fetched_at),
        }

    @router.get("/lookup", response_model=LookupResponse)
    def get_lookup(q: str):
        try:
            query, items, stale, fetched_at = lookup_service.search_lookup(
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
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc))

    @router.get("/watchlist")
    def list_watchlist():
        return watchlist_service.list_watchlist()

    @router.post("/watchlist")
    def update_watchlist(payload: WatchlistUpdate):
        watchlist_service.upsert_watchlist(
            [item.model_dump() for item in payload.items]
        )
        return {"ok": True}

    return router

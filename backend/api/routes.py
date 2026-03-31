from __future__ import annotations

import asyncio
import time
from collections import deque
from typing import Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from ..core.cache import TTLCache
from ..core.config import (
    CORS_ORIGINS,
    DEFAULT_INTERVAL,
    DEFAULT_PERIOD,
    WS_COMMAND_RATE_LIMIT_PER_SEC,
    WS_MAX_CLIENTS,
    YAHOO_MAX_RANGE,
)
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
from ..services.streaming import LivePriceStreamHub
from ..services import portfolio as portfolio_service
from ..services import prices as prices_service
from ..services import lookup as lookup_service
from ..services import symbols as symbols_service
from ..services import watchlist as watchlist_service


def build_router(
    provider: DataProvider,
    price_cache: TTLCache[float],
    stream_hub: LivePriceStreamHub,
) -> APIRouter:
    router = APIRouter()

    @router.websocket("/ws/prices")
    async def ws_prices(websocket: WebSocket):
        origin = websocket.headers.get("origin")
        if origin and origin not in CORS_ORIGINS:
            await websocket.close(code=1008)
            return

        if stream_hub.active_client_count >= WS_MAX_CLIENTS:
            await websocket.close(code=1013)
            return

        await websocket.accept()
        client_id = await stream_hub.register_client(websocket)

        await stream_hub.send_control(
            client_id,
            {
                "type": "hello",
                "protocolVersion": stream_hub.protocol_version,
                "ts": int(time.time() * 1000),
            },
        )

        cmd_times: deque[float] = deque()

        try:
            while True:
                message = await websocket.receive_json()
                if not isinstance(message, dict):
                    await stream_hub.send_control(
                        client_id,
                        {
                            "type": "error",
                            "code": "invalid_message",
                            "message": "Expected JSON object",
                        },
                    )
                    continue

                request_id = message.get("requestId")
                if not isinstance(request_id, str) or not request_id.strip():
                    await stream_hub.send_control(
                        client_id,
                        {
                            "type": "nack",
                            "code": "request_id_required",
                            "message": "requestId must be a non-empty string",
                        },
                    )
                    continue

                now = time.monotonic()
                cmd_times.append(now)
                while cmd_times and now - cmd_times[0] > 1.0:
                    cmd_times.popleft()

                if len(cmd_times) > WS_COMMAND_RATE_LIMIT_PER_SEC:
                    await stream_hub.send_control(
                        client_id,
                        {
                            "type": "nack",
                            "requestId": request_id,
                            "code": "rate_limited",
                            "message": "Too many commands per second",
                        },
                    )
                    continue

                cmd_type = str(message.get("type") or "").lower()
                if cmd_type == "ping":
                    await stream_hub.send_control(
                        client_id,
                        {
                            "type": "pong",
                            "requestId": request_id,
                            "ts": int(time.time() * 1000),
                        },
                    )
                    continue

                if cmd_type != "replace":
                    await stream_hub.send_control(
                        client_id,
                        {
                            "type": "nack",
                            "requestId": request_id,
                            "code": "unknown_command",
                            "message": "Supported commands: replace, ping",
                        },
                    )
                    continue

                symbols = message.get("symbols")
                if not isinstance(symbols, list):
                    await stream_hub.send_control(
                        client_id,
                        {
                            "type": "nack",
                            "requestId": request_id,
                            "code": "invalid_symbols",
                            "message": "symbols must be an array",
                        },
                    )
                    continue

                debug = bool(message.get("debug", False))
                ok, reason, applied = await stream_hub.replace_symbols(
                    client_id,
                    [str(s) for s in symbols],
                    debug=debug,
                )
                if not ok:
                    await stream_hub.send_control(
                        client_id,
                        {
                            "type": "nack",
                            "requestId": request_id,
                            "code": reason,
                            "message": "replace rejected",
                        },
                    )
                    continue

                await stream_hub.send_control(
                    client_id,
                    {
                        "type": "ack",
                        "requestId": request_id,
                        "op": "replace",
                        "applied": sorted(applied),
                        "globalSymbols": stream_hub.active_symbol_count,
                        "dropped": stream_hub.drop_count,
                    },
                )
        except WebSocketDisconnect:
            pass
        except asyncio.CancelledError:
            raise
        finally:
            await stream_hub.unregister_client(client_id)

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

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

import json

from ..core.config import (
    PRICE_TTL_SECONDS,
    WS_CLIENT_QUEUE_SIZE,
    WS_MAX_CLIENTS,
    WS_MAX_GLOBAL_SYMBOLS,
    WS_MAX_SYMBOLS_PER_CLIENT,
    WS_PROTOCOL_VERSION,
    WS_RECONNECT_BACKOFF_MAX_SECONDS,
    WS_RECONNECT_BACKOFF_MIN_SECONDS,
)
from ..core.redis import get_redis_client
from ..providers.yahoo import normalize_ticker


logger = logging.getLogger(__name__)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _coerce_float(val: Any) -> float | None:
    if val is None:
        return None
    try:
        f = float(val)
        return f if f == f else None
    except (ValueError, TypeError):
        return None


def _extract_tick(data: dict[str, Any]) -> tuple[str, float, int] | None:
    if not isinstance(data, dict):
        return None

    symbol = str(data.get("id") or data.get("symbol") or "").strip().upper()
    if not symbol:
        return None

    price = (
        _coerce_float(data.get("price"))
        or _coerce_float(data.get("lastPrice"))
        or _coerce_float(data.get("regularMarketPrice"))
        or _coerce_float(data.get("last_price"))
    )

    if price is None:
        return None

    raw_ts = data.get("time") or data.get("timestamp") or data.get("ts")
    ts: int | None = None
    if raw_ts is not None:
        try:
            val = int(raw_ts)
            ts = val * 1000 if val < 1_000_000_000_000 else val
        except (ValueError, TypeError):
            pass

    if ts is None:
        ts = _now_ms()

    return symbol, price, ts


class LivePriceStreamHub:
    def __init__(self) -> None:
        self._clients: dict[str, WebSocket] = {}
        self._queues: dict[str, asyncio.Queue[dict[str, Any]]] = {}
        self._client_symbols: dict[str, set[str]] = {}
        self._symbol_ref_counts: dict[str, int] = defaultdict(int)

        self._stream_task: asyncio.Task[None] | None = None
        self._writer_tasks: dict[str, asyncio.Task[None]] = {}
        self._stop_event = asyncio.Event()

        self._drop_count = 0
        self.protocol_version = WS_PROTOCOL_VERSION

    @property
    def active_client_count(self) -> int:
        return len(self._clients)

    @property
    def active_symbol_count(self) -> int:
        return len(self._symbol_ref_counts)

    @property
    def drop_count(self) -> int:
        return self._drop_count

    async def start(self) -> None:
        if self._stream_task is not None:
            return
        self._stop_event.clear()
        self._stream_task = asyncio.create_task(
            self._stream_loop(), name="yf-stream-hub"
        )

    async def stop(self) -> None:
        self._stop_event.set()
        if self._stream_task:
            self._stream_task.cancel()
            try:
                await self._stream_task
            except asyncio.CancelledError:
                pass
            self._stream_task = None

        writer_tasks = list(self._writer_tasks.values())
        for task in writer_tasks:
            task.cancel()
        if writer_tasks:
            await asyncio.gather(*writer_tasks, return_exceptions=True)
        self._writer_tasks.clear()

    async def register_client(self, websocket: WebSocket) -> str:
        client_id = str(uuid.uuid4())
        self._clients[client_id] = websocket
        self._queues[client_id] = asyncio.Queue(maxsize=WS_CLIENT_QUEUE_SIZE)
        self._client_symbols[client_id] = set()

        self._writer_tasks[client_id] = asyncio.create_task(
            self._client_writer_loop(client_id, websocket),
            name=f"ws-writer-{client_id[:8]}",
        )
        return client_id

    async def unregister_client(self, client_id: str) -> None:
        websocket = self._clients.pop(client_id, None)
        self._queues.pop(client_id, None)
        old_symbols = self._client_symbols.pop(client_id, set())

        for sym in old_symbols:
            self._symbol_ref_counts[sym] -= 1
            if self._symbol_ref_counts[sym] <= 0:
                self._symbol_ref_counts.pop(sym, None)

        task = self._writer_tasks.pop(client_id, None)
        if task:
            task.cancel()

        if websocket:
            try:
                await websocket.close()
            except Exception:
                pass

    async def replace_symbols(
        self,
        client_id: str,
        symbols: list[str],
        debug: bool = False,
    ) -> tuple[bool, str, set[str]]:
        if client_id not in self._clients:
            return False, "client_not_found", set()

        normalized: set[str] = set()
        for sym in symbols:
            norm = normalize_ticker(sym)
            if norm:
                normalized.add(norm)

        if len(normalized) > WS_MAX_SYMBOLS_PER_CLIENT:
            return False, f"max_symbols_per_client_exceeded_{WS_MAX_SYMBOLS_PER_CLIENT}", set()

        old_symbols = self._client_symbols.get(client_id, set())
        added = normalized - old_symbols
        removed = old_symbols - normalized

        current_global_count = len(self._symbol_ref_counts)
        new_symbols_needed = sum(
            1 for s in added if self._symbol_ref_counts[s] == 0
        )
        if current_global_count + new_symbols_needed > WS_MAX_GLOBAL_SYMBOLS:
            return False, f"max_global_symbols_exceeded_{WS_MAX_GLOBAL_SYMBOLS}", set()

        for s in removed:
            self._symbol_ref_counts[s] -= 1
            if self._symbol_ref_counts[s] <= 0:
                self._symbol_ref_counts.pop(s, None)

        for s in added:
            self._symbol_ref_counts[s] += 1

        self._client_symbols[client_id] = normalized
        return True, "ok", normalized

    async def send_control(self, client_id: str, payload: dict[str, Any]) -> None:
        queue = self._queues.get(client_id)
        if queue:
            try:
                queue.put_nowait(payload)
            except asyncio.QueueFull:
                self._drop_count += 1

    async def broadcast_shutdown(self, reason: str = "Server shutting down") -> None:
        payload = {"type": "shutdown", "reason": reason, "ts": _now_ms()}
        for client_id in list(self._clients.keys()):
            await self.send_control(client_id, payload)

    async def _broadcast_tick(
        self, symbol: str, price: float, ts: int, raw: dict[str, Any] | None = None
    ) -> None:
        payload: dict[str, Any] = {
            "type": "tick",
            "symbol": symbol,
            "price": price,
            "ts": ts,
        }
        if raw is not None:
            payload["raw"] = raw

        # Update Redis L1 price cache & publish to Redis Pub/Sub
        try:
            redis = get_redis_client()
            ts_sec = int(ts / 1000) if ts > 1_000_000_000_000 else int(ts)
            cache_key = f"price:{symbol}"
            price_payload = json.dumps({"price": price, "fetched_at": ts_sec})
            await redis.set(cache_key, price_payload, ex=PRICE_TTL_SECONDS * 2)
            await redis.publish("market_ticks", json.dumps({"symbol": symbol, "price": price, "ts": ts}))
        except Exception as exc:
            logger.debug(f"Redis tick update failed: {exc}")

        for client_id, symbols in list(self._client_symbols.items()):
            if symbol in symbols:
                queue = self._queues.get(client_id)
                if queue:
                    try:
                        queue.put_nowait(payload)
                    except asyncio.QueueFull:
                        self._drop_count += 1


    async def _client_writer_loop(
        self, client_id: str, websocket: WebSocket
    ) -> None:
        queue = self._queues.get(client_id)
        if not queue:
            return

        try:
            while True:
                msg = await queue.get()
                await websocket.send_json(msg)
                queue.task_done()
        except (asyncio.CancelledError, Exception):
            pass

    async def _stream_loop(self) -> None:
        from yfinance import AsyncWebSocket

        backoff = WS_RECONNECT_BACKOFF_MIN_SECONDS

        while not self._stop_event.is_set():
            active_symbols = list(self._symbol_ref_counts.keys())
            if not active_symbols:
                await asyncio.sleep(1.0)
                continue

            tick_queue: asyncio.Queue[tuple[str, float, int, dict[str, Any] | None]] = asyncio.Queue()

            def on_message(msg: Any, *args: Any) -> None:
                data = msg if isinstance(msg, dict) else (args[0] if args and isinstance(args[0], dict) else None)
                if isinstance(data, dict):
                    extracted = _extract_tick(data)
                    if extracted:
                        sym, price, ts = extracted
                        tick_queue.put_nowait((sym, price, ts, data))

            ws = AsyncWebSocket(verbose=False)
            listen_task: asyncio.Task[None] | None = None
            try:
                await ws.subscribe(active_symbols)
                listen_task = asyncio.create_task(ws.listen(on_message))
                backoff = WS_RECONNECT_BACKOFF_MIN_SECONDS

                while not self._stop_event.is_set():
                    current_symbols = set(self._symbol_ref_counts.keys())
                    if set(active_symbols) != current_symbols:
                        break

                    try:
                        sym, price, ts, raw = await asyncio.wait_for(
                            tick_queue.get(), timeout=1.0
                        )
                        await self._broadcast_tick(sym, price, ts, raw)
                        tick_queue.task_done()
                    except asyncio.TimeoutError:
                        pass
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.warning(f"Live stream error: {exc}. Reconnecting in {backoff}s...")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, WS_RECONNECT_BACKOFF_MAX_SECONDS)
            finally:
                if listen_task:
                    listen_task.cancel()
                    try:
                        await listen_task
                    except asyncio.CancelledError:
                        pass
                try:
                    await ws.close()
                except Exception:
                    pass

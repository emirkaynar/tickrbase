from __future__ import annotations

import asyncio
import logging
import re
import time
from collections import defaultdict
from dataclasses import dataclass, field

from fastapi import WebSocket

from ..core.config import (
    WS_CLIENT_QUEUE_SIZE,
    WS_MAX_GLOBAL_SYMBOLS,
    WS_MAX_SYMBOLS_PER_CLIENT,
    WS_PROTOCOL_VERSION,
    WS_RECONNECT_BACKOFF_MAX_SECONDS,
    WS_RECONNECT_BACKOFF_MIN_SECONDS,
)

LOG = logging.getLogger(__name__)
_SYMBOL_RE = re.compile(r"^[A-Z0-9.\-^=:/_]{1,32}$")


def normalize_symbol(value: str) -> str:
    return value.strip().upper()


def validate_symbol(value: str) -> bool:
    return bool(_SYMBOL_RE.fullmatch(value))


def now_ms() -> int:
    return int(time.time() * 1000)


@dataclass
class ClientState:
    websocket: WebSocket
    queue: asyncio.Queue[dict] = field(
        default_factory=lambda: asyncio.Queue(maxsize=WS_CLIENT_QUEUE_SIZE)
    )
    symbols: set[str] = field(default_factory=set)
    debug: bool = False
    sender_task: asyncio.Task | None = None


class LivePriceStreamHub:
    def __init__(self) -> None:
        self._clients: dict[int, ClientState] = {}
        self._symbol_refs: dict[str, int] = defaultdict(int)
        self._ws = None
        self._listen_task: asyncio.Task | None = None
        self._running = False
        self._next_client_id = 1
        self._lock = asyncio.Lock()
        self._drop_count = 0

    @property
    def protocol_version(self) -> str:
        return WS_PROTOCOL_VERSION

    @property
    def drop_count(self) -> int:
        return self._drop_count

    @property
    def active_symbol_count(self) -> int:
        return len(self._symbol_refs)

    @property
    def active_client_count(self) -> int:
        return len(self._clients)

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._listen_task = asyncio.create_task(self._run_forever())

    async def stop(self) -> None:
        self._running = False
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass

        if self._listen_task:
            self._listen_task.cancel()
            try:
                await self._listen_task
            except asyncio.CancelledError:
                pass

        for client_id in list(self._clients.keys()):
            await self.unregister_client(client_id)

    async def register_client(self, websocket: WebSocket) -> int:
        async with self._lock:
            client_id = self._next_client_id
            self._next_client_id += 1
            state = ClientState(websocket=websocket)
            state.sender_task = asyncio.create_task(
                self._sender_loop(client_id, state)
            )
            self._clients[client_id] = state
            LOG.info("ws client connected id=%s active=%s", client_id, len(self._clients))
            return client_id

    async def unregister_client(self, client_id: int) -> None:
        async with self._lock:
            state = self._clients.pop(client_id, None)
            if not state:
                return

            symbols_to_drop = list(state.symbols)
            for symbol in symbols_to_drop:
                await self._decrease_ref_locked(symbol)

            if state.sender_task:
                state.sender_task.cancel()
            LOG.info("ws client disconnected id=%s active=%s", client_id, len(self._clients))

    async def send_control(self, client_id: int, payload: dict) -> None:
        state = self._clients.get(client_id)
        if not state:
            return
        self._enqueue(state, payload)

    async def broadcast_shutdown(self, message: str) -> None:
        payload = {
            "type": "shutdown",
            "message": message,
            "ts": now_ms(),
        }
        for state in list(self._clients.values()):
            self._enqueue(state, payload)

    async def replace_symbols(
        self,
        client_id: int,
        symbols: list[str],
        *,
        debug: bool,
    ) -> tuple[bool, str, set[str]]:
        normalized: set[str] = set()
        for raw_symbol in symbols:
            symbol = normalize_symbol(str(raw_symbol))
            if not symbol:
                continue
            if not validate_symbol(symbol):
                return False, f"invalid_symbol:{symbol}", set()
            normalized.add(symbol)

        if len(normalized) > WS_MAX_SYMBOLS_PER_CLIENT:
            return False, "too_many_symbols_per_client", set()

        async with self._lock:
            state = self._clients.get(client_id)
            if not state:
                return False, "client_not_found", set()

            current = set(state.symbols)
            to_add = normalized - current
            to_remove = current - normalized

            projected_global = len(self._symbol_refs)
            for symbol in to_add:
                if self._symbol_refs.get(symbol, 0) == 0:
                    projected_global += 1

            if projected_global > WS_MAX_GLOBAL_SYMBOLS:
                return False, "too_many_global_symbols", set()

            for symbol in to_add:
                await self._increase_ref_locked(symbol)
            for symbol in to_remove:
                await self._decrease_ref_locked(symbol)

            state.symbols = normalized
            state.debug = bool(debug)
            LOG.info(
                "ws replace id=%s symbols=%s global=%s",
                client_id,
                len(state.symbols),
                len(self._symbol_refs),
            )
            return True, "ok", set(state.symbols)

    async def _increase_ref_locked(self, symbol: str) -> None:
        prev = self._symbol_refs.get(symbol, 0)
        self._symbol_refs[symbol] = prev + 1
        if prev == 0:
            await self._subscribe_upstream([symbol])

    async def _decrease_ref_locked(self, symbol: str) -> None:
        prev = self._symbol_refs.get(symbol, 0)
        if prev <= 1:
            self._symbol_refs.pop(symbol, None)
            await self._unsubscribe_upstream([symbol])
            return
        self._symbol_refs[symbol] = prev - 1

    async def _subscribe_upstream(self, symbols: list[str]) -> None:
        if not symbols:
            return
        ws = self._ws
        if ws is None:
            return
        try:
            await ws.subscribe(symbols)
            LOG.info("upstream subscribe symbols=%s", len(symbols))
        except Exception as exc:
            LOG.warning("upstream subscribe failed: %s", exc)

    async def _unsubscribe_upstream(self, symbols: list[str]) -> None:
        if not symbols:
            return
        ws = self._ws
        if ws is None:
            return
        try:
            await ws.unsubscribe(symbols)
            LOG.info("upstream unsubscribe symbols=%s", len(symbols))
        except Exception as exc:
            LOG.warning("upstream unsubscribe failed: %s", exc)

    async def _run_forever(self) -> None:
        import yfinance as yf

        backoff = WS_RECONNECT_BACKOFF_MIN_SECONDS
        while self._running:
            try:
                async with yf.AsyncWebSocket(verbose=False) as ws:
                    self._ws = ws
                    symbols = list(self._symbol_refs.keys())
                    if symbols:
                        await ws.subscribe(symbols)
                    LOG.info("upstream connected symbols=%s", len(symbols))
                    backoff = WS_RECONNECT_BACKOFF_MIN_SECONDS
                    await ws.listen(message_handler=self._on_upstream_message)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                LOG.warning("upstream reconnect in %.1fs cause=%s", backoff, exc)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, WS_RECONNECT_BACKOFF_MAX_SECONDS)
            finally:
                self._ws = None

    def _on_upstream_message(self, message: dict) -> None:
        payload = self._normalize_tick(message)
        if payload is None:
            return

        symbol = payload["symbol"]
        for state in list(self._clients.values()):
            if symbol not in state.symbols:
                continue
            if state.debug:
                self._enqueue(state, {**payload, "raw": message})
            else:
                self._enqueue(state, payload)

    def _normalize_tick(self, message: dict) -> dict | None:
        if not isinstance(message, dict):
            return None

        symbol_raw = message.get("id") or message.get("symbol")
        if not symbol_raw:
            return None
        symbol = normalize_symbol(str(symbol_raw))

        price = message.get("price")
        if price is None:
            price = message.get("last_price")
        if price is None:
            price = message.get("regularMarketPrice")
        if price is None:
            return None

        try:
            price_value = float(price)
        except (TypeError, ValueError):
            return None

        ts_raw = message.get("time")
        if ts_raw is None:
            ts_raw = message.get("timestamp")

        if ts_raw is None:
            ts = now_ms()
        else:
            try:
                ts_num = float(ts_raw)
            except (TypeError, ValueError):
                ts = now_ms()
            else:
                ts = int(ts_num * 1000 if ts_num < 10_000_000_000 else ts_num)

        return {
            "type": "tick",
            "symbol": symbol,
            "price": price_value,
            "ts": ts,
        }

    async def _sender_loop(self, _client_id: int, state: ClientState) -> None:
        try:
            while True:
                payload = await state.queue.get()
                await state.websocket.send_json(payload)
        except asyncio.CancelledError:
            pass
        except Exception:
            pass

    def _enqueue(self, state: ClientState, payload: dict) -> None:
        try:
            state.queue.put_nowait(payload)
        except asyncio.QueueFull:
            try:
                state.queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
            try:
                state.queue.put_nowait(payload)
            except asyncio.QueueFull:
                self._drop_count += 1
                return
            self._drop_count += 1
from __future__ import annotations

import asyncio
import json
import time
from collections import deque

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..core.config import CORS_ORIGINS, WS_COMMAND_RATE_LIMIT_PER_SEC, WS_MAX_SYMBOLS_PER_CLIENT
from ..core.database import AsyncSessionLocal
from ..services.sessions import resolve_session
from ..services.streaming import LivePriceStreamHub
from ..services.market_validation import valid_symbol

router = APIRouter(tags=['WebSocket'])
WS_MAX_FRAME_BYTES = 16_384
WS_IDLE_SECONDS = 90
WS_SESSION_CHECK_SECONDS = 5


def get_ws_stream_hub() -> LivePriceStreamHub:
    from ..main import stream_hub
    return stream_hub


async def _principal(token):
    async with asyncio.timeout(2):
        async with AsyncSessionLocal() as db:
            return await resolve_session(db, token)


@router.websocket('/ws/prices')
async def ws_prices(websocket: WebSocket):
    origin = websocket.headers.get('origin')
    if origin not in CORS_ORIGINS or websocket.query_params.get('token'):
        await websocket.close(code=1008)
        return
    token = websocket.cookies.get('access_token')
    try:
        user = await _principal(token)
    except Exception:
        await websocket.close(code=1013)
        return
    if user is None:
        await websocket.close(code=1008, reason='Unauthorized')
        return
    hub = get_ws_stream_hub()
    await websocket.accept()
    try:
        client_id = await hub.register_client(websocket, principal=str(user.id))
    except ValueError:
        await websocket.close(code=1013, reason='Connection quota exceeded')
        return
    await hub.send_control(client_id, {'type': 'hello', 'protocolVersion': hub.protocol_version, 'ts': int(time.time() * 1000)})
    frames = deque()
    last_frame = time.monotonic()
    last_check = last_frame
    try:
        while True:
            now = time.monotonic()
            if now - last_check >= WS_SESSION_CHECK_SECONDS:
                if await _principal(token) is None:
                    await websocket.close(code=1008, reason='Session expired')
                    break
                last_check = now
            if now - last_frame > WS_IDLE_SECONDS:
                await websocket.close(code=1001, reason='Idle timeout')
                break
            try:
                frame = await asyncio.wait_for(websocket.receive(), WS_SESSION_CHECK_SECONDS)
            except asyncio.TimeoutError:
                continue
            if frame['type'] == 'websocket.disconnect':
                break
            now = time.monotonic()
            last_frame = now
            frames.append(now)
            while frames and now - frames[0] > 1:
                frames.popleft()
            if len(frames) > WS_COMMAND_RATE_LIMIT_PER_SEC:
                await websocket.close(code=1008, reason='Rate limit exceeded')
                break
            raw = frame.get('text')
            if raw is None or len(raw.encode('utf-8')) > WS_MAX_FRAME_BYTES:
                await websocket.close(code=1009, reason='Invalid frame size or type')
                break
            try:
                message = json.loads(raw)
            except (ValueError, RecursionError):
                await websocket.close(code=1008, reason='Invalid JSON')
                break
            if not isinstance(message, dict):
                await websocket.close(code=1008, reason='Expected object')
                break
            request_id = message.get('requestId')
            if not isinstance(request_id, str) or not 0 < len(request_id) <= 128:
                await hub.send_control(client_id, {'type': 'nack', 'code': 'request_id_required'})
                continue
            command = message.get('type')
            if command == 'ping':
                await hub.send_control(client_id, {'type': 'pong', 'requestId': request_id, 'ts': int(time.time() * 1000)})
                continue
            symbols = message.get('symbols')
            if command != 'replace' or not isinstance(symbols, list) or len(symbols) > WS_MAX_SYMBOLS_PER_CLIENT or not all(valid_symbol(s) for s in symbols):
                await hub.send_control(client_id, {'type': 'nack', 'requestId': request_id, 'code': 'invalid_command'})
                continue
            ok, reason, applied = await hub.replace_symbols(client_id, symbols)
            await hub.send_control(client_id, {'type': 'ack' if ok else 'nack', 'requestId': request_id, 'op': 'replace', 'code': reason, 'applied': sorted(applied), 'globalSymbols': hub.active_symbol_count, 'dropped': hub.drop_count})
    except (WebSocketDisconnect, RuntimeError):
        pass
    except asyncio.CancelledError:
        raise
    except Exception:
        await websocket.close(code=1013, reason='Session validation unavailable')
    finally:
        await hub.unregister_client(client_id)

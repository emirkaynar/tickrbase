from __future__ import annotations

import asyncio
from collections import deque
import time
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..core.config import CORS_ORIGINS, WS_COMMAND_RATE_LIMIT_PER_SEC, WS_MAX_CLIENTS
from ..services.auth import decode_access_token
from ..services.streaming import LivePriceStreamHub

router = APIRouter(tags=["WebSocket"])


def get_ws_stream_hub() -> LivePriceStreamHub:
    from ..main import stream_hub
    return stream_hub


@router.websocket("/ws/prices")
async def ws_prices(websocket: WebSocket):
    origin = websocket.headers.get("origin")
    if origin and origin not in CORS_ORIGINS:
        await websocket.close(code=1008)
        return

    # Check authentication token from cookie or query param
    token = websocket.cookies.get("access_token")
    if not token:
        # Fallback to query parameter ?token=...
        token = websocket.query_params.get("token")

    if not token or decode_access_token(token) is None:
        await websocket.close(code=1008, reason="Unauthorized")
        return

    stream_hub = get_ws_stream_hub()

    if stream_hub.active_client_count >= WS_MAX_CLIENTS:
        await websocket.close(code=1013, reason="Server busy")
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

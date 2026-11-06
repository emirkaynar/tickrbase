"""Browser trust boundary; Origin is required for cookie-authenticated writes.

Exact trusted Origin checking also protects login/logout from CSRF. Non-browser
bearer clients may omit Origin, but cannot combine that bypass with cookies.
"""
import asyncio
from starlette.requests import Request
from .config import CORS_ORIGINS, DEV_MODE
from .errors import error_response

MAX_STATE_BODY_BYTES = 1_048_576
STATE_BODY_TIMEOUT_SECONDS = 10


class BrowserSecurityMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))
        origin = headers.get(b"origin", b"").decode("latin-1")
        request = Request(scope)
        cookies = request.cookies
        path = scope.get("path", "")
        unsafe = scope["method"] not in ("GET", "HEAD", "OPTIONS")
        bearer_client = headers.get(b"authorization", b"").startswith(b"Bearer ")
        needs_origin = "access_token" in cookies or (path.startswith("/auth/") and not bearer_client)

        async def protected_send(message):
            if message["type"] == "http.response.start":
                extra = [(b"x-content-type-options", b"nosniff"),
                         (b"x-frame-options", b"DENY"),
                         (b"referrer-policy", b"no-referrer"),
                         (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'")]
                if path.startswith(("/auth/", "/user/")) or "access_token" in cookies or b"authorization" in headers:
                    extra.append((b"cache-control", b"no-store"))
                if not DEV_MODE:
                    extra.append((b"strict-transport-security", b"max-age=31536000"))
                replaced = {key for key, _ in extra}
                message["headers"] = [(k, v) for k, v in message.get("headers", []) if k.lower() not in replaced] + extra
            await send(message)

        if unsafe and ((origin and origin not in CORS_ORIGINS) or (needs_origin and not origin)):
            return await error_response(request, 403, "FORBIDDEN", "Trusted Origin required")(scope, receive, protected_send)
        # Bound parsing before FastAPI/Pydantic reads JSON, including chunked
        # bodies. Do this only for active user-state/auth routes.
        if path.startswith(("/auth/", "/user/")):
            buffered = bytearray()
            total = 0
            deadline = asyncio.get_running_loop().time() + STATE_BODY_TIMEOUT_SECONDS
            while True:
                remaining = deadline - asyncio.get_running_loop().time()
                try:
                    message = await asyncio.wait_for(receive(), timeout=max(0, remaining))
                except TimeoutError:
                    return await error_response(request, 408, "REQUEST_TIMEOUT", "Request body timed out")(scope, receive, protected_send)
                if message["type"] == "http.disconnect":
                    return
                body = message.get("body", b"")
                total += len(body)
                if total > MAX_STATE_BODY_BYTES:
                    return await error_response(request, 413, "PAYLOAD_TOO_LARGE", "Request body too large")(scope, receive, protected_send)
                buffered.extend(body)
                if not message.get("more_body", False):
                    break
            delivered = False
            async def bounded_receive():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {"type": "http.request", "body": bytes(buffered), "more_body": False}
                return await receive()
            return await self.app(scope, bounded_receive, protected_send)
        await self.app(scope, receive, protected_send)

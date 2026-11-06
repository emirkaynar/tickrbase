"""Fail-closed, atomic Redis limits shared across API workers."""
import asyncio
import hashlib
import hmac
from fastapi import HTTPException, Request
from ..core.config import JWT_SECRET
from ..core.redis import get_redis_client

# Increment+expiry is atomic; failures never fall back to a process-local limiter.
LIMIT_SCRIPT = """
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n
"""


async def enforce_auth_limits(request: Request, email: str) -> None:
    peer = request.client.host if request.client else "unknown"
    # Forwarded headers are untrusted unless deployment supplies a trusted proxy.
    keys = [("ip", peer, 30), ("identity", email, 10)]
    client = get_redis_client()
    for kind, value, limit in keys:
        digest = hmac.new(JWT_SECRET.encode(), value.encode(), hashlib.sha256).hexdigest()
        try:
            count = await asyncio.wait_for(client.eval(LIMIT_SCRIPT, 1, f"auth-limit:{kind}:{digest}", 60), timeout=1)
        except Exception:
            raise HTTPException(503, "Authentication temporarily unavailable", headers={"Retry-After": "60"}) from None
        if int(count) > limit:
            raise HTTPException(429, "Too many authentication attempts", headers={"Retry-After": "60"})

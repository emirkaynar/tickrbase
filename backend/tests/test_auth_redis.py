"""Opt-in distributed-limit evidence against real Redis."""
import asyncio
import os
from uuid import uuid4
import pytest
from fastapi import HTTPException, Request
from backend.core.config import REDIS_URL
from backend.services import auth_limits
import redis.asyncio as redis


@pytest.mark.skipif(os.getenv("RUN_DATABASE_TESTS") != "1", reason="Requires local Redis")
def test_concurrent_auth_attempts_share_atomic_ip_budget(monkeypatch):
    async def run():
        client = redis.from_url(REDIS_URL, decode_responses=True)
        monkeypatch.setattr(auth_limits, "get_redis_client", lambda: client)
        peer = uuid4().hex
        request = Request({"type": "http", "client": (peer, 1234), "headers": []})

        async def attempt(index):
            try:
                await auth_limits.enforce_auth_limits(request, f"{peer}-{index}@example.com")
                return 200
            except HTTPException as error:
                return error.status_code
        try:
            outcomes = await asyncio.gather(*(attempt(i) for i in range(40)))
            assert outcomes.count(200) == 30
            assert outcomes.count(429) == 10
        finally:
            await client.aclose()
    asyncio.run(run())

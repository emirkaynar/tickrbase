import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from backend.core.config import CORS_ORIGINS
from backend.core.models_db import User
from backend.core.session_models import AuthSession
from backend.services.sessions import issue_session, resolve_session, revoke_session


class LocalDatabase:
    """Exercise real SQL predicates and FK deletion without an external server."""
    def __init__(self):
        engine = create_engine("sqlite://")
        event.listen(engine, "connect", lambda conn, _: conn.execute("PRAGMA foreign_keys=ON"))
        User.__table__.create(engine)
        AuthSession.__table__.create(engine)
        self.session = Session(engine, expire_on_commit=False)

    def add(self, item): self.session.add(item)
    async def execute(self, query): return self.session.execute(query)
    async def flush(self): self.session.flush()
    async def commit(self): self.session.commit()
    async def rollback(self): self.session.rollback()
    async def refresh(self, item): self.session.refresh(item)


def test_opaque_session_rotation_revocation_expiry_and_deleted_user():
    async def run():
        db = LocalDatabase()
        user = User(public_id=uuid4(), email="session@example.com", hashed_password="unused")
        db.add(user)
        await db.flush()
        first = await issue_session(db, user)
        assert len(first) == 43 and "." not in first
        assert (await resolve_session(db, first)).id == user.id
        stored = db.session.query(AuthSession).one()
        assert stored.token_digest != first and first not in repr(stored.__dict__)
        second = await issue_session(db, user, first)
        assert await resolve_session(db, first) is None
        assert await resolve_session(db, second) is user
        await revoke_session(db, second)
        assert await resolve_session(db, second) is None
        third = await issue_session(db, user)
        db.session.query(AuthSession).update({AuthSession.expires_at: datetime.now(timezone.utc) - timedelta(seconds=1)})
        assert await resolve_session(db, third) is None
        fourth = await issue_session(db, user)
        # Core delete models a real database cascade without touching portfolio relationships.
        db.session.execute(User.__table__.delete().where(User.id == user.id))
        assert await resolve_session(db, fourth) is None
        assert db.session.query(AuthSession).count() == 0
    asyncio.run(run())


@pytest.mark.parametrize("token", [None, "", "legacy.jwt.token", "x" * 100000, "é" * 43], ids=["none", "empty", "jwt", "oversize", "unicode"])
def test_malformed_credentials_never_reach_database(token):
    assert asyncio.run(resolve_session(None, token)) is None


def test_browser_writes_require_trusted_origin_and_private_responses():
    from backend.core.browser_security import BrowserSecurityMiddleware
    app = FastAPI()
    app.add_middleware(BrowserSecurityMiddleware)

    @app.post("/auth/login")
    @app.post("/user/layout")
    @app.get("/auth/me")
    async def endpoint(): return {"ok": True}

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://test") as client:
            assert (await client.post("/auth/login")).status_code == 403
            assert (await client.post("/auth/login", headers={"origin": "https://hostile.example"})).status_code == 403
            good = await client.post("/auth/login", headers={"origin": CORS_ORIGINS[0]})
            assert good.status_code == 200
            client.cookies.set("access_token", "opaque")
            assert (await client.post("/user/layout")).status_code == 403
            response = await client.get("/auth/me")
            assert response.headers["cache-control"] == "no-store"
            assert response.headers["x-content-type-options"] == "nosniff"
    asyncio.run(run())


def test_auth_http_lifecycle_and_password_bounds(monkeypatch):
    from unittest.mock import AsyncMock
    from backend.api.auth import router
    from backend.core.browser_security import BrowserSecurityMiddleware
    from backend.core.database import get_db
    monkeypatch.setattr("backend.api.auth.enforce_auth_limits", AsyncMock())
    db = LocalDatabase()
    app = FastAPI()
    app.add_middleware(BrowserSecurityMiddleware)
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: db

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://test", headers={"Origin": CORS_ORIGINS[0]}) as client:
            credentials = {"email": "real@example.com", "password": "a-long-test-password"}
            assert (await client.post("/auth/register", json={**credentials, "password": "short"})).status_code == 422
            assert (await client.post("/auth/register", json=credentials)).status_code == 201
            first = client.cookies["access_token"]
            assert (await client.get("/auth/me")).status_code == 200
            assert (await client.post("/auth/login", json=credentials)).status_code == 200
            second = client.cookies["access_token"]
            assert second != first
            assert (await client.get("/auth/me", headers={"Cookie": f"access_token={first}"})).status_code == 401
            assert (await client.post("/auth/logout")).status_code == 200
            assert (await client.get("/auth/me", headers={"Cookie": f"access_token={second}"})).status_code == 401
            assert (await client.post("/auth/login", json={**credentials, "password": "x" * 129})).status_code == 422
            assert (await client.post("/auth/login", json={**credentials, "password": "wrong"})).status_code == 401
    asyncio.run(run())


def test_auth_limits_throttle_and_fail_closed(monkeypatch):
    from unittest.mock import AsyncMock
    from fastapi import HTTPException, Request
    from backend.services.auth_limits import enforce_auth_limits
    request = Request({"type": "http", "client": ("127.0.0.1", 1234), "headers": []})

    async def run():
        cache = AsyncMock()
        cache.eval.side_effect = [1, 11]
        monkeypatch.setattr("backend.services.auth_limits.get_redis_client", lambda: cache)
        with pytest.raises(HTTPException) as error:
            await enforce_auth_limits(request, "email@example.com")
        assert error.value.status_code == 429
        assert error.value.headers["Retry-After"] == "60"
        assert "email@example.com" not in str(cache.eval.call_args_list)
        cache.eval.side_effect = ConnectionError("secret upstream error")
        with pytest.raises(HTTPException) as error:
            await enforce_auth_limits(request, "email@example.com")
        assert error.value.status_code == 503
        assert "secret" not in error.value.detail
    asyncio.run(run())


def test_hash_verification_rejects_unbounded_costs():
    from backend.services.auth import verify_password
    assert not verify_password("password", "$argon2id$v=19$m=999999,t=2,p=1$c2FsdA$aGFzaA")
    assert not verify_password("password", "$2b$31$unused")
    assert not verify_password("password", "invalid")


def test_session_issuance_caps_stored_credentials():
    async def run():
        db = LocalDatabase()
        user = User(public_id=uuid4(), email="cap@example.com", hashed_password="unused")
        db.add(user)
        await db.flush()
        tokens = [await issue_session(db, user) for _ in range(25)]
        assert db.session.query(AuthSession).count() == 20
        assert await resolve_session(db, tokens[0]) is None
        assert await resolve_session(db, tokens[-1]) is user
    asyncio.run(run())


def test_chunked_oversize_body_rejected_before_json_parsing():
    from backend.core.browser_security import BrowserSecurityMiddleware, MAX_STATE_BODY_BYTES
    called = False
    async def endpoint(scope, receive, send):
        nonlocal called
        called = True
    async def run():
        events = iter([
            {"type": "http.request", "body": b"x" * MAX_STATE_BODY_BYTES, "more_body": True},
            {"type": "http.request", "body": b"x", "more_body": False},
        ])
        sent = []
        async def receive(): return next(events)
        async def send(message): sent.append(message)
        scope = {"type": "http", "method": "POST", "path": "/auth/login", "headers": [(b"origin", CORS_ORIGINS[0].encode())]}
        await BrowserSecurityMiddleware(endpoint)(scope, receive, send)
        assert sent[0]["status"] == 413
        assert not called
    asyncio.run(run())


def test_cancelled_password_request_does_not_release_running_worker(monkeypatch):
    import threading
    from backend.services import auth
    async def run():
        slots = asyncio.Semaphore(1)
        monkeypatch.setattr(auth, "_hash_slots", slots)
        started = threading.Event()
        finish = threading.Event()
        def slow():
            started.set()
            finish.wait(timeout=3)
        task = asyncio.create_task(auth.password_work(slow))
        while not started.is_set():
            await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError): await task
        assert slots.locked()
        finish.set()
        for _ in range(100):
            if not slots.locked(): break
            await asyncio.sleep(0.01)
        assert not slots.locked()
    asyncio.run(run())


def test_slow_request_body_has_total_deadline(monkeypatch):
    from backend.core import browser_security
    monkeypatch.setattr(browser_security, "STATE_BODY_TIMEOUT_SECONDS", 0.01)
    async def run():
        sent = []
        async def receive():
            await asyncio.sleep(1)
            return {"type": "http.request", "body": b"{}", "more_body": False}
        async def send(message): sent.append(message)
        async def endpoint(scope, receive, send):
            raise AssertionError("Body timeout must reject before the app runs")
        scope = {"type": "http", "method": "POST", "path": "/auth/login", "headers": [(b"origin", CORS_ORIGINS[0].encode())]}
        await browser_security.BrowserSecurityMiddleware(endpoint)(scope, receive, send)
        assert sent[0]["status"] == 408
    asyncio.run(run())

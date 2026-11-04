import asyncio
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4
from unittest.mock import AsyncMock, Mock

import httpx
import jwt
import pytest
from fastapi import FastAPI, HTTPException

from backend.api.auth import router
from backend.api.deps import get_current_user
from backend.core.config import JWT_ALGORITHM, JWT_SECRET
from backend.core.models_db import User
from backend.schemas.models import UserMeResponse
from secrets import token_urlsafe


PUBLIC_ID = uuid4()


def test_auth_response_serializes_public_uuid():
    response = UserMeResponse(
        id=PUBLIC_ID, email="person@example.com", tier="free",
        created_at=datetime.now(timezone.utc),
    )
    assert response.model_dump(mode="json")["id"] == str(PUBLIC_ID)


def test_legacy_jwt_is_rejected_without_database_lookup():
    now = datetime.now(timezone.utc)
    token = jwt.encode({"sub": str(PUBLIC_ID), "exp": now + timedelta(minutes=1)}, JWT_SECRET, algorithm=JWT_ALGORITHM)
    db = AsyncMock()
    with pytest.raises(HTTPException):
        asyncio.run(get_current_user(db, access_token=token))
    db.execute.assert_not_called()


def test_auth_dependency_resolves_public_id_to_internal_user():
    user = User(id=17, public_id=PUBLIC_ID, email="person@example.com", hashed_password="unused")
    result = Mock()
    result.scalar_one_or_none.return_value = user
    db = AsyncMock()
    db.execute.return_value = result
    resolved = asyncio.run(get_current_user(db, access_token=token_urlsafe(32)))
    assert resolved is user
    assert resolved.id == 17
    query = db.execute.call_args.args[0]
    assert "auth_sessions.token_digest" in str(query)


def test_missing_public_identity_is_unauthorized():
    result = Mock()
    result.scalar_one_or_none.return_value = None
    db = AsyncMock()
    db.execute.return_value = result
    with pytest.raises(HTTPException) as error:
        asyncio.run(get_current_user(db, access_token=token_urlsafe(32)))
    assert error.value.status_code == 401


def test_me_never_returns_internal_database_id():
    app = FastAPI()
    app.include_router(router)
    user = User(id=17, public_id=PUBLIC_ID, email="person@example.com", hashed_password="unused", tier="free", created_at=datetime.now(timezone.utc))
    app.dependency_overrides[get_current_user] = lambda: user

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://test") as client:
            response = await client.get("/auth/me")
            assert response.status_code == 200
            assert response.json()["id"] == str(PUBLIC_ID)
            assert "public_id" not in response.json()
    asyncio.run(run())

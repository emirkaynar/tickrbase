from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from ..core.config import ACCESS_TOKEN_EXPIRE_MINUTES
from ..core.models_db import User
from ..core.session_models import AuthSession

SESSION_TTL_SECONDS = ACCESS_TOKEN_EXPIRE_MINUTES * 60
MAX_USER_SESSIONS = 20
TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_-]{43}\Z")


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


async def revoke_session(db: AsyncSession, token: str | None) -> None:
    if token and TOKEN_PATTERN.fullmatch(token):
        await db.execute(delete(AuthSession).where(AuthSession.token_digest == token_digest(token)))


async def issue_session(db: AsyncSession, user: User, previous_token: str | None = None) -> str:
    # Serialize issuance for one user, including concurrent logins on workers.
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())
    # Login rotates this browser's credential; expired records for the user are removed.
    await revoke_session(db, previous_token)
    now = datetime.now(timezone.utc)
    await db.execute(delete(AuthSession).where(AuthSession.user_id == user.id, AuthSession.expires_at <= now))
    surplus = select(AuthSession.token_digest).where(AuthSession.user_id == user.id).order_by(
        AuthSession.expires_at.desc(), AuthSession.token_digest
    ).offset(MAX_USER_SESSIONS - 1)
    await db.execute(delete(AuthSession).where(AuthSession.token_digest.in_(surplus)))
    token = secrets.token_urlsafe(32)
    db.add(AuthSession(token_digest=token_digest(token), user_id=user.id,
                       expires_at=now + timedelta(seconds=SESSION_TTL_SECONDS)))
    await db.flush()
    return token


async def resolve_session(db: AsyncSession, token: str | None) -> User | None:
    if not token or not TOKEN_PATTERN.fullmatch(token):
        return None
    result = await db.execute(
        select(User).join(AuthSession, AuthSession.user_id == User.id).where(
            AuthSession.token_digest == token_digest(token),
            AuthSession.expires_at > datetime.now(timezone.utc),
        )
    )
    return result.scalar_one_or_none()

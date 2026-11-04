from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID
import jwt
from passlib.context import CryptContext

from ..core.config import ACCESS_TOKEN_EXPIRE_MINUTES, JWT_ALGORITHM, JWT_SECRET

pwd_context = CryptContext(schemes=["argon2", "bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(public_user_id: UUID) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(public_user_id),
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> UUID | None:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        subject = payload.get("sub")
        if not isinstance(subject, str):
            return None
        return UUID(subject)
    except (jwt.PyJWTError, ValueError):
        return None

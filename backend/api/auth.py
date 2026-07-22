from __future__ import annotations

from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import COOKIE_SECURE, COOKIE_SAMESITE
from ..core.database import get_db
from ..core.models_db import User
from ..schemas.models import MessageResponse, UserCreate, UserLogin, UserMeResponse
from ..services.auth import create_access_token, hash_password, verify_password
from ..api.deps import get_current_user

router = APIRouter(prefix="/auth", tags=["Auth"])


def set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE, # type: ignore
        max_age=86400 * 30, # 30 days
        path="/",
    )


@router.post("/register", response_model=UserMeResponse, status_code=status.HTTP_201_CREATED)
async def register(
    payload: UserCreate,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    email_clean = payload.email.strip().lower()
    existing = await db.execute(select(User).where(User.email == email_clean))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User with this email already exists",
        )

    user = User(
        email=email_clean,
        hashed_password=hash_password(payload.password),
        tier="free",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token(user.id)
    set_auth_cookie(response, token)

    return UserMeResponse(
        id=user.id,
        email=user.email,
        tier=user.tier,
        created_at=user.created_at,
    )


@router.post("/login", response_model=UserMeResponse)
async def login(
    payload: UserLogin,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    email_clean = payload.email.strip().lower()
    result = await db.execute(select(User).where(User.email == email_clean))
    user = result.scalar_one_or_none()

    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    token = create_access_token(user.id)
    set_auth_cookie(response, token)

    return UserMeResponse(
        id=user.id,
        email=user.email,
        tier=user.tier,
        created_at=user.created_at,
    )


@router.post("/logout", response_model=MessageResponse)
async def logout(response: Response):
    response.delete_cookie(key="access_token", path="/")
    return MessageResponse(ok=True, message="Successfully logged out")


@router.get("/me", response_model=UserMeResponse)
async def get_me(current_user: Annotated[User, Depends(get_current_user)]):
    return UserMeResponse(
        id=current_user.id,
        email=current_user.email,
        tier=current_user.tier,
        created_at=current_user.created_at,
    )

from __future__ import annotations

from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import COOKIE_SECURE, COOKIE_SAMESITE
from ..core.database import get_db
from ..core.models_db import User
from ..schemas.models import MessageResponse, UserCreate, UserLogin, UserMeResponse
from ..services.auth import DUMMY_HASH, hash_password, password_work, verify_password
from ..services.auth_limits import enforce_auth_limits
from ..services.sessions import SESSION_TTL_SECONDS, issue_session, revoke_session
from ..api.deps import get_current_user

router = APIRouter(prefix="/auth", tags=["Auth"])


def set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE, # type: ignore
        max_age=SESSION_TTL_SECONDS,
        path="/",
    )


@router.post("/register", response_model=UserMeResponse, status_code=status.HTTP_201_CREATED)
async def register(
    payload: UserCreate,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    email_clean = payload.email.strip().lower()
    await enforce_auth_limits(request, email_clean)
    existing = await db.execute(select(User).where(User.email == email_clean))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User with this email already exists",
        )

    user = User(
        email=email_clean,
        hashed_password=await password_work(hash_password, payload.password),
        tier="free",
    )
    db.add(user)
    try:
        await db.flush()
        token = await issue_session(db, user, request.cookies.get("access_token"))
        await db.commit()
        await db.refresh(user)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(400, "User with this email already exists") from None
    set_auth_cookie(response, token)

    return UserMeResponse(
        id=user.public_id,
        email=user.email,
        tier=user.tier,
        created_at=user.created_at,
    )


@router.post("/login", response_model=UserMeResponse)
async def login(
    payload: UserLogin,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    email_clean = payload.email.strip().lower()
    await enforce_auth_limits(request, email_clean)
    result = await db.execute(select(User).where(User.email == email_clean))
    user = result.scalar_one_or_none()

    verified = await password_work(verify_password, payload.password, user.hashed_password if user else DUMMY_HASH)
    if user is None or not verified:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    token = await issue_session(db, user, request.cookies.get("access_token"))
    await db.commit()
    set_auth_cookie(response, token)

    return UserMeResponse(
        id=user.public_id,
        email=user.email,
        tier=user.tier,
        created_at=user.created_at,
    )


@router.post("/logout", response_model=MessageResponse)
async def logout(request: Request, response: Response, db: Annotated[AsyncSession, Depends(get_db)]):
    token = request.cookies.get("access_token")
    authorization = request.headers.get("authorization", "")
    if not token and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
    await revoke_session(db, token)
    await db.commit()
    response.delete_cookie(key="access_token", path="/", secure=COOKIE_SECURE, httponly=True, samesite=COOKIE_SAMESITE)
    return MessageResponse(ok=True, message="Successfully logged out")


@router.get("/me", response_model=UserMeResponse)
async def get_me(current_user: Annotated[User, Depends(get_current_user)]):
    return UserMeResponse(
        id=current_user.public_id,
        email=current_user.email,
        tier=current_user.tier,
        created_at=current_user.created_at,
    )

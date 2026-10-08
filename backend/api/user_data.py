from __future__ import annotations

from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.models_db import User
from ..schemas.models import (
    LayoutPayload,
    MessageResponse,
    SettingsPayload,
    TablePrefPayload,
    WatchlistSavePayload,
    WatchlistSchema,
    WidgetStatePayload,
)
from ..services import user_data as user_data_service
from .deps import get_current_user

router = APIRouter(prefix="/user", tags=["User Data"])


# --- LAYOUT ENDPOINTS ---

@router.get("/layout", response_model=LayoutPayload)
async def get_layout(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return await user_data_service.get_user_layout(db, current_user.id)


@router.put("/layout", response_model=MessageResponse)
async def save_layout(
    payload: LayoutPayload,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await user_data_service.save_user_layout(db, current_user.id, payload)
    return MessageResponse(ok=True)


# --- WIDGET STATE ENDPOINTS ---

@router.get("/widgets/{widget_id}/state", response_model=WidgetStatePayload)
async def get_widget_state(
    widget_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    state = await user_data_service.get_widget_state(db, current_user.id, widget_id)
    if not state:
        return WidgetStatePayload()
    return state


@router.put("/widgets/{widget_id}/state", response_model=MessageResponse)
async def save_widget_state(
    widget_id: str,
    payload: WidgetStatePayload,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await user_data_service.save_widget_state(db, current_user.id, widget_id, payload)
    return MessageResponse(ok=True)


# --- WATCHLIST ENDPOINTS ---

@router.get("/watchlists", response_model=list[WatchlistSchema])
async def list_watchlists(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return await user_data_service.list_watchlists(db, current_user.id)


@router.post("/watchlists/{list_id}", response_model=WatchlistSchema)
async def save_watchlist(
    list_id: str,
    payload: WatchlistSavePayload,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return await user_data_service.save_watchlist(db, current_user.id, list_id, payload)


@router.delete("/watchlists/{list_id}", response_model=MessageResponse)
async def delete_watchlist(
    list_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await user_data_service.delete_watchlist(db, current_user.id, list_id)
    return MessageResponse(ok=True)


# --- SETTINGS ENDPOINTS ---

@router.get("/settings", response_model=SettingsPayload)
async def get_settings(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    settings = await user_data_service.get_user_settings(db, current_user.id)
    return SettingsPayload(settings=settings)


@router.put("/settings", response_model=MessageResponse)
async def save_settings(
    payload: SettingsPayload,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if "general.timezone" in payload.settings:
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
        value = payload.settings["general.timezone"]
        try:
            if not isinstance(value, str):
                raise ValueError()
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise HTTPException(status_code=422, detail="Invalid IANA timezone")
    await user_data_service.save_user_settings(db, current_user.id, payload.settings)
    return MessageResponse(ok=True)


# --- TABLE PREFERENCES ENDPOINTS ---

@router.get("/table-prefs")
async def get_table_pref(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    scope_type: str = Query(...),
    scope_id: str = Query(...),
    table_id: str = Query(...),
):
    pref = await user_data_service.get_table_pref(
        db, current_user.id, scope_type, scope_id, table_id
    )
    return pref or {}


@router.put("/table-prefs", response_model=MessageResponse)
async def save_table_pref(
    payload: TablePrefPayload,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await user_data_service.save_table_pref(db, current_user.id, payload)
    return MessageResponse(ok=True)

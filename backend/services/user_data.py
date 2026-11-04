from __future__ import annotations

import json
import time
from uuid import uuid4
from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.models_db import (
    User,
    UserLayout,
    UserScreen,
    UserSetting,
    UserTablePref,
    UserWatchlist,
    UserWidget,
    UserWidgetState,
)
from ..schemas.models import (
    LayoutPayload,
    ScreenSchema,
    TablePrefPayload,
    WatchlistSavePayload,
    WatchlistSchema,
    WidgetSchema,
    WidgetStatePayload,
)


# --- LAYOUT SERVICES ---

async def get_user_layout(db: AsyncSession, user_id: int) -> LayoutPayload:
    await db.execute(select(User.id).where(User.id == user_id).with_for_update())
    revision = await db.get(UserLayout, user_id)
    if revision is None:
        revision = UserLayout(user_id=user_id, revision=0)
        db.add(revision)
        await db.flush()
    # Fetch screens ordered
    screens_res = await db.execute(
        select(UserScreen).where(UserScreen.user_id == user_id).order_by(UserScreen.order.asc())
    )
    screens_db = screens_res.scalars().all()

    # If no screens exist, return default screen layout
    if not screens_db:
        now = int(time.time() * 1000)
        default_screen_id = str(uuid4())
        default_screen = UserScreen(
            id=default_screen_id,
            user_id=user_id,
            name="Screen 1",
            order=0,
            created_at=now,
        )
        db.add(default_screen)

        # Save active screen setting
        stmt = insert(UserSetting).values(
            user_id=user_id,
            key="activeScreenId",
            value_json=json.dumps(default_screen_id),
            updated_at=now,
        ).on_conflict_do_update(
            index_elements=["user_id", "key"],
            set_={"value_json": json.dumps(default_screen_id), "updated_at": now},
        )
        await db.execute(stmt)
        await db.flush()

        return LayoutPayload(
            screens=[
                ScreenSchema(
                    id=default_screen_id,
                    name="Screen 1",
                    order=0,
                    createdAt=now,
                )
            ],
            activeScreenId=default_screen_id,
            widgets=[],
            revision=revision.revision,
        )

    # Fetch active screen setting
    active_res = await db.execute(
        select(UserSetting.value_json).where(
            UserSetting.user_id == user_id, UserSetting.key == "activeScreenId"
        )
    )
    active_json = active_res.scalar_one_or_none()
    active_screen_id = json.loads(active_json) if active_json else screens_db[0].id

    # Fetch widgets
    widgets_res = await db.execute(
        select(UserWidget).where(UserWidget.user_id == user_id).order_by(UserWidget.created_at.asc())
    )
    widgets_db = widgets_res.scalars().all()

    screens_schema = [
        ScreenSchema(id=s.id, name=s.name, order=s.order, createdAt=s.created_at)
        for s in screens_db
    ]

    widgets_schema = [
        WidgetSchema(
            id=w.id,
            screenId=w.screen_id,
            type=w.type,
            x=w.x,
            y=w.y,
            w=w.w,
            h=w.h,
            minW=w.min_w,
            minH=w.min_h,
            createdAt=w.created_at,
        )
        for w in widgets_db
    ]

    return LayoutPayload(
        screens=screens_schema,
        activeScreenId=active_screen_id,
        widgets=widgets_schema,
        revision=revision.revision,
    )


async def save_user_layout(db: AsyncSession, user_id: int, payload: LayoutPayload) -> int:
    now = int(time.time() * 1000)

    await db.execute(select(User.id).where(User.id == user_id).with_for_update())
    revision = await db.get(UserLayout, user_id, populate_existing=True)
    current = revision.revision if revision else 0
    if payload.revision != current:
        raise HTTPException(409, "Layout changed; reload before saving")
    for model, ids in ((UserScreen, [s.id for s in payload.screens]), (UserWidget, [w.id for w in payload.widgets])):
        if (await db.execute(select(model.id).where(model.id.in_(ids), model.user_id != user_id))).first():
            raise HTTPException(409, "Resource ID unavailable")
    active_id = payload.activeScreenId
    stmt_active = insert(UserSetting).values(user_id=user_id, key="activeScreenId", value_json=json.dumps(active_id), updated_at=now).on_conflict_do_update(index_elements=["user_id", "key"], set_={"value_json":json.dumps(active_id), "updated_at":now})
    await db.execute(stmt_active)
    screens = [(s.id, s) for s in payload.screens]
    screen_ids = [s.id for s in payload.screens]
    widgets = [(w.id, w.screenId, w) for w in payload.widgets]
    widget_ids = [w.id for w in payload.widgets]

    # Removed widget preferences have no remaining addressable owner scope.
    stale_prefs = delete(UserTablePref).where(
        UserTablePref.user_id == user_id, UserTablePref.scope_type == "widget",
    )
    if widget_ids:
        stale_prefs = stale_prefs.where(UserTablePref.scope_id.not_in(widget_ids))
    await db.execute(stale_prefs)

    # Delete existing screens & widgets not in payload
    if widget_ids:
        await db.execute(
            delete(UserWidget).where(
                UserWidget.user_id == user_id,
                UserWidget.id.not_in(widget_ids),
            )
        )
    else:
        await db.execute(delete(UserWidget).where(UserWidget.user_id == user_id))

    # Upsert screens
    for screen_id, s in screens:
        stmt_screen = insert(UserScreen).values(
            id=screen_id,
            user_id=user_id,
            name=s.name,
            order=s.order,
            created_at=s.createdAt,
        ).on_conflict_do_update(
            index_elements=["id"],
            set_={"name": s.name, "order": s.order},
            where=UserScreen.user_id == user_id,
        )
        result = await db.execute(stmt_screen.returning(UserScreen.id))
        if result.scalar_one_or_none() is None:
            raise HTTPException(409, "Resource ID unavailable")

    # Upsert widgets
    for widget_id, screen_id, w in widgets:
        stmt_widget = insert(UserWidget).values(
            id=widget_id,
            user_id=user_id,
            screen_id=screen_id,
            type=w.type,
            x=w.x,
            y=w.y,
            w=w.w,
            h=w.h,
            min_w=w.minW,
            min_h=w.minH,
            created_at=w.createdAt,
        ).on_conflict_do_update(
            index_elements=["id"],
            set_={
                "screen_id": screen_id,
                "type": w.type,
                "x": w.x,
                "y": w.y,
                "w": w.w,
                "h": w.h,
                "min_w": w.minW,
                "min_h": w.minH,
            },
            where=UserWidget.user_id == user_id,
        )
        result = await db.execute(stmt_widget.returning(UserWidget.id))
        if result.scalar_one_or_none() is None:
            raise HTTPException(409, "Resource ID unavailable")

    if screen_ids:
        await db.execute(
            delete(UserScreen).where(
                UserScreen.user_id == user_id,
                UserScreen.id.not_in(screen_ids),
            )
        )
    else:
        await db.execute(delete(UserScreen).where(UserScreen.user_id == user_id))

    if revision:
        revision.revision = current + 1
    else:
        db.add(UserLayout(user_id=user_id, revision=current + 1))
    await db.commit()
    return current + 1


# --- WIDGET STATE SERVICES ---

async def get_widget_state(db: AsyncSession, user_id: int, widget_id: str) -> WidgetStatePayload | None:
    await _owned_widget(db, user_id, widget_id)
    res = await db.execute(
        select(UserWidgetState).where(
            UserWidgetState.user_id == user_id,
            UserWidgetState.widget_id == widget_id
        )
    )
    ws = res.scalars().first()
    if not ws:
        return None

    state_dict = json.loads(ws.state_json) if ws.state_json else None
    return WidgetStatePayload(
        symbol=ws.symbol,
        interval=ws.interval,
        state=state_dict,
    )


async def save_widget_state(
    db: AsyncSession, user_id: int, widget_id: str, payload: WidgetStatePayload
) -> None:
    await _owned_widget(db, user_id, widget_id)

    state_json = json.dumps(payload.state) if payload.state is not None else None
    stmt = insert(UserWidgetState).values(
        widget_id=widget_id,
        user_id=user_id,
        symbol=payload.symbol,
        interval=payload.interval,
        state_json=state_json,
    ).on_conflict_do_update(
        index_elements=["widget_id"],
        set_={
            "symbol": payload.symbol,
            "interval": payload.interval,
            "state_json": state_json,
        },
    )
    await db.execute(stmt)
    await db.commit()


# --- WATCHLIST SERVICES ---
MAX_WATCHLISTS_PER_USER = 100
MAX_TABLE_PREFS_PER_USER = 500
MAX_SETTINGS_PER_USER = 100

async def list_watchlists(db: AsyncSession, user_id: int) -> list[WatchlistSchema]:
    await db.execute(select(User.id).where(User.id == user_id).with_for_update())
    res = await db.execute(
        select(UserWatchlist).where(UserWatchlist.user_id == user_id).order_by(UserWatchlist.order.asc())
    )
    rows = res.scalars().all()

    # Create default watchlist if none exists
    if not rows:
        now = int(time.time() * 1000)
        default_id = str(uuid4())
        default_wl = UserWatchlist(
            id=default_id,
            user_id=user_id,
            name="Watchlist",
            name_lower="watchlist",
            order=0,
            items_json=json.dumps([]),
            row_state_json=None,
            created_at=now,
            updated_at=now,
        )
        db.add(default_wl)
        await db.commit()
        rows = [default_wl]

    return [
        WatchlistSchema(
            id=w.id,
            name=w.name,
            order=w.order,
            items=json.loads(w.items_json),
            rowState=json.loads(w.row_state_json) if w.row_state_json else None,
            createdAt=w.created_at,
            updatedAt=w.updated_at,
        )
        for w in rows
    ]


async def save_watchlist(
    db: AsyncSession, user_id: int, list_id: str, payload: WatchlistSavePayload
) -> WatchlistSchema:
    await db.execute(select(User.id).where(User.id == user_id).with_for_update())
    existing_owner = (await db.execute(select(UserWatchlist.user_id).where(UserWatchlist.id == list_id))).scalar_one_or_none()
    if existing_owner is not None and existing_owner != user_id:
        raise HTTPException(409, "Resource ID unavailable")
    if existing_owner is None:
        count = (await db.execute(select(func.count()).select_from(UserWatchlist).where(UserWatchlist.user_id == user_id))).scalar_one()
        if count >= MAX_WATCHLISTS_PER_USER:
            raise HTTPException(409, "Watchlist limit reached")
    now = int(time.time() * 1000)
    items_json = json.dumps(payload.items)
    row_state_json = json.dumps(payload.rowState) if payload.rowState is not None else None
    scoped_id = list_id

    stmt = insert(UserWatchlist).values(
        id=scoped_id,
        user_id=user_id,
        name=payload.name,
        name_lower=payload.name.strip().lower(),
        order=payload.order,
        items_json=items_json,
        row_state_json=row_state_json,
        created_at=now,
        updated_at=now,
    ).on_conflict_do_update(
        index_elements=["id"],
        set_={
            "name": payload.name,
            "name_lower": payload.name.strip().lower(),
            "order": payload.order,
            "items_json": items_json,
            "row_state_json": row_state_json,
            "updated_at": now,
        },
        where=UserWatchlist.user_id == user_id,
    )
    result = await db.execute(stmt.returning(UserWatchlist.created_at))
    created_at = result.scalar_one_or_none()
    if created_at is None:
        raise HTTPException(409, "Resource ID unavailable")
    await db.commit()

    return WatchlistSchema(
        id=scoped_id,
        name=payload.name,
        order=payload.order,
        items=payload.items,
        rowState=payload.rowState,
        createdAt=created_at,
        updatedAt=now,
    )


async def delete_watchlist(db: AsyncSession, user_id: int, list_id: str) -> None:
    scoped_id = list_id
    await db.execute(
        delete(UserWatchlist).where(
            UserWatchlist.user_id == user_id,
            UserWatchlist.id == list_id
        )
    )
    await db.commit()


# --- SETTINGS SERVICES ---

async def get_user_settings(db: AsyncSession, user_id: int) -> dict[str, object]:
    res = await db.execute(select(UserSetting).where(UserSetting.user_id == user_id, UserSetting.key != "activeScreenId"))
    rows = res.scalars().all()
    result: dict[str, object] = {}
    for r in rows:
        result[r.key] = json.loads(r.value_json)
    return result


async def save_user_settings(db: AsyncSession, user_id: int, settings: dict[str, object]) -> None:
    from ..schemas.models import SettingsPayload
    SettingsPayload(settings=settings)
    await db.execute(select(User.id).where(User.id == user_id).with_for_update())
    existing_keys = set((await db.execute(select(UserSetting.key).where(UserSetting.user_id == user_id))).scalars())
    # Reserve the layout's internal key even before the first layout is loaded.
    if len(existing_keys | set(settings) | {"activeScreenId"}) > MAX_SETTINGS_PER_USER:
        raise HTTPException(409, "Settings limit reached")
    now = int(time.time() * 1000)
    for key, value in settings.items():
        stmt = insert(UserSetting).values(
            user_id=user_id,
            key=key,
            value_json=json.dumps(value),
            updated_at=now,
        ).on_conflict_do_update(
            index_elements=["user_id", "key"],
            set_={"value_json": json.dumps(value), "updated_at": now},
        )
        await db.execute(stmt)
    await db.commit()


# --- TABLE PREFERENCES SERVICES ---

async def get_table_pref(
    db: AsyncSession, user_id: int, scope_type: str, scope_id: str, table_id: str
) -> dict[str, object] | None:
    if scope_type == "widget":
        await _owned_widget(db, user_id, scope_id)
    res = await db.execute(
        select(UserTablePref.prefs_json).where(
            UserTablePref.user_id == user_id, UserTablePref.scope_type == scope_type,
            UserTablePref.scope_id == scope_id, UserTablePref.table_id == table_id
        )
    )
    raw_json = res.scalars().first()
    return json.loads(raw_json) if raw_json else None


async def save_table_pref(db: AsyncSession, user_id: int, payload: TablePrefPayload) -> None:
    now = int(time.time() * 1000)
    # Always acquire the owner before a widget to match layout mutation order.
    await db.execute(select(User.id).where(User.id == user_id).with_for_update())
    if payload.scopeType == "widget":
        await _owned_widget(db, user_id, payload.scopeId)
    existing = (await db.execute(select(UserTablePref.id).where(
        UserTablePref.user_id == user_id, UserTablePref.scope_type == payload.scopeType,
        UserTablePref.scope_id == payload.scopeId, UserTablePref.table_id == payload.tableId,
    ))).first()
    if existing is None:
        count = (await db.execute(select(func.count()).select_from(UserTablePref).where(UserTablePref.user_id == user_id))).scalar_one()
        if count >= MAX_TABLE_PREFS_PER_USER:
            raise HTTPException(409, "Table preference limit reached")
    pref_id = str(uuid4())
    stmt = insert(UserTablePref).values(
        id=pref_id,
        user_id=user_id,
        scope_type=payload.scopeType,
        scope_id=payload.scopeId,
        table_id=payload.tableId,
        prefs_json=json.dumps(payload.prefs),
        updated_at=now,
    ).on_conflict_do_update(
        constraint="uq_table_pref_scope",
        set_={"prefs_json": json.dumps(payload.prefs), "updated_at": now},
    )
    await db.execute(stmt)
    await db.commit()


async def _owned_widget(db, user_id, widget_id):
    widget = (await db.execute(select(UserWidget.id).where(UserWidget.user_id == user_id, UserWidget.id == widget_id).with_for_update())).first()
    if widget is None:
        raise HTTPException(404, "Widget not found")

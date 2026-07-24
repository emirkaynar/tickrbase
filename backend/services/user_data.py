from __future__ import annotations

import json
import time
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.models_db import (
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
    # Fetch screens ordered
    screens_res = await db.execute(
        select(UserScreen).where(UserScreen.user_id == user_id).order_by(UserScreen.order.asc())
    )
    screens_db = screens_res.scalars().all()

    # If no screens exist, return default screen layout
    if not screens_db:
        now = int(time.time() * 1000)
        default_screen_id = f"screen-{now}"
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
        await db.commit()

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
    )


async def save_user_layout(db: AsyncSession, user_id: int, payload: LayoutPayload) -> None:
    now = int(time.time() * 1000)

    # Sync active screen setting
    stmt_active = insert(UserSetting).values(
        user_id=user_id,
        key="activeScreenId",
        value_json=json.dumps(payload.activeScreenId),
        updated_at=now,
    ).on_conflict_do_update(
        index_elements=["user_id", "key"],
        set_={"value_json": json.dumps(payload.activeScreenId), "updated_at": now},
    )
    await db.execute(stmt_active)

    # Delete existing screens & widgets not in payload
    screen_ids = [s.id for s in payload.screens]
    widget_ids = [w.id for w in payload.widgets]

    await db.execute(
        delete(UserWidget).where(UserWidget.user_id == user_id, UserWidget.id.not_in(widget_ids))
    )
    await db.execute(
        delete(UserScreen).where(UserScreen.user_id == user_id, UserScreen.id.not_in(screen_ids))
    )

    # Upsert screens
    for s in payload.screens:
        stmt_screen = insert(UserScreen).values(
            id=s.id,
            user_id=user_id,
            name=s.name,
            order=s.order,
            created_at=s.createdAt,
        ).on_conflict_do_update(
            index_elements=["id"],
            set_={"name": s.name, "order": s.order},
        )
        await db.execute(stmt_screen)

    # Upsert widgets
    for w in payload.widgets:
        stmt_widget = insert(UserWidget).values(
            id=w.id,
            user_id=user_id,
            screen_id=w.screenId,
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
                "screen_id": w.screenId,
                "x": w.x,
                "y": w.y,
                "w": w.w,
                "h": w.h,
                "min_w": w.minW,
                "min_h": w.minH,
            },
        )
        await db.execute(stmt_widget)

    await db.commit()


# --- WIDGET STATE SERVICES ---

async def get_widget_state(db: AsyncSession, user_id: int, widget_id: str) -> WidgetStatePayload | None:
    res = await db.execute(
        select(UserWidgetState).where(
            UserWidgetState.user_id == user_id, UserWidgetState.widget_id == widget_id
        )
    )
    ws = res.scalar_one_or_none()
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
    existing_widget = await db.scalar(
        select(UserWidget).where(
            UserWidget.id == widget_id, UserWidget.user_id == user_id
        )
    )
    if not existing_widget:
        screen = await db.scalar(
            select(UserScreen).where(UserScreen.user_id == user_id).order_by(UserScreen.order)
        )
        if not screen:
            screen = UserScreen(
                id=f"screen-{user_id}-default",
                user_id=user_id,
                name="Default Screen",
                order=0,
                created_at=int(time.time() * 1000),
            )
            db.add(screen)
            await db.flush()

        parts = widget_id.rsplit("-", 1)
        widget_type = parts[0] if len(parts) > 1 else "unknown"

        db.add(
            UserWidget(
                id=widget_id,
                user_id=user_id,
                screen_id=screen.id,
                type=widget_type,
                x=0,
                y=0,
                w=6,
                h=6,
                min_w=1,
                min_h=1,
                created_at=int(time.time() * 1000),
            )
        )
        await db.flush()

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

async def list_watchlists(db: AsyncSession, user_id: int) -> list[WatchlistSchema]:
    res = await db.execute(
        select(UserWatchlist).where(UserWatchlist.user_id == user_id).order_by(UserWatchlist.order.asc())
    )
    rows = res.scalars().all()

    # Create default watchlist if none exists
    if not rows:
        now = int(time.time() * 1000)
        default_wl = UserWatchlist(
            id="list:default",
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
    now = int(time.time() * 1000)
    items_json = json.dumps(payload.items)
    row_state_json = json.dumps(payload.rowState) if payload.rowState is not None else None

    stmt = insert(UserWatchlist).values(
        id=list_id,
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
    )
    await db.execute(stmt)
    await db.commit()

    return WatchlistSchema(
        id=list_id,
        name=payload.name,
        order=payload.order,
        items=payload.items,
        rowState=payload.rowState,
        createdAt=now,
        updatedAt=now,
    )


async def delete_watchlist(db: AsyncSession, user_id: int, list_id: str) -> None:
    await db.execute(
        delete(UserWatchlist).where(UserWatchlist.user_id == user_id, UserWatchlist.id == list_id)
    )
    await db.commit()


# --- SETTINGS SERVICES ---

async def get_user_settings(db: AsyncSession, user_id: int) -> dict[str, object]:
    res = await db.execute(select(UserSetting).where(UserSetting.user_id == user_id))
    rows = res.scalars().all()
    result: dict[str, object] = {}
    for r in rows:
        result[r.key] = json.loads(r.value_json)
    return result


async def save_user_settings(db: AsyncSession, user_id: int, settings: dict[str, object]) -> None:
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
    pref_id = f"{scope_type}:{scope_id}:{table_id}"
    res = await db.execute(
        select(UserTablePref.prefs_json).where(
            UserTablePref.user_id == user_id, UserTablePref.id == pref_id
        )
    )
    raw_json = res.scalar_one_or_none()
    return json.loads(raw_json) if raw_json else None


async def save_table_pref(db: AsyncSession, user_id: int, payload: TablePrefPayload) -> None:
    now = int(time.time() * 1000)
    pref_id = f"{payload.scopeType}:{payload.scopeId}:{payload.tableId}"
    stmt = insert(UserTablePref).values(
        id=pref_id,
        user_id=user_id,
        scope_type=payload.scopeType,
        scope_id=payload.scopeId,
        table_id=payload.tableId,
        prefs_json=json.dumps(payload.prefs),
        updated_at=now,
    ).on_conflict_do_update(
        index_elements=["id"],
        set_={"prefs_json": json.dumps(payload.prefs), "updated_at": now},
    )
    await db.execute(stmt)
    await db.commit()

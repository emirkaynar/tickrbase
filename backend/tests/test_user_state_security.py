"""Non-portfolio input and ownership regression tests."""
import asyncio
import os
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core import models_db as models
from backend.schemas.models import LayoutPayload, TablePrefPayload, WatchlistSavePayload, WidgetStatePayload
from backend.services import user_data as service
from backend.tests.test_public_identity_database import isolated_database


def layout(screen=None, widget=None, revision=0):
    screen = screen or str(uuid4())
    widget = widget or str(uuid4())
    return dict(
        screens=[dict(id=screen, name="Screen 1", order=0, createdAt=1)],
        activeScreenId=screen,
        widgets=[dict(id=widget, screenId=screen, type="basic-chart", x=0, y=0,
                      w=6, h=6, minW=1, minH=1, createdAt=1)],
        revision=revision,
    )


@pytest.mark.parametrize("mutate", [
    lambda p: p["screens"].append(p["screens"][0]),
    lambda p: p.update(activeScreenId=str(uuid4())),
    lambda p: p["widgets"][0].update(screenId=str(uuid4())),
    lambda p: p["widgets"][0].update(w=0),
    lambda p: p["widgets"][0].update(x=23, w=6),
    lambda p: p["screens"][0].update(id="1:screen-default"),
])
def test_invalid_layout_rejected_before_io(mutate):
    payload = layout()
    mutate(payload)
    with pytest.raises(ValidationError):
        LayoutPayload.model_validate(payload)


def test_excessive_and_deep_user_state_rejected():
    with pytest.raises(ValidationError):
        WatchlistSavePayload(name="Watchlist", items=["AAPL"] * 501)
    deep = {"value": "leaf"}
    for _ in range(15):
        deep = {"nested": deep}
    with pytest.raises(ValidationError):
        WidgetStatePayload(state=deep)


@pytest.mark.skipif(os.getenv("RUN_DATABASE_TESTS") != "1", reason="Requires local PostgreSQL")
def test_two_user_state_isolation_atomic_layout_and_revisions():
    async def run():
        async with isolated_database() as engine:
            tables = [models.User, models.UserScreen, models.UserWidget,
                      models.UserWidgetState, models.UserWatchlist,
                      models.UserSetting, models.UserTablePref, models.UserLayout]
            async with engine.begin() as conn:
                for model in tables:
                    await conn.run_sync(model.__table__.create)
            async with AsyncSession(engine, expire_on_commit=False) as db:
                first = models.User(email="first@example.com", hashed_password="unused")
                second = models.User(email="second@example.com", hashed_password="unused")
                db.add_all([first, second])
                await db.commit()
                a, b = first.id, second.id
                saved = await service.get_user_layout(db, a)
                assert ":" not in saved.activeScreenId
                assert saved.revision == 0
                payload = LayoutPayload.model_validate(layout(screen=saved.activeScreenId))
                await service.save_user_layout(db, a, payload)
                widget = payload.widgets[0].id
                await service.save_widget_state(db, a, widget, WidgetStatePayload(symbol="AAPL"))
                with pytest.raises(HTTPException) as error:
                    await service.save_widget_state(db, b, widget, WidgetStatePayload(symbol="MSFT"))
                assert error.value.status_code == 404
                await db.rollback()
                assert (await service.get_widget_state(db, a, widget)).symbol == "AAPL"
                stolen = payload.model_copy(update={"revision": 0})
                with pytest.raises(HTTPException) as error:
                    await service.save_user_layout(db, b, stolen)
                assert error.value.status_code == 409
                await db.rollback()
                assert (await service.get_user_layout(db, a)).widgets[0].id == widget
                with pytest.raises(HTTPException) as error:
                    await service.save_user_layout(db, a, payload)
                assert error.value.status_code == 409
                await db.rollback()
                assert (await service.get_user_layout(db, a)).revision == 1
                list_id = str(uuid4())
                await service.save_watchlist(db, a, list_id, WatchlistSavePayload(name="Owned"))
                with pytest.raises(HTTPException) as error:
                    await service.save_watchlist(db, b, list_id, WatchlistSavePayload(name="Stolen"))
                assert error.value.status_code == 409
                await db.rollback()
                assert (await service.list_watchlists(db, a))[0].name == "Owned"
                pref = TablePrefPayload(scopeType="widget", scopeId=widget, tableId="table", prefs={"sort": "asc"})
                await service.save_table_pref(db, a, pref)
                assert await service.get_table_pref(db, a, "widget", widget, "table") == {"sort": "asc"}
                with pytest.raises(HTTPException):
                    await service.save_table_pref(db, b, pref)
                await db.rollback()
                await service.save_user_settings(db, a, {"general.timezone": "Europe/Istanbul"})
                assert "general.timezone" not in await service.get_user_settings(db, b)
                rows = (await db.execute(select(models.UserTablePref))).scalars().all()
                assert len(rows) == 1 and ":" not in rows[0].id
    asyncio.run(run())


@pytest.mark.skipif(os.getenv("RUN_DATABASE_TESTS") != "1", reason="Requires local PostgreSQL")
def test_concurrent_layout_saves_have_exactly_one_winner():
    async def run():
        async with isolated_database() as engine:
            async with engine.begin() as conn:
                for model in [models.User, models.UserScreen, models.UserWidget,
                              models.UserWidgetState, models.UserSetting, models.UserTablePref, models.UserLayout]:
                    await conn.run_sync(model.__table__.create)
            async with AsyncSession(engine, expire_on_commit=False) as db:
                user = models.User(email="race@example.com", hashed_password="unused")
                db.add(user)
                await db.commit()
                user_id = user.id
                initial = await service.get_user_layout(db, user_id)
                await db.commit()
            payload = LayoutPayload.model_validate(layout(screen=initial.activeScreenId))
            async def save():
                async with AsyncSession(engine) as db:
                    try:
                        return await service.save_user_layout(db, user_id, payload)
                    except HTTPException as exc:
                        await db.rollback()
                        return exc.status_code
            assert sorted(await asyncio.gather(save(), save())) == [1, 409]
            async with AsyncSession(engine) as db:
                saved = await service.get_user_layout(db, user_id)
                assert saved.revision == 1
                assert [w.id for w in saved.widgets] == [payload.widgets[0].id]
    asyncio.run(run())

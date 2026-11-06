import asyncio
import os
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import func, insert, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core import models_db as models
from backend.schemas.models import LayoutPayload, SettingsPayload, TablePrefPayload, WatchlistSavePayload, WidgetStatePayload
from backend.services import user_data as service
from backend.tests.test_public_identity_database import isolated_database
from backend.tests.test_user_state_security import layout

pytestmark = pytest.mark.skipif(os.getenv("RUN_DATABASE_TESTS") != "1", reason="Requires local PostgreSQL")


@pytest.mark.parametrize("kind,limit", [("watchlists", 100), ("preferences", 500)])
def test_concurrent_creates_obey_owner_budget_and_existing_entries_remain_editable(kind, limit):
    async def run():
        async with isolated_database() as engine:
            table = models.UserWatchlist if kind == "watchlists" else models.UserTablePref
            async with engine.begin() as conn:
                await conn.run_sync(models.User.__table__.create)
                await conn.run_sync(table.__table__.create)
            async with AsyncSession(engine, expire_on_commit=False) as db:
                user = models.User(email="budget@example.com", hashed_password="unused")
                db.add(user)
                await db.flush()
                user_id = user.id
                existing_id = str(uuid4())
                if kind == "watchlists":
                    rows = [dict(id=existing_id if i == 0 else str(uuid4()), user_id=user_id, name=f"List {i}", name_lower=f"list {i}", order=i,
                                 items_json="[]", created_at=1, updated_at=1) for i in range(limit-1)]
                else:
                    rows = [dict(id=str(uuid4()), user_id=user_id, scope_type="page", scope_id="test", table_id=f"table-{i}", prefs_json="{}", updated_at=1) for i in range(limit-1)]
                await db.execute(insert(table), rows)
                await db.commit()

            async def save(index):
                async with AsyncSession(engine) as db:
                    try:
                        if kind == "watchlists":
                            await service.save_watchlist(db, user_id, str(uuid4()), WatchlistSavePayload(name=f"New {index}"))
                        else:
                            await service.save_table_pref(db, user_id, TablePrefPayload(scopeType="page", scopeId="test", tableId=f"new-{index}", prefs={}))
                        return 200
                    except HTTPException as error:
                        await db.rollback()
                        return error.status_code
            assert sorted(await asyncio.gather(save(0), save(1))) == [200, 409]
            async with AsyncSession(engine) as db:
                assert (await db.execute(select(func.count()).select_from(table))).scalar_one() == limit
                if kind == "watchlists":
                    await service.save_watchlist(db, user_id, existing_id, WatchlistSavePayload(name="Edited"))
                    assert (await db.execute(select(table.name).where(table.id == existing_id))).scalar_one() == "Edited"
                else:
                    await service.save_table_pref(db, user_id, TablePrefPayload(scopeType="page", scopeId="test", tableId="table-0", prefs={"sort": "desc"}))
                    assert await service.get_table_pref(db, user_id, "page", "test", "table-0") == {"sort": "desc"}
                assert (await db.execute(select(func.count()).select_from(table))).scalar_one() == limit
    asyncio.run(run())


def test_database_rejects_foreign_owned_widget_and_state_even_without_service_checks():
    async def run():
        async with isolated_database() as engine:
            async with engine.begin() as conn:
                for model in [models.User, models.UserScreen, models.UserWidget, models.UserWidgetState]:
                    await conn.run_sync(model.__table__.create)
            async with AsyncSession(engine) as db:
                a = models.User(email="a@example.com", hashed_password="unused")
                b = models.User(email="b@example.com", hashed_password="unused")
                db.add_all([a, b])
                await db.flush()
                a_id, b_id = a.id, b.id
                screen, widget = str(uuid4()), str(uuid4())
                await db.execute(insert(models.UserScreen).values(id=screen, user_id=a_id, name="A", order=0, created_at=1))
                values = dict(id=widget, user_id=a_id, screen_id=screen, type="basic-chart", x=0, y=0, w=6, h=6, min_w=1, min_h=1, created_at=1)
                await db.execute(insert(models.UserWidget).values(**values))
                await db.commit()
                with pytest.raises(IntegrityError):
                    async with db.begin_nested():
                        await db.execute(insert(models.UserWidget).values(**{**values, "id": str(uuid4()), "user_id": b_id}))
                with pytest.raises(IntegrityError):
                    async with db.begin_nested():
                        await db.execute(insert(models.UserWidgetState).values(widget_id=widget, user_id=b_id))
    asyncio.run(run())


def test_concurrent_settings_creates_respect_persistent_limit():
    async def run():
        async with isolated_database() as engine:
            async with engine.begin() as conn:
                await conn.run_sync(models.User.__table__.create)
                await conn.run_sync(models.UserSetting.__table__.create)
            async with AsyncSession(engine, expire_on_commit=False) as db:
                user = models.User(email="settings@example.com", hashed_password="unused")
                db.add(user)
                await db.flush()
                user_id = user.id
                await db.execute(insert(models.UserSetting), [dict(user_id=user_id, key=f"portfolio.key{i}", value_json="{}", updated_at=1) for i in range(98)])
                await db.commit()

            async def save(index):
                async with AsyncSession(engine) as db:
                    try:
                        await service.save_user_settings(db, user_id, {f"portfolio.new{index}": {"legacy": "contract"}})
                        return 200
                    except HTTPException as error:
                        await db.rollback()
                        return error.status_code
            assert sorted(await asyncio.gather(save(0), save(1))) == [200, 409]
            async with AsyncSession(engine) as db:
                await service.save_user_settings(db, user_id, {"portfolio.key0": {"legacy": "still allowed"}})
                assert (await db.execute(select(func.count()).select_from(models.UserSetting))).scalar_one() == 99
                assert (await service.get_user_settings(db, user_id))["portfolio.key0"] == {"legacy": "still allowed"}
                # One of 100 slots is reserved for the layout's activeScreenId.
    asyncio.run(run())


def test_layout_removal_reclaims_only_owned_widget_preferences():
    async def run():
        async with isolated_database() as engine:
            async with engine.begin() as conn:
                for model in [models.User, models.UserScreen, models.UserWidget, models.UserWidgetState, models.UserTablePref, models.UserSetting, models.UserLayout]:
                    await conn.run_sync(model.__table__.create)
            async with AsyncSession(engine, expire_on_commit=False) as db:
                user = models.User(email="cleanup@example.com", hashed_password="unused")
                db.add(user)
                await db.commit()
                user_id = user.id
                payload = LayoutPayload.model_validate(layout())
                await service.save_user_layout(db, user_id, payload)
                widget = payload.widgets[0].id
                await service.save_table_pref(db, user_id, TablePrefPayload(scopeType="widget", scopeId=widget, tableId="table", prefs={}))
                await service.save_table_pref(db, user_id, TablePrefPayload(scopeType="page", scopeId="page", tableId="table", prefs={"preserve": True}))
                await service.save_user_layout(db, user_id, payload.model_copy(update={"widgets": [], "revision": 1}))
                prefs = (await db.execute(select(models.UserTablePref))).scalars().all()
                assert len(prefs) == 1 and prefs[0].scope_type == "page"
    asyncio.run(run())


def test_widget_state_waits_for_owner_before_locking_widget():
    """A concurrent layout holds owner then widget; state must use that order."""
    async def run():
        async with isolated_database() as engine:
            async with engine.begin() as conn:
                for model in [models.User, models.UserScreen, models.UserWidget, models.UserWidgetState]:
                    await conn.run_sync(model.__table__.create)
            async with AsyncSession(engine) as seed:
                user = models.User(email="lock-order@example.com", hashed_password="unused")
                seed.add(user)
                await seed.flush()
                owner = user.id
                screen, widget = str(uuid4()), str(uuid4())
                await seed.execute(insert(models.UserScreen).values(id=screen, user_id=owner, name="Screen", order=0, created_at=1))
                await seed.execute(insert(models.UserWidget).values(id=widget, user_id=owner, screen_id=screen, type="basic-chart", x=0, y=0, w=6, h=6, min_w=1, min_h=1, created_at=1))
                await seed.commit()
            async with AsyncSession(engine) as blocker, AsyncSession(engine) as writer, AsyncSession(engine) as observer:
                await blocker.execute(select(models.User.id).where(models.User.id == owner).with_for_update())
                pid = (await writer.execute(text("SELECT pg_backend_pid()"))).scalar_one()
                task = asyncio.create_task(service.save_widget_state(writer, owner, widget, WidgetStatePayload(symbol="AAPL")))
                try:
                    for _ in range(200):
                        waiting = (await observer.execute(text("SELECT wait_event_type FROM pg_stat_activity WHERE pid=:pid"), {"pid": pid})).scalar_one()
                        if waiting == "Lock":
                            break
                        # pg_stat_activity snapshots are transaction-scoped.
                        await observer.rollback()
                        await asyncio.sleep(0.01)
                    assert waiting == "Lock", "State writer did not reach the owner lock"
                    # This is available only if state has not locked widget first.
                    await observer.execute(select(models.UserWidget.id).where(models.UserWidget.id == widget).with_for_update(nowait=True))
                    await observer.rollback()
                finally:
                    await observer.rollback()
                    await blocker.rollback()
                    await asyncio.wait_for(task, timeout=3)
    asyncio.run(run())


def test_cumulative_settings_size_cannot_break_read_contract():
    async def run():
        async with isolated_database() as engine:
            async with engine.begin() as conn:
                await conn.run_sync(models.User.__table__.create)
                await conn.run_sync(models.UserSetting.__table__.create)
            async with AsyncSession(engine, expire_on_commit=False) as db:
                user = models.User(email="settings-size@example.com", hashed_password="unused")
                db.add(user)
                await db.commit()
                owner = user.id
                # These values retain the existing generic portfolio setting contract.
                original = {"portfolio.customA": "x" * 40_000}
                await service.save_user_settings(db, owner, original)
                with pytest.raises(HTTPException) as error:
                    await service.save_user_settings(db, owner, {"portfolio.customB": "y" * 40_000})
                assert error.value.status_code == 409
                await db.rollback()
                current = await service.get_user_settings(db, owner)
                assert SettingsPayload(settings=current).settings == original
    asyncio.run(run())

"""Exercise the existing migration chain in an empty generated schema only."""
import asyncio
import os
from pathlib import Path
import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import text
from backend.tests.test_public_identity_database import isolated_database


@pytest.mark.skipif(os.getenv("RUN_DATABASE_TESTS") != "1", reason="Requires local PostgreSQL")
def test_current_migration_chain_bootstraps_and_active_revisions_roll_back():
    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic"))
    revisions = list(reversed(list(ScriptDirectory.from_config(config).walk_revisions())))

    def apply(conn, commands):
        with Operations.context(MigrationContext.configure(conn)):
            for command in commands:
                command()

    async def run():
        async with isolated_database() as engine:
            async with engine.begin() as conn:
                await conn.run_sync(lambda sync: apply(sync, [rev.module.upgrade for rev in revisions]))
                tables = (await conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname=current_schema()"))).scalars().all()
                assert {"users", "auth_sessions", "user_layouts", "user_widgets"}.issubset(tables)
                active = [rev for rev in revisions if rev.revision in ("009_auth_sessions", "010_user_state_security")]
                await conn.run_sync(lambda sync: apply(sync, [rev.module.downgrade for rev in reversed(active)]))
                remaining = (await conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname=current_schema()"))).scalars().all()
                assert "users" in remaining
                assert "auth_sessions" not in remaining and "user_layouts" not in remaining
    asyncio.run(run())

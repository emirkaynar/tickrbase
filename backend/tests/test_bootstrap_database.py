"""Opt-in bootstrap proof using only a generated schema and role."""
import asyncio
import os
from uuid import uuid4

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool
import pytest

from backend.core import bootstrap
from backend.core.config import DATABASE_URL


pytestmark = pytest.mark.skipif(os.getenv('RUN_DATABASE_TESTS') != '1', reason='Requires local PostgreSQL with test-role creation privileges')


def test_clean_migrations_and_runtime_role_cannot_create_tables(monkeypatch):
    # Generate identifiers locally. Never interpolate identifiers from HTTP input.
    suffix = uuid4().hex
    schema = 'bootstrap_test_' + suffix
    role = 'runtime_test_' + suffix
    monkeypatch.setattr(bootstrap, 'DEV_MODE', False)
    config = bootstrap.Config()
    config.set_main_option('script_location', str(bootstrap.Path(__file__).resolve().parents[1] / 'alembic'))
    scripts = bootstrap.ScriptDirectory.from_config(config)

    def migrate(connection):
        with Operations.context(MigrationContext.configure(connection)):
            for revision in reversed(list(scripts.walk_revisions())):
                revision.module.upgrade()
        # Match what Alembic's command runner writes after the successful chain.
        connection.execute(text('CREATE TABLE alembic_version (version_num varchar(64) PRIMARY KEY)'))
        for head in scripts.get_heads():
            connection.execute(text('INSERT INTO alembic_version VALUES (:head)'), {'head': head})

    async def run():
        admin = create_async_engine(DATABASE_URL, poolclass=NullPool)
        scoped = create_async_engine(DATABASE_URL, poolclass=NullPool,
            connect_args={'server_settings': {'search_path': schema}})
        created_schema = created_role = False
        try:
            async with admin.begin() as connection:
                await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            created_schema = True
            async with admin.begin() as connection:
                await connection.execute(text(f'CREATE ROLE "{role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT'))
            created_role = True
            async with scoped.begin() as connection:
                await connection.run_sync(migrate)
                await connection.execute(text('CREATE TABLE runtime_probe_data (id integer PRIMARY KEY)'))
                await connection.execute(text(f'GRANT USAGE ON SCHEMA "{schema}" TO "{role}"'))
                await connection.execute(text(f'GRANT SELECT ON alembic_version TO "{role}"'))
                await connection.execute(text(f'GRANT SELECT, INSERT ON runtime_probe_data TO "{role}"'))
            async with scoped.begin() as connection:
                await connection.execute(text(f'SET LOCAL ROLE "{role}"'))
                await connection.run_sync(bootstrap.check_schema)
                await connection.execute(text('INSERT INTO runtime_probe_data VALUES (7)'))
                assert (await connection.execute(text('SELECT id FROM runtime_probe_data'))).scalar_one() == 7
            async with scoped.begin() as connection:
                await connection.execute(text(f'SET LOCAL ROLE "{role}"'))
                with pytest.raises(DBAPIError) as caught:
                    await connection.execute(text('CREATE TABLE forbidden_ddl (id integer)'))
                assert getattr(caught.value.orig, 'sqlstate', None) == '42501'
                await connection.rollback()
        finally:
            await scoped.dispose()
            if created_schema:
                async with admin.begin() as connection:
                    await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            if created_role:
                async with admin.begin() as connection:
                    await connection.execute(text(f'DROP ROLE "{role}"'))
            await admin.dispose()
    asyncio.run(run())

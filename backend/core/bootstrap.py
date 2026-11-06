"""Read-only runtime checks. Only the deployment migrator may create schema."""
from pathlib import Path

from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import text

from .config import DEV_MODE


def check_schema(connection):
    config = Config()
    config.set_main_option('script_location', str(Path(__file__).resolve().parents[1] / 'alembic'))
    expected = set(ScriptDirectory.from_config(config).get_heads())
    actual = set(MigrationContext.configure(connection).get_current_heads())
    if actual != expected:
        raise RuntimeError('Database schema is not current; run Alembic upgrade head with the migrator role')
    if not DEV_MODE:
        unsafe = connection.execute(text("""
            SELECT r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
                OR has_schema_privilege(current_user, current_schema(), 'CREATE')
                OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                           WHERE n.nspname=current_schema() AND c.relowner=r.oid)
            FROM pg_roles r WHERE r.rolname=current_user
        """)).scalar_one()
        if unsafe:
            raise RuntimeError('Runtime database role must not own tables or have schema CREATE/elevated privileges')


async def check_database(engine):
    async with engine.connect() as connection:
        await connection.run_sync(check_schema)

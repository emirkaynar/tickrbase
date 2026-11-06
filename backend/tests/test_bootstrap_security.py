import asyncio
from unittest.mock import Mock

import httpx
import pytest

from backend.core import bootstrap


def test_schema_mismatch_rejected_without_creating_tables(monkeypatch):
    migration = Mock()
    migration.get_current_heads.return_value = ('obsolete',)
    monkeypatch.setattr(bootstrap.MigrationContext, 'configure', lambda connection: migration)
    connection = Mock()
    with pytest.raises(RuntimeError, match='schema is not current'):
        bootstrap.check_schema(connection)
    connection.execute.assert_not_called()


@pytest.mark.parametrize('unsafe', [False, True])
def test_nonlocal_runtime_role_must_have_no_ddl(monkeypatch, unsafe):
    config = bootstrap.Config()
    config.set_main_option('script_location', str(bootstrap.Path(__file__).resolve().parents[1] / 'alembic'))
    heads = bootstrap.ScriptDirectory.from_config(config).get_heads()
    migration = Mock()
    migration.get_current_heads.return_value = heads
    monkeypatch.setattr(bootstrap.MigrationContext, 'configure', lambda connection: migration)
    monkeypatch.setattr(bootstrap, 'DEV_MODE', False)
    connection = Mock()
    connection.execute.return_value.scalar_one.return_value = unsafe
    if unsafe:
        with pytest.raises(RuntimeError, match='Runtime database role'):
            bootstrap.check_schema(connection)
    else:
        bootstrap.check_schema(connection)


def test_live_and_ready_and_cors_fail_safely(monkeypatch):
    import backend.main as main
    from backend.core.config import CORS_ORIGINS
    trusted_origin = CORS_ORIGINS[0]
    async def unavailable(*args):
        raise RuntimeError('postgresql://password-secret')
    monkeypatch.setattr(main, 'check_database', unavailable)

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://test') as client:
            live = await client.get('/live')
            assert live.status_code == 200
            ready = await client.get('/ready', headers={'Origin': trusted_origin})
            assert ready.status_code == 503
            assert 'secret' not in ready.text
            assert ready.headers['access-control-allow-origin'] == trusted_origin
            hostile = await client.post('/auth/login', headers={'Origin': 'https://hostile.invalid'})
            assert hostile.status_code == 403
            assert 'access-control-allow-origin' not in hostile.headers
            assert hostile.headers['x-request-id']
            assert hostile.headers['x-content-type-options'] == 'nosniff'
    asyncio.run(run())

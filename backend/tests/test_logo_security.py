import asyncio
import logging
from urllib.parse import quote, quote_plus

import httpx
import pytest

from backend.services import logos


@pytest.mark.parametrize("failure", [False, True])
@pytest.mark.parametrize("token", ["test-provider-token-never-log-this", "test/token+with spaces"])
def test_logo_logs_never_include_credentials(monkeypatch, capsys, caplog, failure, token):
    monkeypatch.setattr(logos, "LOGO_DEV_TOKEN", token)

    def upstream(request):
        assert request.url.params["token"] == token
        assert request.headers["Authorization"] == f"Bearer {token}"
        if failure:
            raise httpx.ConnectError(f"Cannot connect: {request.url}", request=request)
        return httpx.Response(200, content=b"RIFF0000WEBPimage", headers={'content-type': 'image/webp'})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            return await logos._fetch_logo_from_dev(client, "TEST")

    with caplog.at_level(logging.INFO):
        status, _ = asyncio.run(run())
    captured = capsys.readouterr()
    assert status == (500 if failure else 200)
    output = captured.out + captured.err + caplog.text
    for representation in (token, quote(token, safe=""), quote_plus(token)):
        assert representation not in output


class MemoryRedis:
    def __init__(self):
        self.values = {}
        self.attempts = 0

    async def get(self, key):
        return self.values.get(key)

    async def set(self, key, value, ex=None, nx=False):
        if nx and key in self.values:
            return False
        self.values[key] = value
        return True

    async def eval(self, script, count, key, *args):
        if script == logos._UNLOCK:
            self.values.pop(key, None)
            return 1
        if self.attempts >= int(args[0]):
            return 0
        self.attempts += 1
        return 1


@pytest.mark.parametrize('status', [429, 500, 502])
def test_transient_logo_failures_are_never_cached_as_missing(monkeypatch, status):
    redis = MemoryRedis()
    monkeypatch.setattr(logos, 'LOGO_DEV_TOKEN', 'test-token')
    monkeypatch.setattr(logos, 'get_redis_client', lambda: redis)
    monkeypatch.setattr(logos, '_get_client', lambda: None)
    async def fetch(*args):
        return status, None
    monkeypatch.setattr(logos, '_fetch_logo_from_dev', fetch)
    with pytest.raises(logos.LogoUnavailable):
        asyncio.run(logos.get_logo('TEST'))
    assert redis.attempts == 1
    assert 'logo:bytes:TEST' not in redis.values


def test_logo_singleflight_and_fallback_count_each_attempt(monkeypatch):
    redis = MemoryRedis()
    monkeypatch.setattr(logos, 'LOGO_DEV_TOKEN', 'test-token')
    monkeypatch.setattr(logos, 'get_redis_client', lambda: redis)
    monkeypatch.setattr(logos, '_get_client', lambda: None)
    async def fetch(client, ticker):
        await asyncio.sleep(0)
        return (404, None) if '.' in ticker else (200, b'RIFF0000WEBPimage')
    monkeypatch.setattr(logos, '_fetch_logo_from_dev', fetch)
    async def run():
        return await asyncio.gather(*(logos.get_logo('TEST.IS') for _ in range(20)))
    assert asyncio.run(run()) == [b'RIFF0000WEBPimage'] * 20
    assert redis.attempts == 2


def test_logo_budget_counts_failed_fallback_and_never_exceeds_limit(monkeypatch):
    redis = MemoryRedis()
    monkeypatch.setattr(logos, 'LOGO_DEV_TOKEN', 'test-token')
    monkeypatch.setattr(logos, 'LOGO_DEV_MONTHLY_LIMIT', 1)
    monkeypatch.setattr(logos, 'get_redis_client', lambda: redis)
    monkeypatch.setattr(logos, '_get_client', lambda: None)
    async def fetch(*args):
        return 404, None
    monkeypatch.setattr(logos, '_fetch_logo_from_dev', fetch)
    with pytest.raises(logos.LogoUnavailable):
        asyncio.run(logos.get_logo('TEST.IS'))
    assert redis.attempts == 1
    assert 'logo:bytes:TEST.IS' not in redis.values


@pytest.mark.parametrize('content,content_type', [(b'HTML', 'text/html'), (b'RIFF0000WEBP' + b'x' * logos.MAX_IMAGE_BYTES, 'image/webp')], ids=['wrong-type', 'oversized'])
def test_logo_provider_rejects_wrong_or_oversized_images(content, content_type):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request:
                httpx.Response(200, content=content, headers={'content-type': content_type}))) as client:
            return await logos._fetch_logo_from_dev(client, 'TEST')
    assert asyncio.run(run()) == (502, None)

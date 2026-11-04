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
        return httpx.Response(200, content=b"image")

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

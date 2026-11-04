import asyncio

from fastapi import FastAPI, HTTPException
import httpx
from pydantic import BaseModel

from backend.core.errors import install_error_handling


def test_errors_are_safe_correlated_and_preserve_headers():
    app = FastAPI()
    install_error_handling(app)

    @app.get('/failure')
    async def failure():
        raise RuntimeError('password=secret SQL SELECT token=secret')

    @app.get('/limited')
    async def limited():
        raise HTTPException(429, 'Too many requests', headers={'Retry-After': '60'})

    class Body(BaseModel):
        count: int

    @app.post('/validate')
    async def validate(body: Body):
        return body

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            failed = await client.get('/failure')
            assert failed.status_code == 500
            assert 'secret' not in failed.text and 'SELECT' not in failed.text
            assert failed.json()['code'] == 'INTERNAL_ERROR'
            assert failed.headers['x-request-id'] == failed.json()['request_id']
            assert failed.headers['x-content-type-options'] == 'nosniff'
            assert failed.headers['x-frame-options'] == 'DENY'
            limited = await client.get('/limited')
            assert limited.headers['retry-after'] == '60'
            invalid = await client.post('/validate', json={'count': 'password=secret'})
            assert invalid.status_code == 422
            assert 'secret' not in invalid.text
            assert invalid.json()['fields'][0]['field'] == 'body.count'
    asyncio.run(run())

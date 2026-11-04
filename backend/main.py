from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api.auth import router as auth_router
from .api.market import router as market_router
from .api.portfolio import router as portfolio_router
from .api.user_data import router as user_data_router
from .api.ws import router as ws_router
from .api.deps import get_current_user
from .core.browser_security import BrowserSecurityMiddleware
from .core.bootstrap import check_database
from .core.config import CORS_ORIGINS
from .core.database import engine
from .core.errors import install_error_handling, REQUEST_COUNTS, REQUEST_SECONDS
from .core.redis import close_redis, get_redis_client
from .core.telemetry import snapshot as resource_metrics
from .scheduler import create_scheduler
from .services.logos import close_logo_client
from .services.streaming import LivePriceStreamHub

stream_hub = LivePriceStreamHub()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # No runtime DDL. A schema mismatch fails startup before workers accept traffic.
    await asyncio.wait_for(check_database(engine), timeout=5)
    await asyncio.wait_for(get_redis_client().ping(), timeout=3)
    await stream_hub.start()
    scheduler = create_scheduler()
    scheduler.start()
    try:
        yield
    finally:
        await stream_hub.broadcast_shutdown('Server shutting down')
        await stream_hub.stop()
        scheduler.shutdown(wait=False)
        await close_logo_client()
        await close_redis()
        await engine.dispose()


app = FastAPI(title='tickrbase SaaS API', version='2.0.0', lifespan=lifespan)
app.add_middleware(BrowserSecurityMiddleware)
install_error_handling(app)
# CORS wraps both the request boundary and browser policy, including their errors.
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_credentials=True,
    allow_methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allow_headers=['Content-Type', 'Authorization', 'If-Match'],
    expose_headers=['X-Request-ID', 'Retry-After', 'ETag'])


@app.get('/live', include_in_schema=False)
async def live():
    return {'status': 'ok'}


@app.get('/ready', include_in_schema=False)
async def ready():
    try:
        await asyncio.wait_for(check_database(engine), timeout=3)
        await asyncio.wait_for(get_redis_client().ping(), timeout=2)
    except Exception:
        return JSONResponse({'status': 'unavailable'}, status_code=503)
    return {'status': 'ready'}


@app.get('/ops/metrics', dependencies=[Depends(get_current_user)], include_in_schema=False)
async def metrics():
    # Bounded route templates/status classes; no user/ticker/query labels.
    pool = engine.sync_engine.pool
    return {'resources': resource_metrics(),
            'database_pool': {'size': pool.size(), 'checked_out': pool.checkedout(), 'overflow': pool.overflow()},
            'redis_pool': {'max_connections': get_redis_client().connection_pool.max_connections},
            'stream': stream_hub.stats(),
            'requests': [{'method': m, 'route': r, 'status_class': s, 'count': n}
                         for (m, r, s), n in REQUEST_COUNTS.items()],
            'duration_buckets': [{'method': m, 'route': r, 'status_class': s,
                                  'le': str(b), 'count': n}
                                for (m, r, s, b), n in REQUEST_SECONDS.items()]}


app.include_router(auth_router)
app.include_router(market_router)
app.include_router(portfolio_router)
app.include_router(user_data_router)
app.include_router(ws_router)

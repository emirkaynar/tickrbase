from __future__ import annotations

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api.auth import router as auth_router
from .api.market import router as market_router
from .api.portfolio import router as portfolio_router
from .api.user_data import router as user_data_router
from .api.ws import router as ws_router
from .core.config import CORS_ORIGINS
from .core.database import Base, engine
from .core.redis import close_redis, get_redis_client
from .scheduler import create_scheduler
from .services.streaming import LivePriceStreamHub

stream_hub = LivePriceStreamHub()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Initialize DB schema automatically
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Initialize Redis connection
    _redis = get_redis_client()

    # Start live price stream hub & scheduler
    await stream_hub.start()
    scheduler = create_scheduler()
    scheduler.start()

    yield

    # Cleanup
    await stream_hub.broadcast_shutdown("Server shutting down")
    await stream_hub.stop()
    scheduler.shutdown(wait=False)
    await close_redis()
    await engine.dispose()


app = FastAPI(
    title="tickrbase SaaS API",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(ValueError)
async def value_error_handler(_request: Request, exc: ValueError):
    return JSONResponse(
        status_code=400,
        content={"error": True, "message": str(exc)},
        headers={"Access-Control-Allow-Origin": "*"},
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": True, "message": str(exc.detail)},
        headers={"Access-Control-Allow-Origin": "*"},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"error": True, "message": str(exc)},
        headers={"Access-Control-Allow-Origin": "*"},
    )


app.include_router(auth_router)
app.include_router(market_router)
app.include_router(portfolio_router)
app.include_router(user_data_router)
app.include_router(ws_router)

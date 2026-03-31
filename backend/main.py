from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api.routes import build_router
from .core.cache import TTLCache
from .core.config import CORS_ORIGINS, PRICE_TTL_SECONDS
from .core.db import init_db
from .core.yahoo import YahooFinanceProvider
from .scheduler import create_scheduler
from .services.streaming import LivePriceStreamHub


provider = YahooFinanceProvider()
price_cache = TTLCache[float](PRICE_TTL_SECONDS)
stream_hub = LivePriceStreamHub()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    await stream_hub.start()
    scheduler = create_scheduler(provider, price_cache)
    scheduler.start()
    yield
    await stream_hub.broadcast_shutdown("Server is shutting down")
    await stream_hub.stop()
    scheduler.shutdown(wait=False)


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(ValueError)
async def value_error_handler(_request: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"error": True, "message": str(exc)})


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": True, "message": str(exc.detail)},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"error": True, "message": str(exc)})


app.include_router(build_router(provider, price_cache, stream_hub))

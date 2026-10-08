# tickrbase Investment Dashboard

A modular BIST (Turkish Stock Market) investment dashboard featuring a Python backend and Preact frontend.

## Features

✅ **Real-time Chart Widget** - Lightweight Charts v5 with dynamic chart types (Candlesticks, Line, Area, Bar) and timezone support  
✅ **Symbol Selection & Lookup** - Full BIST ticker lookup backed by TradingView scanner data  
✅ **Multiple Timeframe Intervals** - Intraday (1m, 5m, 15m, 30m, 1h) & Daily/Long-term (1d, 1wk, 1mo)  
✅ **Persistent Layout & Screens** - Multi-screen grid layout saved directly to PostgreSQL  
✅ **Chart State Persistence** - Symbol, interval, chart type and visible range stored per widget; display timezone follows user settings
✅ **PostgreSQL History Caching** - PostgreSQL OHLC cache stores full history, serving delta refreshes efficiently  
✅ **Redis Caching & WebSocket Ticks** - Redis pub/sub for real-time live price streaming and search caching  
✅ **Watchlists & Settings** - User watchlist management with customizable column preferences  

## Quick Start

### 1. Start Infrastructure (PostgreSQL & Redis)

Start PostgreSQL 16 and Redis 7 via Docker Compose:

```bash
docker compose -f docker-compose.dev.yml up -d
```

### 2. Backend Setup

```bash
# Install Python dependencies
pip install -r backend/requirements.txt

# Run database migrations
python -m alembic -c backend/alembic.ini upgrade head

# Start FastAPI dev server
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8001
```

### 3. Frontend Setup

```bash
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

## Stack

- **Backend**: FastAPI, Python 3.10+, PostgreSQL 16 (`postgresql+asyncpg`), SQLAlchemy 2.0 Async, Alembic, Redis 7 (`redis.asyncio`), yfinance, APScheduler
- **Frontend**: Preact, Vite, TypeScript, Lightweight Charts v5, `react-grid-layout`, Ark UI, CSS Modules
- **Data Source**: Yahoo Finance (BIST tickers normalized with `.IS` suffix), TradingView scanner

## Project Structure

```
tickrbase/
├── backend/                  # FastAPI backend application
│   ├── alembic/             # Database migration scripts
│   ├── api/                 # REST & WebSocket route endpoints
│   ├── core/                # DB engine, Redis client, config & caching
│   ├── providers/           # Data providers (Yahoo Finance)
│   ├── schemas/             # Pydantic request/response models
│   └── services/            # Business logic (user data, quotes, history)
├── src/                     # Preact frontend application
│   ├── features/            # Page layouts & top-level views
│   ├── grid/                # Grid layout engine & state restoration
│   ├── services/            # API clients, quotes, live prices, settings
│   ├── ui/                  # Reusable UI components (Select, Table, TickerSelector)
│   └── widgets/             # Self-registering dashboard widgets (BasicChart, Lists, etc.)
└── docker-compose.dev.yml   # Docker Compose for PostgreSQL 16 & Redis 7
```

## License

MIT

## BasicChart market data

Set the display timezone under Settings / General / Timezone. All BasicCharts
follow this user preference immediately; sessions continue to use exchange time.
Legacy per-widget timezone values are ignored.

US equity and ETF charts show regular-session candles. Pre-market, post-market,
and overnight websocket quotes update one active price-axis label without adding
candles or time-axis points. Before the open, candles end at the previous trading
session; after the close, they end at the latest completed session. The label
expires at a phase transition and includes stale status after 60 seconds. Automatic
scaling includes the quote near the latest candles; manual scaling and historical
views keep their existing range. Other markets request extended sessions where
supported. The status chip
separates scheduled sessions, source quote age, connection health, and history
coverage. Quotes older than 60 seconds during a supported scheduled session are
marked stale; a delayed-feed label requires source metadata. Missing source
timestamps remain unknown. No-observation shading does not imply trades occurred,
and closed periods are not treated as missing candles.

History caches are partitioned by source and session mode. Existing rows migrate
to `yahoo / regular`; extended history initializes separately. Apply migration
`007_history_sources` before running the updated backend against an existing DB:

```powershell
.\backend\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\backend\.venv\Scripts\python.exe -m alembic -c backend/alembic.ini upgrade head
```

Calendar support covers US equities, BIST, London, Xetra, and Paris using
`exchange_calendars` plus documented venue rules. The reviewed horizon ends on
December 31, 2026; later dates show an unknown session until reviewed. Overnight
activity outside a verified window is explicitly unverified. Yahoo overnight
history is unavailable; accepted regular-session live bars and the latest quote survive chart remounts in memory,
but are not stored server-side. Additional providers should normalize timestamps,
exchange identifiers, coverage capabilities, and source identity at the backend
adapter boundary. Provider connection settings and credentials are deferred.

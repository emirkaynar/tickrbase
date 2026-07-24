# tickrbase Investment Dashboard

A modular BIST (Turkish Stock Market) investment dashboard featuring a Python backend and Preact frontend.

## Features

✅ **Real-time Chart Widget** - Lightweight Charts v5 with dynamic chart types (Candlesticks, Line, Area, Bar) and timezone support  
✅ **Symbol Selection & Lookup** - Full BIST ticker lookup backed by TradingView scanner data  
✅ **Multiple Timeframe Intervals** - Intraday (1m, 5m, 15m, 30m, 1h) & Daily/Long-term (1d, 1wk, 1mo)  
✅ **Persistent Layout & Screens** - Multi-screen grid layout saved directly to PostgreSQL  
✅ **Chart State Persistence** - Symbol, interval, chart type, timezone, and visible range stored per widget  
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
alembic upgrade head

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

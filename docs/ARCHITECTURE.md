# System Architecture

## Stack
- **Backend**: Python 3.11+, FastAPI, yfinance, APScheduler, SQLite
- **Frontend**: Preact, Vite, Lightweight Charts, react-grid-layout, Dexie (IndexedDB)
- **Communication**: REST API (HTTP/JSON)

## Backend Layers

### 1. Provider Layer (`backend/core/provider.py`)
Abstract interface for market data sources. Current implementation: `YahooFinanceProvider`.

Methods:
- `get_price(ticker) -> (price, timestamp)`
- `get_history(ticker, interval, period/start/end) -> List[Candle]`
- `get_company_info(ticker) -> dict`

### 2. Cache Layer
Two-tier caching:

#### In-Memory TTL Cache (`backend/core/cache.py`)
- Generic `TTLCache[T]` class
- Price cache: 60s TTL
- Fallback to stale on provider failure

#### SQLite Persistent Cache (`backend/core/history_cache.py`)
- Max-extent OHLCV storage per ticker+interval
- Delta refresh: only fetch bars since last update
- Tables: `ohlc` (bars), `history_meta` (last_refresh timestamps)
- `get_history()` returns (candles, stale, last_updated)
- Supports `since` parameter for delta queries

### 3. Service Layer (`backend/services/`)
Business logic modules:
- `prices.py`: Price fetch + formatting
- `portfolio.py`: Position tracking + PnL calculation
- `alerts.py`: Alert CRUD + evaluation
- `watchlist.py`: Track active ticker+interval pairs
- `symbols.py`: BIST symbol list from TradingView

### 4. API Layer (`backend/api/routes.py`)
FastAPI router with typed request/response models (Pydantic).

Endpoints:
- `/price/{ticker}`
- `/history/{ticker}?interval&period&since`
- `/portfolio` (GET/POST)
- `/portfolio/{ticker}` (DELETE)
- `/alerts` (GET/POST)
- `/alerts/{id}` (DELETE)
- `/symbols`
- `/watchlist` (GET/POST)

### 5. Scheduler (`backend/scheduler.py`)
APScheduler background jobs:
- Alert evaluation: every 3 minutes
- Watchlist refresh: every 5 minutes

## Frontend Architecture

### Component Tree
```
App (src/app.tsx)
└── GridLayout (src/grid/GridLayout.tsx)
    ├── TopBar (src/components/TopBar.tsx)
    └── StockChart widgets (src/widgets/StockChart/index.tsx)
        ├── SymbolSelect (src/components/SymbolSelect/SymbolSelect.tsx)
        └── IntervalSelect (src/components/IntervalSelect/IntervalSelect.tsx)
```

### Data Flow
1. Widget loads: fetch full history via `/history/{ticker}`
2. Apply bars to chart, save `lastBarTimeRef`
3. Poll every 60s (intraday) or 5min (daily)
4. Before poll: save chart zoom to `chartStateRef`, persist to IndexedDB
5. Fetch delta: `/history/{ticker}?since={lastBarTime}`
6. Append new bars to chart
7. Restore zoom from `chartStateRef`

### State Management
- **React hooks**: Component-local state
- **IndexedDB (Dexie)**: Persistent state
  - `layout`: Grid layout items
  - `widgetState`: Symbol + interval per widget
  - `chartState`: Zoom/pan state per widget
- **Module-level Maps**: Cross-remount state
  - `everLoaded`: Track first successful load
  - `lastState`: Seed remounted widgets instantly

### Styling
- CSS custom properties in `src/styles/tokens.css`
- JS mirror in `src/styles/tokens.ts` (for canvas APIs)

## Data Models

### Backend (Pydantic)
```python
Candle: time, open, high, low, close, volume
PriceResponse: ticker, current_price, timestamp, stale, last_updated
HistoryResponse: ticker, interval, candles[], stale, last_updated
PortfolioPosition: ticker, quantity, avg_price, current_price, pnl, pnl_percent
AlertRecord: id, ticker, condition, threshold, active, created_at, last_triggered_at
```

### Frontend (TypeScript)
```typescript
Bar: time (Unix seconds), open, high, low, close
Interval: "1m" | "5m" | "15m" | "30m" | "1h" | "1d" | "1wk" | "1mo"
SymbolItem: label, value (ticker with .IS suffix)
```

## Database Schema (SQLite)

### ohlc
- PK: (ticker, interval, time)
- Columns: open, high, low, close, volume

### history_meta
- PK: (ticker, interval)
- Columns: last_refresh (Unix timestamp)

### portfolio
- PK: id
- Unique: ticker
- Columns: quantity, avg_price, created_at

### alerts
- PK: id
- Columns: ticker, condition, threshold, active, created_at, last_triggered_at

### watchlist
- PK: (ticker, interval)
- Columns: last_seen (Unix timestamp)

### symbols
- PK: id ("bist")
- Columns: payload (JSON), fetched_at

## Configuration (`backend/core/config.py`)

Key settings:
- `PRICE_TTL_SECONDS = 60`
- `HISTORY_TTL_SECONDS = 600`
- `ALERT_INTERVAL_SECONDS = 180`
- `YAHOO_MAX_RANGE`: Dict mapping intervals to max periods
- `INTERVAL_SECONDS`: Interval durations for delta padding
- `CORS_ORIGINS`: Local dev origins

## Error Handling

### Backend
- Consistent JSON envelope: `{"error": true, "message": "..."}`
- HTTP status codes: 400 (validation), 502 (provider), 500 (internal)
- Exception handlers in `main.py` for ValueError, HTTPException, Exception

### Frontend
- `apiGet()` / `apiPost()` throw on error response
- Widgets catch errors, set status to "error" or show warning
- Delta poll failures show warning banner, don't break chart

## Security (v1)

- **CORS**: Allow localhost:5173 only
- **No auth**: Single-user local app
- **No validation**: Trust ticker input (normalized server-side)

Future: Add API keys, rate limiting, input sanitization for multi-user.

# Agent Guide: Lima Investment Dashboard

## Project Overview
Lima is a modular BIST (Turkish stock market) investment dashboard with Python FastAPI backend and Preact frontend. The system uses a provider abstraction pattern to fetch market data (currently yfinance), caches it aggressively in SQLite, and serves it via REST API.

## Architecture Principles

### 1. Backend is Single Source of Truth
- All calculations (PnL, alerts) happen in backend
- Frontend only handles UI state (layout, zoom/pan)
- Market data stored in SQLite, not browser

### 2. Data Flow
```
yfinance → Backend SQLite cache → REST API → Frontend widgets
                ↓
         Alert scheduler (APScheduler)
         Watchlist refresh (periodic)
```

### 3. Caching Strategy
- **History**: Max-extent cache in SQLite (per interval), append-only updates
- **Price**: In-memory TTL cache (60s)
- **Symbols**: SQLite cache (24h TTL), fallback to TradingView scanner
- **Frontend**: IndexedDB for layout/widget state only

### 4. Ticker Normalization
All BIST tickers get `.IS` suffix via `normalize_ticker()` in backend before any provider call.

## Key Files

### Backend
- `backend/main.py` - FastAPI app, CORS, global provider/cache instances
- `backend/core/yahoo.py` - yfinance provider (lazy imports to avoid DLL issues on Windows)
- `backend/core/history_cache.py` - SQLite-backed max-extent OHLC cache with `since` support
- `backend/api/routes.py` - REST endpoints (price, history, portfolio, alerts, symbols, watchlist)
- `backend/scheduler.py` - APScheduler for alerts (3min) and watchlist refresh (5min)
- `backend/core/db.py` - SQLite wrapper with thread-safe connection pooling

### Frontend
- `src/widgets/StockChart/index.tsx` - Main chart widget with delta polling
- `src/data/api.ts` - Centralized fetch wrapper with error handling
- `src/data/symbols.ts` - Symbol list loader (backend API)
- `src/db/index.ts` - Dexie (IndexedDB) for layout/widget state/chart zoom
- `src/grid/useLayout.ts` - react-grid-layout persistence

## REST API Contracts

### GET /history/{ticker}?interval=1d&period=1y&since=1234567890
- Returns OHLCV candles
- If `since` provided, returns only bars with `time > since` (delta fetch)
- Slices from cached SQLite history (no re-fetch unless stale)

### GET /price/{ticker}
- Returns current price with `stale` flag and `last_updated` timestamp

### POST /watchlist
- Body: `{"items": [{"ticker": "ASELS.IS", "interval": "1d"}]}`
- Upserts watchlist for periodic backend refresh

### GET /symbols
- Returns cached BIST symbol list from TradingView scanner

## Critical Patterns

### 1. Delta History Polling (StockChart Widget)
- Initial load: fetch full history, fit chart
- Poll every 60s (intraday) or 5min (daily)
- Use `lastBarTimeRef` to track latest bar time
- Call `/history?since={lastBarTime}` for delta
- Append new bars to chart without resetting zoom

### 2. Chart State Persistence
- Save zoom/pan to IndexedDB before each poll (`chartStateRef`)
- Restore after applying new data
- Prevents jarring resets during live updates

### 3. Lazy yfinance Imports
- Import yfinance inside methods, not at module level
- Workaround for Windows DLL security policy blocking pandas

### 4. Error Handling
- Backend: Consistent `{"error": true, "message": "..."}` envelope
- Frontend: Show warnings for delta failures, errors for critical failures
- Fallback to stale cache if provider fails

## Common Tasks

### Add New Widget
1. Create in `src/widgets/{Name}/index.tsx`
2. Export from `src/widgets/index.ts`
3. Add to grid in `src/grid/GridLayout.tsx`
4. Persist widget state in IndexedDB via `db.widgetState.put()`

### Add New Data Provider
1. Implement `DataProvider` interface in `backend/core/provider.py`
2. Swap `YahooFinanceProvider()` in `backend/main.py`
3. Update `normalize_ticker()` if needed

### Add New API Endpoint
1. Add route in `backend/api/routes.py` using `build_router()`
2. Add Pydantic models in `backend/core/models.py`
3. Create service in `backend/services/` if business logic needed

## Development

### Start Backend
```bash
cd d:\Dev\lima
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

### Start Frontend
```bash
npm run dev  # Vite dev server on :5173
```

### Database
- SQLite DB at `d:\Dev\lima\data\lima.db`
- Schema auto-created on startup via `init_db()`
- Tables: `ohlc`, `history_meta`, `portfolio`, `alerts`, `watchlist`, `symbols`

## Known Issues

1. **Windows pandas DLL**: Fixed by lazy imports in yahoo.py
2. **Infinite re-renders**: Use refs not state for lastBarTime
3. **Chart zoom reset**: Save/restore `chartStateRef` before/after updates
4. **Symbol not showing**: Pass `value={symbol}` to SymbolSelect

## Future Extensions (v2+)
- WebSocket streaming for real-time updates
- ML/AI modules for stock analysis
- Multi-device sync (move layout to backend)
- Portfolio widgets (use `/portfolio` endpoints)
- Alert widgets (use `/alerts` endpoints)

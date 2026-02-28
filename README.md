# Lima Investment Dashboard

A modular BIST (Turkish stock market) investment dashboard with Python backend and Preact frontend.

## Features

✅ **Real-time Chart Widget** - Candlestick charts with delta polling (updates every 60s for intraday, 5min for daily)  
✅ **Symbol Selection** - Full BIST ticker list from TradingView scanner  
✅ **Multiple Intervals** - 1m, 5m, 15m, 30m, 1h, 1d, 1wk, 1mo  
✅ **Persistent Layout** - Grid layout saved to IndexedDB  
✅ **Chart State Persistence** - Zoom/pan restored across updates  
✅ **Max-extent Caching** - SQLite cache stores full history, delta refresh for efficiency  
✅ **Portfolio API** - Track positions with PnL calculation  
✅ **Alerts API** - Price alerts with background evaluation

🔨 **Pending** - Portfolio widget UI, Alerts widget UI, WebSocket streaming

## Quick Start

### Backend

```bash
pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

### Frontend

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Documentation

- [AGENT.md](docs/AGENT.md) - High-level guide for AI agents
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) - System design and data flow
- [API.md](docs/API.md) - Complete API reference
- [DEVELOPMENT.md](docs/DEVELOPMENT.md) - Development workflows and troubleshooting
- [DATABASE.md](docs/DATABASE.md) - Database schema and queries
- [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) - Common issues and fixes
- [STATUS.md](docs/STATUS.md) - Implementation status and roadmap
- [QUICK_REFERENCE.md](docs/QUICK_REFERENCE.md) - Quick reference for common tasks

## Stack

- **Backend**: FastAPI, yfinance, SQLite, APScheduler
- **Frontend**: Preact, Vite, Lightweight Charts, react-grid-layout, Dexie
- **Data Source**: Yahoo Finance (BIST ticker normalization with .IS suffix)

## Project Structure

```
lima/
├── backend/           # FastAPI backend
│   ├── main.py       # App entry
│   ├── api/          # REST routes
│   ├── core/         # Provider, cache, models
│   └── services/     # Business logic
├── src/              # Preact frontend
│   ├── widgets/      # Chart, portfolio, alerts
│   ├── data/         # API client
│   ├── grid/         # Layout management
│   └── db/           # IndexedDB (Dexie)
└── data/             # SQLite database
```

## Key Features

### Delta History Polling

- Initial load fetches full period
- Subsequent polls fetch only new bars using `since` parameter
- Prevents redundant data transfers and chart resets
- Chart zoom/pan preserved across updates

### Persistent Caching

- SQLite stores max-extent history per ticker+interval
- Backend scheduler refreshes watchlist every 5 minutes
- Stale cache served if provider fails (resilient to downtime)

### Provider Abstraction

Swap data sources by implementing `DataProvider` interface. Current: Yahoo Finance.

## License

MIT

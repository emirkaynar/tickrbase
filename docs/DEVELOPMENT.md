# Development Guide

## Setup

### Prerequisites

- Python 3.11+
- Node.js 18+
- npm or bun

### Initial Setup

1. **Clone and install backend**

```bash
cd d:\Dev\lima
pip install -r backend/requirements.txt
```

2. **Install frontend**

```bash
npm install
```

## Running the App

### Backend

```bash
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Backend runs on http://127.0.0.1:8000

### Frontend

```bash
npm run dev
```

Frontend runs on http://localhost:5173

## Project Structure

```
lima/
├── backend/
│   ├── main.py                 # FastAPI app entry
│   ├── scheduler.py            # APScheduler jobs
│   ├── api/
│   │   └── routes.py           # REST endpoints
│   ├── core/
│   │   ├── config.py           # Settings
│   │   ├── models.py           # Pydantic schemas
│   │   ├── provider.py         # Data provider interface
│   │   ├── yahoo.py            # yfinance implementation
│   │   ├── cache.py            # In-memory TTL cache
│   │   ├── history_cache.py   # SQLite history cache
│   │   └── db.py               # SQLite wrapper
│   └── services/
│       ├── prices.py           # Price fetching
│       ├── portfolio.py        # Position tracking
│       ├── alerts.py           # Alert logic
│       ├── watchlist.py        # Watchlist tracking
│       └── symbols.py          # Symbol list
├── src/
│   ├── main.tsx                # Frontend entry
│   ├── app.tsx                 # Root component
│   ├── components/
│   │   ├── TopBar.tsx
│   │   ├── SymbolSelect/
│   │   └── IntervalSelect/
│   ├── widgets/
│   │   └── StockChart/
│   │       ├── index.tsx       # Chart widget
│   │       └── StockChart.css
│   ├── data/
│   │   ├── api.ts              # API client
│   │   ├── types.ts            # Type definitions
│   │   ├── symbols.ts          # Symbol list hook
│   │   ├── watchlist.ts        # Watchlist sync
│   │   ├── cache.ts            # Memory cache (deprecated)
│   │   └── query.ts            # Query helpers (deprecated)
│   ├── db/
│   │   └── index.ts            # Dexie IndexedDB
│   ├── grid/
│   │   ├── GridLayout.tsx      # Grid container
│   │   └── useLayout.ts        # Layout persistence
│   └── styles/
│       ├── tokens.css          # CSS variables
│       └── tokens.ts           # JS color tokens
├── data/
│   └── lima.db                 # SQLite database (created on first run)
└── public/
```

## Common Workflows

### Adding a New Widget

1. Create widget component:

```tsx
// src/widgets/MyWidget/index.tsx
import type { Props } from "../types";

export function MyWidget({ id }: Props) {
    // Widget logic
    return <div>My Widget</div>;
}
```

2. Add to widget registry (if needed)

3. Update grid default layout in `src/grid/useLayout.ts`

### Adding a Backend Endpoint

1. Add Pydantic model in `backend/core/models.py`:

```python
class MyResponse(BaseModel):
    data: str
```

2. Add route in `backend/api/routes.py`:

```python
@router.get("/my-endpoint")
def get_my_data():
    return {"data": "value"}
```

3. Frontend API call:

```typescript
import { apiGet } from "../../data/api";

const data = await apiGet<MyResponse>("/my-endpoint");
```

### Adding a New Data Provider

1. Implement interface in new file (e.g., `backend/core/alpha_vantage.py`):

```python
from .provider import DataProvider

class AlphaVantageProvider(DataProvider):
    def get_price(self, ticker: str) -> tuple[float, int]:
        # Implementation
        pass
```

2. Swap in `backend/main.py`:

```python
provider = AlphaVantageProvider()
```

### Modifying Cache TTLs

Edit `backend/core/config.py`:

```python
PRICE_TTL_SECONDS = 30  # Change from 60 to 30
HISTORY_TTL_SECONDS = 300  # Change from 600 to 300
```

## Testing

### Manual Testing Checklist

#### Backend

- [ ] `/price/{ticker}` returns current price
- [ ] `/history/{ticker}?interval=1d&period=1y` returns candles
- [ ] `/history/{ticker}?since={timestamp}` returns delta
- [ ] `/symbols` returns BIST ticker list
- [ ] Backend survives restart (SQLite persists)

#### Frontend

- [ ] Chart loads and displays data
- [ ] Changing symbol updates chart
- [ ] Changing interval updates chart
- [ ] Zoom/pan persists across polls
- [ ] Intraday intervals poll every 60s
- [ ] Daily intervals poll every 5min
- [ ] Delta poll appends new bars
- [ ] Layout persists after page refresh
- [ ] Symbol dropdown shows full list

### Debug Tools

#### Backend Logs

Uvicorn logs requests to console. Check for:

- Request paths and query params
- Provider calls to yfinance
- Cache hits/misses
- Database operations

#### Frontend DevTools

- **Network tab**: Check API calls, response times, payload sizes
- **Application tab > IndexedDB**: Inspect cached layout/state
- **Console**: Check for errors, warnings

#### SQLite Inspection

```bash
sqlite3 data/lima.db
.tables
SELECT * FROM ohlc WHERE ticker='ASELS.IS' AND interval='1d' LIMIT 10;
SELECT * FROM history_meta;
```

## Troubleshooting

### Backend won't start

- **pandas DLL error**: Lazy imports already implemented in `yahoo.py`
- **Port in use**: Change port in uvicorn command
- **Import errors**: Check `requirements.txt` installed

### Frontend build errors

- **Type errors in StockChart**: Ensure `Time` imported from lightweight-charts
- **Module not found**: Run `npm install`

### Chart not updating

- Check Network tab for `/history` calls with `since` parameter
- Verify `lastBarTimeRef.current` is set after initial load
- Check poll interval is running (60s intraday, 5min daily)

### Symbol list empty

- Check `/symbols` endpoint returns data
- Fallback to `FALLBACK_SYMBOLS` in `backend/core/config.py`
- TradingView scanner may be rate-limited

### Chart zoom resets

- Ensure `chartStateRef` is saved before poll
- Check IndexedDB has `chartState` table
- Verify `setVisibleRange()` called after data update

## Performance Tips

1. **Reduce poll frequency**: Edit `getPollInterval()` in StockChart
2. **Limit history range**: Adjust `YAHOO_MAX_RANGE` in config
3. **Prune old bars**: Add cleanup job to delete bars older than X
4. **Use WebSocket**: Future enhancement for real-time updates
5. **Batch watchlist refresh**: Already done (5min interval)

## Code Style

- **Python**: Follow PEP 8, use type hints
- **TypeScript**: Strict mode, prefer `const`, use interfaces
- **Components**: Functional components with hooks
- **Naming**:
    - Backend: snake_case
    - Frontend: camelCase (files: PascalCase for components)

## Git Workflow (Recommended)

```bash
# Create feature branch
git checkout -b feature/my-feature

# Commit with clear messages
git commit -m "Add delta history polling to StockChart"

# Push and create PR
git push origin feature/my-feature
```

## Deployment (Future)

### Backend

- Package with Docker
- Use PostgreSQL instead of SQLite for production
- Add nginx reverse proxy
- Set `CORS_ORIGINS` to production domain

### Frontend

- `npm run build` generates `dist/`
- Serve static files via nginx or CDN
- Set `VITE_API_BASE` env var to production backend URL

## Related Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture
- [API.md](API.md) - API reference
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Common issues
- [QUICK_REFERENCE.md](QUICK_REFERENCE.md) - Quick tasks

## External Resources

- [FastAPI Docs](https://fastapi.tiangolo.com/)
- [Lightweight Charts Docs](https://tradingview.github.io/lightweight-charts/)
- [yfinance Docs](https://github.com/ranaroussi/yfinance)
- [Preact Docs](https://preactjs.com/)
- [Dexie Docs](https://dexie.org/)

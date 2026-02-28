# Implementation Status

## ✅ Completed (v1.0)

### Backend

#### Core Infrastructure
- [x] FastAPI application with CORS middleware
- [x] Global exception handlers (ValueError, HTTPException, Exception)
- [x] Provider abstraction pattern
- [x] YahooFinanceProvider with lazy imports (Windows DLL fix)
- [x] BIST ticker normalization (.IS suffix)
- [x] SQLite wrapper with thread-safe connection pooling
- [x] TTL in-memory cache for prices (60s)
- [x] SQLite persistent cache for history (max-extent strategy)

#### API Endpoints
- [x] GET /price/{ticker}
- [x] GET /history/{ticker}?interval&period&since
- [x] GET /portfolio
- [x] POST /portfolio
- [x] DELETE /portfolio/{ticker}
- [x] GET /alerts
- [x] POST /alerts
- [x] DELETE /alerts/{id}
- [x] GET /symbols
- [x] POST /watchlist
- [x] GET /watchlist

#### Services
- [x] Price fetching with stale fallback
- [x] History caching with delta refresh
- [x] Portfolio management with PnL calculation
- [x] Alert CRUD operations
- [x] Alert evaluation logic (above/below conditions)
- [x] Watchlist tracking
- [x] Symbol list from TradingView scanner

#### Background Jobs (APScheduler)
- [x] Alert evaluation every 3 minutes
- [x] Watchlist history refresh every 5 minutes

#### Database Schema
- [x] ohlc table (ticker, interval, time composite PK)
- [x] history_meta table (last_refresh tracking)
- [x] portfolio table
- [x] alerts table
- [x] watchlist table
- [x] symbols table

### Frontend

#### Components
- [x] TopBar with title
- [x] SymbolSelect with BIST ticker list
- [x] IntervalSelect with validation
- [x] GridLayout with drag/resize
- [x] StockChart widget

#### StockChart Features
- [x] Lightweight Charts integration
- [x] Symbol and interval selection
- [x] Initial history load
- [x] Delta polling (60s intraday, 5min daily)
- [x] Chart state persistence (zoom/pan)
- [x] Watchlist sync on symbol/interval change
- [x] Error and warning banners
- [x] Loading states

#### Data Layer
- [x] API client (apiGet, apiPost)
- [x] useSymbols hook with 24h cache
- [x] updateWatchlist helper
- [x] Backend history fetching
- [x] Backend symbol list fetching

#### Persistence (IndexedDB)
- [x] Layout table (grid positions)
- [x] widgetState table (symbol + interval per widget)
- [x] chartState table (zoom/pan per widget)
- [x] Auto-migration (v7 schema)

#### Styling
- [x] CSS custom properties (tokens.css)
- [x] Dark theme
- [x] Component-specific styles

---

## 🔨 Pending (v2.0+)

### Frontend Widgets
- [ ] Portfolio widget UI
  - Show positions table
  - Add/edit/delete positions
  - Display PnL summary
  - Real-time price updates
- [ ] Alerts widget UI
  - Show active alerts
  - Create new alerts
  - Delete alerts
  - Visual indicator on trigger

### Enhancements
- [ ] WebSocket streaming for real-time updates
- [ ] NEWS widget (integrate news API)
- [ ] Multi-chart layout presets
- [ ] Drawing tools on charts
- [ ] Technical indicators (moving averages, RSI, MACD)
- [ ] Export data to CSV
- [ ] Share layout via URL/JSON

### Backend Improvements
- [ ] Authentication (API keys)
- [ ] Rate limiting
- [ ] PostgreSQL migration for production
- [ ] Data validation and sanitization
- [ ] Logging to file
- [ ] Prometheus metrics

### Testing
- [ ] Backend unit tests (pytest)
- [ ] Frontend component tests (Testing Library)
- [ ] E2E tests (Playwright)
- [ ] Load testing

### Deployment
- [ ] Docker containerization
- [ ] docker-compose for dev environment
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Production deployment guide

---

## Known Issues

### Fixed
- ✅ Windows pandas DLL policy blocking yfinance import → Lazy imports
- ✅ Infinite re-renders in StockChart → Changed lastBarTime from state to ref
- ✅ Chart zoom reset on poll → Save/restore chartStateRef
- ✅ TypeScript type mismatch (Time vs number) → Updated types to accept `Time`

### Active
- ⚠️ TradingView scanner occasionally rate-limits → Falls back to `FALLBACK_SYMBOLS`
- ⚠️ Yahoo Finance 1m interval limited to 7 days → Document limitation

---

## Version History

### v1.0 (Feb 28, 2026)
- Initial release with core dashboard functionality
- Backend API complete
- StockChart widget with delta polling
- Persistent layout and chart state

### v0.1 (Feb 27, 2026)
- Project scaffolding
- Basic FastAPI backend
- Preact + Vite frontend setup

---

## Feature Requests / Roadmap

### Short-term (1-2 weeks)
1. Portfolio widget UI
2. Alerts widget UI
3. Add backend tests
4. Docker setup

### Mid-term (1-2 months)
1. WebSocket streaming
2. Technical indicators
3. News widget
4. Export functionality

### Long-term (3+ months)
1. ML/AI modules (stock analysis, predictions)
2. Multi-device sync (move layout to backend)
3. Mobile app (React Native)
4. Global market expansion (US, EU stocks)

---

## Contributing

Not yet accepting external contributions. Future: Add CONTRIBUTING.md with guidelines.

---

Last updated: February 28, 2026

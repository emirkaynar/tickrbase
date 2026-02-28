# Troubleshooting Guide

## Backend Issues

### Backend won't start

#### Error: Windows DLL policy blocking pandas

```
ImportError: DLL load failed while importing tzconversion
```

**Fix:** Already implemented - yfinance imports are lazy (inside methods, not at module level).

**Verify fix in:** `backend/core/yahoo.py` - all `import yfinance` statements should be inside method bodies.

---

#### Error: Port already in use

```
ERROR: [Errno 10048] error while attempting to bind on address ('127.0.0.1', 8000)
```

**Fix:** Change port or kill existing process

```bash
# Option 1: Use different port
python -m uvicorn backend.main:app --reload --port 8001

# Option 2: Find and kill process on port 8000
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```

---

#### Error: Module not found

```
ModuleNotFoundError: No module named 'fastapi'
```

**Fix:** Install dependencies

```bash
pip install -r backend/requirements.txt
```

---

#### Error: SQLite database locked

```
sqlite3.OperationalError: database is locked
```

**Fix:** Close other connections to `data/lima.db`

- Close SQLite browser/viewer
- Restart backend
- Check for zombie uvicorn processes

---

### API Errors

#### 502 Bad Gateway on /price or /history

```json
{ "error": true, "message": "Failed to fetch price from provider" }
```

**Cause:** Yahoo Finance downtime or rate limiting

**Fix:**

- Wait and retry (cache will serve stale data)
- Check Yahoo Finance status
- Verify ticker is valid BIST symbol

---

#### Empty symbol list from /symbols

```json
{ "items": [] }
```

**Cause:** TradingView scanner rate limit

**Fix:** Already falls back to `FALLBACK_SYMBOLS` in `backend/core/config.py`. If empty, add symbols manually:

```python
FALLBACK_SYMBOLS = [
    ("Aselsan", "ASELS"),
    ("Türk Hava Yolları", "THYAO"),
    # Add more...
]
```

---

#### History returns no candles

```json
{ "ticker": "ASELS.IS", "interval": "1d", "candles": [], "stale": false }
```

**Cause:** Invalid period/interval combination or no data for ticker

**Fix:**

- Check `YAHOO_MAX_RANGE` in config - 1m interval limited to 7 days
- Verify ticker exists on Yahoo Finance (e.g., https://finance.yahoo.com/quote/ASELS.IS)
- Try different interval

---

## Frontend Issues

### Frontend won't start

#### Error: npm dependency issues

```
npm ERR! peer dependency issues
```

**Fix:**

```bash
rm -rf node_modules package-lock.json
npm install
```

---

#### Error: TypeScript errors

```
TS2322: Type 'number' is not assignable to type 'Time'
```

**Fix:** Already fixed in StockChart/index.tsx. If recurring:

- Ensure `Time` imported from `lightweight-charts`
- Use `chartStateRef: {from: Time, to: Time}` type
- Import and review [src/widgets/StockChart/index.tsx](src/widgets/StockChart/index.tsx)

---

### Chart Issues

#### Chart loads but doesn't update (intraday)

**Symptoms:** Chart shows initial data, but no new bars appear after 60s

**Debug:**

1. Open DevTools Network tab
2. Filter for "history"
3. After 60s, check if request made with `since` parameter

**Fix:**

- Verify `lastBarTimeRef.current` is set after initial load
- Check `getPollInterval()` returns 60000 for intraday intervals
- Ensure useEffect cleanup doesn't cancel timer immediately

**Code check:** [src/widgets/StockChart/index.tsx](src/widgets/StockChart/index.tsx)

```typescript
// Should see this after initial load:
lastBarTimeRef.current = bars[bars.length - 1].time;

// Poll should call:
fetch(
    `/history/${symbol}?interval=${interval}&period=${period}&since=${lastBarTimeRef.current}`,
);
```

---

#### Chart zoom resets on every poll

**Symptoms:** Chart jumps back to full view every 60s

**Debug:**
Check IndexedDB Application tab → chartState table for entries

**Fix:**

- Ensure `saveChartState()` called before poll
- Verify `applyBars()` uses `update()` not `setData()` for non-fit updates
- Check `chartStateRef.current` is restored after data update

**Code check:**

```typescript
// Before poll
await saveChartState();

// After data update (if not initial fit)
if (chartStateRef.current && series) {
    series.setVisibleRange(chartStateRef.current);
}
```

---

#### Chart shows wrong symbol

**Symptoms:** Selected symbol in dropdown doesn't match chart data

**Debug:**

1. Check IndexedDB → widgetState table
2. Verify `widget_id` matches widget's `id` prop

**Fix:**

- Clear IndexedDB (Application tab → IndexedDB → lima → widgetState → Clear)
- Refresh page
- Select symbol again

---

#### Symbol dropdown is empty

**Symptoms:** SymbolSelect shows "Loading..." forever

**Debug:**

1. Network tab → Check /symbols response
2. Console → Check for errors in useSymbols hook

**Fix:**

- Verify backend is running on localhost:8000
- Check `/symbols` endpoint returns data
- Clear module-level cache: Restart frontend dev server

---

#### Chart renders but no candles visible

**Symptoms:** Chart container visible, but no candlesticks

**Possible causes:**

1. **Empty data**: Backend returned no candles
2. **Wrong time format**: Bars have invalid time field
3. **Canvas sizing**: Chart container has 0 height

**Debug:**

```typescript
// Check bars in console
console.log("Bars:", bars);
// Should see array of {time: number, open: number, ...}
```

**Fix:**

- Verify bars have numeric `time` field (Unix seconds)
- Check chart container has explicit height in CSS
- Ensure `series.setData(bars)` called after `addCandlestickSeries()`

---

### IndexedDB Issues

#### Layout not persisting

**Symptoms:** Widget positions reset after page refresh

**Fix:**

1. Check IndexedDB → lima → layout table has entries
2. Clear cache and reload: Hard refresh (Ctrl+Shift+R)
3. Re-arrange widgets and wait 500ms for debounced save

**Code check:**

```typescript
// In useLayout.ts
db.layout.put({ id: "main", items: layouts });
```

---

#### Widget state not restoring

**Symptoms:** Chart shows default symbol instead of last selected

**Fix:**

1. Check IndexedDB → lima → widgetState for entries
2. Verify widget `id` prop is consistent (not random)
3. Clear widgetState table and re-select symbols

---

## Network Issues

### CORS errors in console

```
Access to fetch at 'http://127.0.0.1:8000/history/ASELS' from origin 'http://localhost:5173' has been blocked by CORS policy
```

**Fix:** Backend CORS already configured for localhost:5173. If still occurs:

1. **Check backend CORS config** in `backend/main.py`:

```python
CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
```

2. **Match URLs exactly:** Use either localhost or 127.0.0.1 consistently

3. **Restart backend:** Changes to CORS config require restart

---

### API requests timeout

**Symptoms:** Requests to backend take >30s, eventually fail

**Cause:** Backend busy fetching from Yahoo Finance, or Yahoo is slow

**Fix:**

- Check backend logs for provider call duration
- Increase timeout in frontend (currently handled by browser default)
- Consider caching more aggressively

---

## Performance Issues

### Chart feels sluggish on pan/zoom

**Cause:** Too many candles loaded (e.g., 1m interval for max period)

**Fix:** Reduce period for intraday intervals

```typescript
// In StockChart, limit period based on interval
const maxPeriod = interval.includes("m") ? "7d" : "1y";
```

---

### Backend slow to respond

**Check:**

1. Database size: `ls -lh data/lima.db` (should be < 100MB for normal use)
2. Number of candles: `sqlite3 data/lima.db "SELECT COUNT(*) FROM ohlc;"`

**Fix:**

- Prune old candles (add cleanup job)
- Reduce watchlist size
- Use daily interval for long-term data

---

### High memory usage

**Backend:**

- Check `price_cache` size (should be < 1000 entries)
- Restart uvicorn to clear in-memory cache

**Frontend:**

- Clear IndexedDB (Application tab → Clear storage)
- Close unused browser tabs
- Reload page

---

## Data Quality Issues

### Candles have gaps

**Cause:** Market closed (weekends, holidays) or Yahoo Finance missing data

**Expected behavior:** No candles on non-trading days

**Not an error**

---

### Intraday candles stop updating after market close

**Cause:** Market closed, Yahoo Finance returns no new data

**Expected behavior:** Delta fetch returns empty array

**Not an error**

---

### Price different from external source

**Cause:** Yahoo Finance data delayed (free tier = 15min delay for some exchanges)

**Fix:** Accept delay or use premium data provider (future enhancement)

---

## Development Tools

### Inspect SQLite database

```bash
sqlite3 data/lima.db

# List tables
.tables

# Show schema
.schema ohlc

# Query data
SELECT ticker, interval, COUNT(*) FROM ohlc GROUP BY ticker, interval;
SELECT * FROM history_meta;
SELECT * FROM portfolio;
SELECT * FROM alerts;
```

### Clear backend cache

```bash
# Delete database
rm data/lima.db

# Restart backend (will recreate schema)
python -m uvicorn backend.main:app --reload
```

### Clear frontend cache

**DevTools → Application tab:**

- IndexedDB → lima → Delete database
- Storage → Clear site data

### Monitor API calls

**DevTools → Network tab:**

- Filter: `history|price|symbols`
- Check response times, payload sizes
- Look for 4xx/5xx errors

### Check logs

**Backend:**
Uvicorn logs to stdout (terminal running backend)

**Frontend:**
Browser DevTools → Console tab

---

## Getting Help

1. **Check documentation:**
    - [README.md](../README.md) - Quick start
    - [ARCHITECTURE.md](ARCHITECTURE.md) - System design
    - [API.md](API.md) - API reference
    - [DEVELOPMENT.md](DEVELOPMENT.md) - Dev workflows

2. **Search issues:** (When GitHub setup)
    - Check closed issues for similar problems
    - Open new issue with error logs and steps to reproduce

3. **Debug locally:**
    - Enable verbose logging
    - Use DevTools heavily
    - Isolate problem (backend vs frontend)

---

## Quick Fixes Summary

| Issue                | Quick Fix                                                                         |
| -------------------- | --------------------------------------------------------------------------------- |
| Backend won't start  | Check port, verify dependencies, review error logs                                |
| Frontend won't start | `npm install`, check Node version                                                 |
| API returns 502      | Wait for Yahoo Finance, check cache                                               |
| Chart doesn't update | Verify `lastBarTimeRef` set, check Network tab                                    |
| Chart zoom resets    | Check `chartStateRef` save/restore                                                |
| Symbol list empty    | Check /symbols endpoint, verify fallback symbols                                  |
| CORS error           | Match frontend/backend URLs exactly                                               |
| Database locked      | Close SQLite viewers, restart backend                                             |
| High memory          | Restart services, clear caches                                                    |
| TypeScript errors    | Review [src/widgets/StockChart/index.tsx](src/widgets/StockChart/index.tsx) types |

---

Last updated: February 28, 2026

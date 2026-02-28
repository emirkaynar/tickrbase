# Database Schema Documentation

## SQLite Backend Database

Location: `data/lima.db`

Created by: `backend/core/db.py:init_db()`

---

## Tables

### ohlc

Stores OHLCV (Open, High, Low, Close, Volume) candlestick data.

**Composite Primary Key:** (ticker, interval, time)

| Column | Type | Description |
|--------|------|-------------|
| ticker | TEXT | Stock ticker with .IS suffix (e.g., "ASELS.IS") |
| interval | TEXT | Bar interval: "1m", "5m", "15m", "30m", "1h", "1d", "1wk", "1mo" |
| time | INTEGER | Unix timestamp (seconds) of bar open time |
| open | REAL | Opening price |
| high | REAL | Highest price in bar |
| low | REAL | Lowest price in bar |
| close | REAL | Closing price |
| volume | INTEGER | Trading volume |

**Indexes:**
- PRIMARY KEY (ticker, interval, time)

**Example:**
```sql
INSERT INTO ohlc VALUES ('ASELS.IS', '1d', 1708876800, 88.5, 90.2, 88.0, 89.45, 12500000);
```

**Usage:**
- Max-extent cache: stores full history per ticker+interval
- Append-only: new bars added as they arrive
- Delta queries: `WHERE ticker=? AND interval=? AND time > ?`

---

### history_meta

Tracks last refresh timestamp for each ticker+interval pair.

**Composite Primary Key:** (ticker, interval)

| Column | Type | Description |
|--------|------|-------------|
| ticker | TEXT | Stock ticker with .IS suffix |
| interval | TEXT | Bar interval |
| last_refresh | INTEGER | Unix timestamp of last successful fetch from provider |

**Example:**
```sql
INSERT INTO history_meta VALUES ('ASELS.IS', '1d', 1708876543);
```

**Usage:**
- Determine if cache is stale (compare to current time - TTL)
- Calculate delta fetch start time (last_refresh - padding)

---

### portfolio

Stores user's stock positions.

**Primary Key:** id (autoincrement)

**Unique Constraint:** ticker

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-incrementing primary key |
| ticker | TEXT | Stock ticker (UNIQUE) |
| quantity | REAL | Number of shares owned |
| avg_price | REAL | Average purchase price per share |
| created_at | INTEGER | Unix timestamp of position creation |

**Example:**
```sql
INSERT INTO portfolio (ticker, quantity, avg_price, created_at) 
VALUES ('ASELS.IS', 100, 85.0, 1708876543);
```

**Business Logic:**
- PnL calculated on-the-fly: `(current_price - avg_price) * quantity`
- PnL percent: `((current_price / avg_price) - 1) * 100`
- Update position: recalculate avg_price if adding more shares

---

### alerts

Stores price alerts with trigger conditions.

**Primary Key:** id (autoincrement)

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-incrementing primary key |
| ticker | TEXT | Stock ticker |
| condition | TEXT | "above" or "below" |
| threshold | REAL | Price threshold for trigger |
| active | INTEGER | 1 if active, 0 if disabled (BOOLEAN) |
| created_at | INTEGER | Unix timestamp of alert creation |
| last_triggered_at | INTEGER | Unix timestamp of last trigger (NULL if never triggered) |

**Example:**
```sql
INSERT INTO alerts (ticker, condition, threshold, active, created_at, last_triggered_at)
VALUES ('ASELS.IS', 'above', 90.0, 1, 1708876543, NULL);
```

**Trigger Logic:**
- `condition='above'`: Trigger if price > threshold
- `condition='below'`: Trigger if price < threshold
- Once triggered, update `last_triggered_at` to prevent repeated triggers
- Reset `last_triggered_at = NULL` to re-enable

---

### watchlist

Tracks ticker+interval pairs to refresh in background.

**Composite Primary Key:** (ticker, interval)

| Column | Type | Description |
|--------|------|-------------|
| ticker | TEXT | Stock ticker |
| interval | TEXT | Bar interval |
| last_seen | INTEGER | Unix timestamp of last frontend access |

**Example:**
```sql
INSERT INTO watchlist VALUES ('ASELS.IS', '1d', 1708876543);
```

**Usage:**
- Background scheduler fetches history for all watchlist items every 5 minutes
- Prune old entries (e.g., not seen in 7 days) to reduce load
- Updated via POST /watchlist endpoint

---

### symbols

Caches BIST symbol list from TradingView scanner.

**Primary Key:** id (always "bist" for single-market v1)

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Market identifier (currently hardcoded "bist") |
| payload | TEXT | JSON-serialized array of {label, value} pairs |
| fetched_at | INTEGER | Unix timestamp of last fetch |

**Example:**
```sql
INSERT INTO symbols VALUES (
    'bist',
    '[{"label": "Aselsan", "value": "ASELS.IS"}, {"label": "Türk Hava Yolları", "value": "THYAO.IS"}]',
    1708876543
);
```

**Usage:**
- TTL: 24 hours
- Falls back to `FALLBACK_SYMBOLS` in config if fetch fails
- Single row upserted on each refresh

---

## Indexes

### Primary Key Indexes (auto-created)
- `ohlc(ticker, interval, time)` - Composite PK for fast time-series queries
- `history_meta(ticker, interval)` - Composite PK for metadata lookups
- `portfolio(id)` - Single-column PK with UNIQUE constraint on ticker
- `alerts(id)` - Single-column PK
- `watchlist(ticker, interval)` - Composite PK
- `symbols(id)` - Single-column PK

### Additional Indexes (recommended for production)
```sql
-- Speed up delta queries
CREATE INDEX idx_ohlc_ticker_interval ON ohlc(ticker, interval);

-- Speed up active alert queries
CREATE INDEX idx_alerts_active ON alerts(active) WHERE active = 1;

-- Speed up portfolio lookups by ticker
CREATE INDEX idx_portfolio_ticker ON portfolio(ticker);
```

---

## Schema Migrations

### Current Version: 1 (initial)

**Migration Strategy (future):**
- Add `schema_version` table to track migrations
- Use Alembic or custom migration scripts
- Never delete columns (add nullable, deprecate old)

**Example future migration:**
```sql
-- Add timezone support to ohlc
ALTER TABLE ohlc ADD COLUMN timezone TEXT DEFAULT 'UTC';
```

---

## Data Lifecycle

### ohlc Table
1. **Insert:** On first history fetch, insert all candles from Yahoo Finance
2. **Update:** On delta fetch, insert only new candles (time > last known)
3. **Cleanup:** (Future) Delete candles older than X days/years to limit size

### history_meta Table
1. **Insert:** After first successful history fetch
2. **Update:** After each successful delta fetch (update last_refresh)

### portfolio Table
1. **Insert:** User adds position via POST /portfolio
2. **Update:** User modifies quantity (PnL recalculated on read)
3. **Delete:** User removes position via DELETE /portfolio/{ticker}

### alerts Table
1. **Insert:** User creates alert via POST /alerts
2. **Update:** Background job updates last_triggered_at when condition met
3. **Delete:** User cancels alert via DELETE /alerts/{id}

### watchlist Table
1. **Insert:** Frontend syncs watchlist via POST /watchlist
2. **Update:** Upsert last_seen on each sync
3. **Cleanup:** (Future) Delete entries not seen in 7 days

### symbols Table
1. **Insert:** On first /symbols request
2. **Update:** Upsert payload every 24 hours
3. **Fallback:** If fetch fails, keep stale data (don't delete)

---

## Query Patterns

### Fetch full history
```sql
SELECT time, open, high, low, close, volume
FROM ohlc
WHERE ticker = 'ASELS.IS' AND interval = '1d'
ORDER BY time ASC;
```

### Fetch delta history (since timestamp)
```sql
SELECT time, open, high, low, close, volume
FROM ohlc
WHERE ticker = 'ASELS.IS' AND interval = '1d' AND time > 1708876543
ORDER BY time ASC;
```

### Check if history is stale
```sql
SELECT last_refresh
FROM history_meta
WHERE ticker = 'ASELS.IS' AND interval = '1d';
-- Compare (current_time - last_refresh) > HISTORY_TTL_SECONDS
```

### Get latest bar time
```sql
SELECT MAX(time) as latest_time
FROM ohlc
WHERE ticker = 'ASELS.IS' AND interval = '1d';
```

### Get portfolio with PnL (requires price lookup)
```sql
-- Step 1: Get positions
SELECT id, ticker, quantity, avg_price FROM portfolio;

-- Step 2: Fetch current prices (done in Python)
-- Step 3: Calculate PnL (done in Python)
```

### Get active alerts to evaluate
```sql
SELECT id, ticker, condition, threshold
FROM alerts
WHERE active = 1;
```

### Get watchlist items to refresh
```sql
SELECT ticker, interval FROM watchlist;
```

---

## Backup & Restore

### Backup
```bash
cp data/lima.db data/lima_backup_$(date +%Y%m%d).db
```

### Restore
```bash
cp data/lima_backup_20260228.db data/lima.db
```

### Export to SQL
```bash
sqlite3 data/lima.db .dump > backup.sql
```

### Import from SQL
```bash
sqlite3 data/lima.db < backup.sql
```

---

## Database Size Estimates

| Data Type | Size per Entry | 1 Year Estimate |
|-----------|---------------|-----------------|
| 1d candle | ~60 bytes | 21 KB per ticker |
| 1h candle | ~60 bytes | 525 KB per ticker |
| 1m candle | ~60 bytes | 22 MB per ticker (7 day rolling) |
| Portfolio position | ~100 bytes | <1 KB total |
| Alert | ~150 bytes | <10 KB total |
| Symbols list | ~50 KB | 50 KB (cached) |

**Expected DB size after 1 year:**
- 10 tickers × 21 KB (daily) = 210 KB
- 5 tickers × 525 KB (hourly) = 2.6 MB
- 3 tickers × 22 MB (1min, 7d rolling) = 66 MB
- **Total:** ~70 MB

---

## Thread Safety

**SQLite write concurrency:** Single writer at a time

**Our strategy:**
- Connection pooling in `db.py` with `check_same_thread=False`
- WAL mode for better concurrency (Write-Ahead Logging)
- Short-lived transactions (immediate commit)

**Conflicts handled by:**
- Retry on `SQLITE_BUSY` error
- Queue writes in background scheduler

---

## Frontend IndexedDB

Separate from backend SQLite. Stores UI state only.

**Tables (Dexie):**
- `layout` - Grid layout positions
- `widgetState` - Symbol + interval per widget
- `chartState` - Zoom/pan per widget

**Schema version:** 7

See [src/db/index.ts](src/db/index.ts) for details.

---

Last updated: February 28, 2026

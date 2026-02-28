# API Reference

Base URL: `http://127.0.0.1:8000` (development)

All responses are JSON with consistent error envelope:
```json
{"error": true, "message": "error description"}
```

---

## Price Endpoints

### GET /price/{ticker}

Get current price for a ticker.

**Parameters:**
- `ticker` (path): Stock ticker (auto-normalized to .IS for BIST)

**Response:**
```json
{
  "ticker": "ASELS.IS",
  "current_price": 89.45,
  "timestamp": 1708876543,
  "stale": false,
  "last_updated": 1708876543
}
```

**Fields:**
- `stale` (bool): True if from cache and update failed
- `last_updated` (int): Unix timestamp of last successful fetch

**Status Codes:**
- `200`: Success
- `502`: Provider error
- `500`: Internal error

**Example:**
```bash
curl http://127.0.0.1:8000/price/ASELS
```

---

## History Endpoints

### GET /history/{ticker}

Get OHLCV candles for a ticker.

**Parameters:**
- `ticker` (path): Stock ticker
- `interval` (query, required): Bar interval
  - Valid: `1m`, `5m`, `15m`, `30m`, `1h`, `1d`, `1wk`, `1mo`
- `period` (query, optional): Time period
  - Valid: `1d`, `5d`, `1mo`, `3mo`, `6mo`, `1y`, `2y`, `5y`, `10y`, `ytd`, `max`
  - Default: `1y`
- `since` (query, optional): Unix timestamp - only return bars after this time

**Response:**
```json
{
  "ticker": "ASELS.IS",
  "interval": "1d",
  "candles": [
    {
      "time": 1708876800,
      "open": 88.5,
      "high": 90.2,
      "low": 88.0,
      "close": 89.45,
      "volume": 12500000
    }
  ],
  "stale": false,
  "last_updated": 1708876543
}
```

**Interval Rules:**
- `1m`, `5m`, `15m`, `30m`, `1h`: Max 7 days history
- `1d`: Unlimited history (max ~20 years)
- `1wk`, `1mo`: Unlimited history

**Delta Fetch (since parameter):**
When `since` is provided, returns only candles with `time > since`. Use for incremental updates:

```bash
# Initial load
curl "http://127.0.0.1:8000/history/ASELS?interval=1d&period=1y"

# Delta update (only new bars since timestamp)
curl "http://127.0.0.1:8000/history/ASELS?interval=1d&period=1y&since=1708876800"
```

**Status Codes:**
- `200`: Success (even if stale)
- `400`: Invalid interval/period
- `502`: Provider error (no cache available)
- `500`: Internal error

---

## Portfolio Endpoints

### GET /portfolio

List all positions with current prices and PnL.

**Response:**
```json
{
  "positions": [
    {
      "ticker": "ASELS.IS",
      "quantity": 100,
      "avg_price": 85.0,
      "current_price": 89.45,
      "pnl": 445.0,
      "pnl_percent": 5.23,
      "total_value": 8945.0,
      "cost_basis": 8500.0
    }
  ],
  "summary": {
    "total_value": 8945.0,
    "total_cost": 8500.0,
    "total_pnl": 445.0,
    "total_pnl_percent": 5.23
  }
}
```

**Status Codes:**
- `200`: Success (empty if no positions)

---

### POST /portfolio

Add or update a position.

**Request Body:**
```json
{
  "ticker": "ASELS",
  "quantity": 100,
  "avg_price": 85.0
}
```

**Response:**
```json
{
  "id": 1,
  "ticker": "ASELS.IS",
  "quantity": 100,
  "avg_price": 85.0,
  "created_at": 1708876543
}
```

**Behavior:**
- If ticker exists: Updates quantity and recalculates avg_price
- If ticker new: Creates new position

**Status Codes:**
- `200`: Success
- `400`: Invalid request body

---

### DELETE /portfolio/{ticker}

Remove a position.

**Parameters:**
- `ticker` (path): Stock ticker

**Response:**
```json
{"ok": true, "deleted": "ASELS.IS"}
```

**Status Codes:**
- `200`: Success
- `404`: Position not found

---

## Alert Endpoints

### GET /alerts

List all alerts.

**Response:**
```json
{
  "alerts": [
    {
      "id": 1,
      "ticker": "ASELS.IS",
      "condition": "above",
      "threshold": 90.0,
      "active": true,
      "created_at": 1708876543,
      "last_triggered_at": null
    }
  ]
}
```

**Conditions:**
- `above`: Trigger when price > threshold
- `below`: Trigger when price < threshold

**Status Codes:**
- `200`: Success

---

### POST /alerts

Create a new alert.

**Request Body:**
```json
{
  "ticker": "ASELS",
  "condition": "above",
  "threshold": 90.0
}
```

**Response:**
```json
{
  "id": 1,
  "ticker": "ASELS.IS",
  "condition": "above",
  "threshold": 90.0,
  "active": true,
  "created_at": 1708876543,
  "last_triggered_at": null
}
```

**Status Codes:**
- `200`: Success
- `400`: Invalid condition or threshold

---

### DELETE /alerts/{id}

Delete an alert.

**Parameters:**
- `id` (path): Alert ID

**Response:**
```json
{"ok": true, "deleted_id": 1}
```

**Status Codes:**
- `200`: Success
- `404`: Alert not found

---

## Symbols Endpoints

### GET /symbols

Get list of all BIST symbols.

**Response:**
```json
{
  "items": [
    {"label": "Aselsan", "value": "ASELS.IS"},
    {"label": "Türk Hava Yolları", "value": "THYAO.IS"}
  ],
  "stale": false,
  "fetched_at": 1708876543
}
```

**Behavior:**
- Data cached in SQLite for 24 hours
- Falls back to hardcoded list if TradingView scanner fails
- Updates cache on first call if stale

**Status Codes:**
- `200`: Success

---

## Watchlist Endpoints

### POST /watchlist

Update watchlist (replaces existing).

**Request Body:**
```json
{
  "items": [
    {"ticker": "ASELS", "interval": "1d"},
    {"ticker": "THYAO", "interval": "1h"}
  ]
}
```

**Response:**
```json
{"ok": true, "updated": 2}
```

**Behavior:**
- Marks all ticker+interval pairs as watched
- Background scheduler refreshes their history every 5 minutes

**Status Codes:**
- `200`: Success
- `400`: Invalid items array

---

### GET /watchlist

Get current watchlist.

**Response:**
```json
{
  "items": [
    {
      "ticker": "ASELS.IS",
      "interval": "1d",
      "last_seen": 1708876543
    }
  ]
}
```

**Status Codes:**
- `200`: Success

---

## Caching Behavior

### Price Cache
- **TTL**: 60 seconds in-memory
- **Fallback**: Returns stale price if provider fails

### History Cache
- **Storage**: SQLite (persistent across restarts)
- **Strategy**: Max-extent cache per ticker+interval
- **Refresh**: Delta fetch from `last_refresh - padding` to now
- **TTL**: 10 minutes (metadata check)
- **Fallback**: Returns stale history if provider fails

### Symbol Cache
- **Storage**: SQLite
- **TTL**: 24 hours
- **Fallback**: Hardcoded `FALLBACK_SYMBOLS` list

---

## Error Responses

All errors follow this structure:

```json
{
  "error": true,
  "message": "Descriptive error message"
}
```

### Common Error Codes

**400 Bad Request**
```json
{"error": true, "message": "Invalid interval 'invalid'"}
```

**404 Not Found**
```json
{"error": true, "message": "Position ASELS.IS not found"}
```

**502 Bad Gateway** (Provider failure)
```json
{"error": true, "message": "Failed to fetch price from provider"}
```

**500 Internal Server Error**
```json
{"error": true, "message": "Database error: ..."}
```

---

## Rate Limits

**Current (v1):** None - single-user local app

**Future (v2):**
- Price: 100 req/min per IP
- History: 50 req/min per IP
- POST endpoints: 10 req/min per IP

---

## CORS

Allowed origins:
- `http://localhost:5173`
- `http://127.0.0.1:5173`

All origins allowed in development. Restrict in production.

---

## Background Jobs

### Alert Evaluation (Every 3 minutes)
- Fetches prices for all active alerts
- Triggers alert if condition met
- Updates `last_triggered_at` timestamp
- Only triggers once per condition (until reset)

### Watchlist Refresh (Every 5 minutes)
- Fetches history for all watched ticker+interval pairs
- Updates SQLite cache
- Silently fails if provider down (keeps stale cache)

---

## Normalization Rules

All BIST tickers automatically get `.IS` suffix:
```
ASELS → ASELS.IS
THYAO → THYAO.IS
```

Applied in `backend/core/yahoo.py:normalize_ticker()` before any provider call.

# Quick Reference: Common Modifications

This guide maps common tasks to the specific files you need to modify.

---

## Adding a New Widget

### 1. Create Widget Component
**File:** `src/widgets/YourWidget/index.tsx`

```tsx
import type { Props } from "../types";

export function YourWidget({ id }: Props) {
    return (
        <div className="widget">
            <h2>Your Widget</h2>
            {/* Widget content */}
        </div>
    );
}
```

### 2. Update Widget Registry
No explicit registry needed - just import in GridLayout.

### 3. Add to Grid
**File:** `src/grid/GridLayout.tsx`

Add widget instance to JSX.

### 4. Default Layout (Optional)
**File:** `src/grid/useLayout.ts`

Update `defaultLayouts` array.

---

## Adding a Backend Endpoint

### 1. Define Pydantic Models
**File:** `backend/core/models.py`

```python
class MyRequest(BaseModel):
    field: str

class MyResponse(BaseModel):
    data: str
```

### 2. Add Route
**File:** `backend/api/routes.py`

```python
@router.post("/my-endpoint")
def my_endpoint(req: MyRequest):
    # Logic here
    return MyResponse(data="value")
```

---

## Adding a New Interval

### 1. Update Config
**File:** `backend/core/config.py`

Add to `YAHOO_MAX_RANGE`:
```python
YAHOO_MAX_RANGE = {
    # ... existing ...
    "2h": "60d",  # New interval
}
```

Add to `INTERVAL_SECONDS`:
```python
INTERVAL_SECONDS = {
    # ... existing ...
    "2h": 7200,  # New interval
}
```

### 2. Update Frontend Type
**File:** `src/data/types.ts`

```typescript
export type Interval = "1m" | "5m" | "15m" | "30m" | "1h" | "2h" | "1d" | "1wk" | "1mo";
```

### 3. Add to IntervalSelect
**File:** `src/components/IntervalSelect/IntervalSelect.tsx`

Add option to intervals array.

---

## Changing Cache TTLs

**File:** `backend/core/config.py`

```python
PRICE_TTL_SECONDS = 60      # Change price cache TTL
HISTORY_TTL_SECONDS = 600   # Change history cache TTL
```

---

## Changing Poll Intervals

**File:** `src/widgets/StockChart/index.tsx`

Update `getPollInterval()`:
```typescript
function getPollInterval(interval: Interval): number {
    if (["1m", "5m", "15m"].includes(interval)) {
        return 60_000;  // 1 minute → Change this
    }
    return 300_000;  // 5 minutes → Change this
}
```

---

## Changing Background Job Schedules

**File:** `backend/scheduler.py`

```python
scheduler.add_job(
    run_alert_cycle,
    "interval",
    seconds=180,  # Change alert evaluation frequency
    id="alert_cycle",
)

scheduler.add_job(
    refresh_watched_history,
    "interval",
    seconds=300,  # Change watchlist refresh frequency
    id="watchlist_refresh",
)
```

---

## Adding a New Data Provider

### 1. Implement Provider Interface
**File:** `backend/core/your_provider.py`

```python
from .provider import DataProvider

class YourProvider(DataProvider):
    def get_price(self, ticker: str) -> tuple[float, int]:
        # Implementation
        pass
    
    def get_history(self, ticker: str, interval: str, period: str = None, start: int = None, end: int = None) -> list:
        # Implementation
        pass
    
    def get_company_info(self, ticker: str) -> dict:
        # Implementation
        pass
```

### 2. Swap Provider
**File:** `backend/main.py`

```python
from backend.core.your_provider import YourProvider

provider = YourProvider()  # Replace YahooFinanceProvider()
```

### 3. Update Ticker Normalization (if needed)
Modify `normalize_ticker()` in your provider class.

---

## Adding a Database Table

### 1. Define Schema
**File:** `backend/core/db.py`

Add CREATE TABLE in `init_db()`:
```python
cursor.execute("""
    CREATE TABLE IF NOT EXISTS my_table (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        field TEXT NOT NULL
    )
""")
```

### 2. Add Service Functions
**File:** `backend/services/my_service.py`

```python
def get_items(db_path: str):
    conn = get_connection(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM my_table")
    return cursor.fetchall()
```

### 3. Add API Route
**File:** `backend/api/routes.py`

```python
@router.get("/my-items")
def get_my_items():
    items = my_service.get_items(DB_PATH)
    return {"items": items}
```

---

## Modifying Chart Appearance

### 1. Chart Options
**File:** `src/widgets/StockChart/index.tsx`

Update `createChart()` options:
```typescript
const chart = createChart(chartRef.current, {
    layout: { 
        background: { color: tokens.bg },
        textColor: tokens.text,
    },
    grid: {
        vertLines: { color: tokens.border },
        horzLines: { color: tokens.border },
    },
    // ... more options
});
```

### 2. Candlestick Style
**File:** `src/widgets/StockChart/index.tsx`

Update `addCandlestickSeries()` options:
```typescript
const series = chart.addCandlestickSeries({
    upColor: tokens.green,
    downColor: tokens.red,
    borderUpColor: tokens.green,
    borderDownColor: tokens.red,
    wickUpColor: tokens.green,
    wickDownColor: tokens.red,
});
```

### 3. CSS Styling
**File:** `src/widgets/StockChart/StockChart.css`

Update widget container styles.

---

## Adding a Color Token

### 1. Define CSS Variable
**File:** `src/styles/tokens.css`

```css
:root {
    --color-my-color: #ff0000;
}
```

### 2. Add JS Mirror
**File:** `src/styles/tokens.ts`

```typescript
export const tokens = {
    // ... existing ...
    myColor: "#ff0000",
} as const;
```

### 3. Use in Components
```tsx
import { tokens } from "../../styles/tokens";

<div style={{ color: tokens.myColor }}>Text</div>
```

---

## Error Handling

### Backend Error Response
**File:** `backend/api/routes.py`

```python
from fastapi import HTTPException

@router.get("/endpoint")
def endpoint():
    if error_condition:
        raise HTTPException(status_code=400, detail="Error message")
    return {"data": "value"}
```

### Frontend Error Handling
**File:** `src/data/api.ts`

Already implements error handling in `apiGet()` and `apiPost()`.

**Usage in components:**
```typescript
try {
    const data = await apiGet<Response>("/endpoint");
    // Success
} catch (error) {
    console.error(error);
    setStatus("error");
}
```

---

## Adding Frontend State Persistence

**File:** `src/db/index.ts`

### 1. Define Table
```typescript
export interface MyStateRecord {
    widget_id: string;
    myField: string;
}

export class AppDatabase extends Dexie {
    // ... existing tables ...
    myState!: Dexie.Table<MyStateRecord, string>;

    constructor() {
        super("lima");
        this.version(8).stores({  // Increment version
            // ... existing tables ...
            myState: "widget_id",
        });
    }
}
```

### 2. Use in Component
```typescript
import { db } from "../../db";

// Save
await db.myState.put({ widget_id: id, myField: "value" });

// Load
const state = await db.myState.get(id);
```

---

## Testing APIs Manually

### Using curl
```bash
# GET request
curl http://127.0.0.1:8000/price/ASELS

# POST request
curl -X POST http://127.0.0.1:8000/alerts \
  -H "Content-Type: application/json" \
  -d '{"ticker": "ASELS", "condition": "above", "threshold": 90.0}'

# DELETE request
curl -X DELETE http://127.0.0.1:8000/alerts/1
```

### Using Python
```python
import requests

# GET
response = requests.get("http://127.0.0.1:8000/price/ASELS")
print(response.json())

# POST
response = requests.post(
    "http://127.0.0.1:8000/alerts",
    json={"ticker": "ASELS", "condition": "above", "threshold": 90.0}
)
print(response.json())
```

---

## Debugging

### Backend Logging
**File:** Any backend file

```python
import logging

logger = logging.getLogger(__name__)
logger.info("Debug message")
logger.error("Error message")
```

### Frontend Console Logging
**File:** Any frontend file

```typescript
console.log("Debug:", data);
console.error("Error:", error);
console.table(array);  // Pretty print arrays
```

### SQLite Inspection
```bash
# Open database
sqlite3 data/lima.db

# Show tables
.tables

# Query
SELECT * FROM ohlc LIMIT 10;

# Schema
.schema ohlc
```

---

## File Hotspots (Most Frequently Modified)

### Backend
1. `backend/api/routes.py` - Adding/modifying endpoints
2. `backend/core/config.py` - Changing settings
3. `backend/services/*.py` - Business logic
4. `backend/core/yahoo.py` - Provider modifications

### Frontend
1. `src/widgets/StockChart/index.tsx` - Chart modifications
2. `src/data/api.ts` - API client changes
3. `src/grid/GridLayout.tsx` - Layout management
4. `src/db/index.ts` - Persistence schema

---

## Configuration Files

| File | Purpose |
|------|---------|
| `backend/core/config.py` | Backend settings (TTLs, intervals, CORS) |
| `vite.config.ts` | Frontend build config |
| `tsconfig.json` | TypeScript compiler options |
| `package.json` | Frontend dependencies |
| `backend/requirements.txt` | Backend dependencies |

---

## Key Patterns

### Backend Service Pattern
```python
# backend/services/my_service.py
from backend.core.db import get_connection
from backend.core.provider import DataProvider

def do_something(provider: DataProvider, db_path: str, ticker: str):
    # Fetch from provider
    data = provider.get_price(ticker)
    
    # Store in DB
    conn = get_connection(db_path)
    cursor = conn.cursor()
    cursor.execute("INSERT INTO table VALUES (?)", (data,))
    conn.commit()
    
    return data
```

### Frontend Widget Pattern
```tsx
// src/widgets/MyWidget/index.tsx
import { useEffect, useState } from "preact/hooks";
import type { Props } from "../types";
import { apiGet } from "../../data/api";

export function MyWidget({ id }: Props) {
    const [data, setData] = useState(null);
    const [status, setStatus] = useState<"loading" | "success" | "error">("loading");

    useEffect(() => {
        async function load() {
            try {
                const result = await apiGet("/endpoint");
                setData(result);
                setStatus("success");
            } catch (error) {
                console.error(error);
                setStatus("error");
            }
        }
        load();
    }, []);

    if (status === "loading") return <div>Loading...</div>;
    if (status === "error") return <div>Error</div>;

    return <div>{JSON.stringify(data)}</div>;
}
```

---

Last updated: February 28, 2026

# Market resource budgets

The deployment currently supports one API worker. At hub startup Redis atomically
reserves `stream:upstream-owner` for 30 seconds. A second worker fails startup.
The owner renews every five seconds using compare-and-expire; failure stops its
upstream and closes clients. Shutdown stops delivery before compare-and-delete.
A crashed owner may delay restart for up to 30 seconds. Horizontal scaling needs
a separate upstream stream worker and shared delivery/quotas before enabling
multiple API workers; local miss coalescing is not a cross-worker lock.

## Failure behavior

Price, quote, lookup, overview, symbol and market-metadata Redis reads/writes are
optional: one-second operation deadlines degrade to bounded provider work. A
successful upstream result survives cache-write failure. Prices and quotes retain
stale entries for ten fresh TTLs; lookup/overview entries for twice their fresh
TTL. Stale data is returned with stale markers when refresh fails. Sources have
separate cache namespaces, including streamed Yahoo prices.

Session validation, auth limits, logo budgets and streaming ownership are
security/coordination controls. Their failures must fail closed; never route them
through the optional market-cache helpers.

## Bounds

- Redis pool: 40 connections, one-second connect/socket deadlines, no timeout retry.
- Synchronous providers: eight worker threads, at most 32 submitted operations;
  saturation rejects work. Twelve-second async deadlines retain a running thread's
  admission slot until its synchronous operation actually finishes. Python cannot
  forcibly stop a blocked synchronous provider, so a persistently hung provider
  exhausts these fixed slots and rejects further work instead of spawning threads.
- Price/quote/lookup/overview miss coalescing: at most 64 in-flight keys per process,
  twelve-second deadlines (prices allow fifteen seconds overall, including a
  twelve-second provider deadline and cache I/O), shared tasks survive one
  disconnected waiter.
- Quotes: 25 symbols per HTTP request, one batched Redis read and pipelined writes.
- History: supported intervals, bounded period syntax and timestamps, newest 20,000
  stored points returned chronologically. Explicit periods longer than 100 years
  are rejected. Before upstream I/O, the range is capped to the smaller of 100
  years, 20,000 interval steps and provider history-range policy. `max` keeps its
  UI meaning within these resource bounds. Provider history work is coalesced
  across concurrent requests without sharing database sessions; each request
  persists and reads using its own transaction.
- HTTP ticker: 32 characters; lookup: 2–128 characters; quote query: 825 characters.
- WebSocket: four connections per user, 200 total; 100 symbols per connection,
  2,000 globally; 16 KiB text frames; 128-character request IDs; all frames count
  toward 20 commands/second, including malformed commands. Invalid JSON closes.
- WebSocket liveness: five-second send deadlines, 90-second incoming idle deadline,
  cookie-session validation every five seconds with a two-second total database deadline. Query-string credentials rejected.
- Stream input queue: 2,000 ticks; oldest ticks dropped on overflow. Per-client
  queues: 500 messages. Redis publication queue: 256 ticks with one-second I/O
  deadline, independent of client delivery. Drop counts expose overload.
- Watchlist warmup: at most 100 watchlist rows scanned and 25 selected symbols per
  invocation, using a stable row/symbol cursor. Repeated invocations visit every
  eligible watchlist without portfolio ordering starving later symbols. Stored
  string items and legacy symbol/value objects parse; malformed JSON and upstream
  failures emit safe event names. Portfolio-position selection and jobs are unchanged.

Focused evidence: `python -m pytest backend/tests/test_market_bounds.py
backend/tests/test_history_sources.py backend/tests/test_market_context.py -q`.
Tests cover outage degradation, concurrent price miss coalescing, stale fallback,
source keys, batched quote reads, fair watchlist selection, malformed/all-frame WS
limits, slow client cleanup, idle revocation and rejection of a second stream owner.
These are deterministic fault/bound checks, not production throughput measurements.

# Backend/API investigation and remediation roadmap

Reviewed 2026-11-04. Investigation below records the pre-remediation state. **Implementation has now started with T01**; current status and remaining provider-account rotation are recorded in [todo.md](todo.md). The remaining roadmap is not complete.

## Scope and evidence

**Scope revised at the user's request: defer the entire user-portfolios feature for a separate full redesign.** This roadmap does not authorize fixes, refactors, tests, or redesign work for portfolios, positions, transactions, ledger/replay, portfolio FX/valuations, snapshots/backfills, portfolio jobs, or their frontend flows. Findings remain as investigation history, not an active portfolio repair backlog.

Active work covers authentication/session security, non-portfolio user state, market REST APIs, live-price WebSockets, logos, market caching, and general infrastructure. Shared changes must preserve existing internal user keys and service signatures and must not require edits to portfolio code/schema/call sites. If a shared task cannot meet that boundary, defer that portion rather than expanding scope. Shared auth/middleware/configuration may still govern all requests; do not use that as a reason to refactor portfolio internals.

Reviewed all REST and WebSocket routers, authentication, ORM/request models, user-state persistence, portfolio/FX/snapshot services, provider wrappers, caches, scheduler, local infrastructure, dependency manifests, API client retries, and existing backend tests.

This is a development project. The proposed changes may break APIs, replace IDs, invalidate sessions, and rebuild disposable databases/caches. Do not add compatibility paths, old-user conversion, dual-ID support, or historical-data repair. Use Alembic to define a reproducible fresh schema; no reset or deletion is authorized by this document itself.

Verification performed:

- `backend/.venv/Scripts/python.exe -B -m pytest backend/tests -q -p no:cacheprovider`: **13 passed**.
- Isolated model construction confirmed that an empty registration password and negative quick-position quantity/price are accepted. Omitting transaction quantity produces `0.0` despite its `gt=0` field declaration, because defaults are not validated by default.
- AST inspection confirmed that `refresh_today_snapshots` references `asyncio`, `time`, and `UserPortfolio` without importing them.
- `git ls-files` confirms `backend/.env.dev` is tracked. Key-only inspection found non-empty JWT and logo token settings; values are intentionally omitted. Whether these credentials are active outside development was not tested.
- Security findings below are code-path findings, not a penetration test against a running deployment. No database writes, external API calls, load tests, dependency-advisory queries, or credential-use tests were performed for this review. Performance findings identify mechanisms; latency/throughput impact remains unmeasured.

## Identity: what should be hashed?

`User.id` is an auto-increment integer (`backend/core/models_db.py:35`), returned by `/auth/me` and included in readable JWT claims. User-state IDs also contain that integer (`backend/services/user_data.py:38`, `:131`, `:361`). This exposes predictable identifiers and couples client IDs to database identity, but is **not itself proof of unauthorized access**.

- Keep password hashing: the implementation already uses Argon2 by default (`backend/services/auth.py:10`). Benchmark explicit Argon2id settings and cap concurrent hashing work.
- Use server-generated random UUIDv4 identifiers for externally exposed users and non-portfolio resources. Keep the existing internal integer user key and foreign keys unchanged so identity work does not require portfolio schema changes. Add a public UUID and update auth/client types; non-portfolio resource tables can use UUIDs. Portfolio identifiers and relationships are deferred.
- Do not hash sequential IDs as an authorization mechanism. Unsalted hashes of a small ID space are enumerable; a signed JWT is readable and is not encryption.
- Keep indexed owner foreign keys and explicit owner predicates. Indexes are ordinary database performance structures and do not need password-style hashing. Email lookup indexes likewise require access control; encrypted-email/blind-index designs are a separate privacy requirement, not a prerequisite for this application.
- Replace colon-delimited composite IDs with structured columns and constraints, e.g. `(user_id, scope_type, scope_id, table_id)`. Remove legacy raw/scoped-ID fallbacks.
- Session tokens are different from public IDs: use high-entropy opaque tokens and store only their digest server-side.

## Trust boundaries and assets

Untrusted browsers cross REST and WebSocket boundaries; handlers cross into PostgreSQL, Redis, provider APIs, and scheduled/background jobs. Assets are user sessions, account emails/password hashes, private portfolio/transaction data, UI state, provider credentials/quota, and service availability. The API client is also part of the write boundary because it decides whether requests are replayed.

Primary abuse cases: user A supplies user B's resource ID; an attacker guesses passwords or occupies sockets; a client repeats a write after losing its response; a provider/cache fails mid-transaction; two sells/default creations race; a job writes stale snapshots after a newer ledger edit.

## Findings

Priority definitions: **P0** close before any shared deployment; **P1** fix before relying on financial results or inviting users; **P2** finish before scaling or production readiness. Priority is implementation order, not a claim of demonstrated exploitation.

### F01 — DEFERRED (portfolio redesign; original P0): portfolio ownership is not enforced consistently

Evidence: `backend/services/portfolio.py:309` accepts `payload.portfolio_id` for quick positions without loading an owned parent; `:549` checks only that the portfolio ID is non-empty, then loads the parent by ID alone; `:752` verifies ownership of the transaction being edited but not its destination portfolio. The child foreign keys in `backend/core/models_db.py` independently reference a user and a portfolio, so they do not prove those owners match.

Impact: a caller who knows another portfolio ID can attach their own child rows to it. Transaction writes call `invalidate_from_date` (`backend/services/snapshots.py:450`), which deletes snapshots by portfolio ID without user scope. History loads snapshots by portfolio ID (`:509`) after checking for caller-owned transactions. Together these paths permit cross-user snapshot interference and can expose another portfolio's snapshot values once the attacker has attached a transaction. This requires a valid other portfolio ID; random-looking IDs do not fix the missing authorization.

Fix: one `require_owned_portfolio` boundary used before reads, writes, FX work, cache activity marking, and job scheduling. Scope snapshot operations to owner and portfolio. Enforce `(portfolio_id, user_id)` with a composite parent uniqueness/FK constraint. Return a consistent 404 for foreign/missing resources. Add two-user integration tests covering quick positions, transactions including moves, history, and snapshot invalidation.

### F02 — P0: tracked secrets and credential-bearing logs

Evidence: tracked `backend/.env.dev` has non-empty JWT/provider secret settings; `.gitignore` does not exclude environment files. `backend/services/logos.py:42` and `:47` print a URL containing the provider token. `backend/core/config.py:20` also supplies a known JWT fallback, and loads the dev environment file whenever it exists, regardless of selected environment.

Impact: anyone with repository/log access may obtain credentials. If the known fallback is deployed, its secret permits arbitrary valid token signing. Active use and past disclosure were not verified.

Fix: untrack actual environment values, commit a placeholder example, ignore secret-bearing env files, rotate any real exposed credentials, and redact URLs/headers/exception text. Load local dev files only in explicit dev mode; fail startup on missing/default secrets outside local development. Add secret scanning and startup configuration tests. Rotation precedes any optional history cleanup; deleting the file alone is insufficient.

### F03 — P1: sessions lack revocation and consistent REST/WS enforcement

Evidence: logout only clears a cookie (`backend/api/auth.py:92`); signed tokens remain valid until expiry. Cookie max-age is 30 days (`:25`), token default expiry is one day (`backend/core/config.py:22`). HTTP resolves a real user, while WS only decodes the token (`backend/api/ws.py:21`) and does not recheck expiry after connection. WS accepts bearer tokens in query strings. Decode does not require an explicit full set of claims (`backend/services/auth.py:31`).

Fix: for this browser app, prefer one server-backed session model: high-entropy opaque cookie, digest stored in Redis/DB, explicit TTL, and server-side logout/revocation. Reuse the same principal/session resolver for REST and WS; expire or periodically revalidate sockets. Remove query-string credentials. Do not add refresh-token complexity unless a future non-browser client requires it. If JWTs are retained instead, require claims and a revocable session identifier, and document why JWTs are needed.

### F04 — P1: auth abuse controls and cookie-write protection are incomplete

Evidence: no application HTTP rate limiter was found; passwords have no length policy (`backend/schemas/models.py:7`); synchronous password hashing/verification runs inside async handlers (`backend/api/auth.py:31`, `:65`). Unknown-user login skips password verification, creating a timing difference. Secure cookies default off. Cookie-authenticated writes have no explicit CSRF token or Origin verification. Current exact-origin CORS and SameSite=Lax provide useful protection but do not cover every same-site or future deployment arrangement.

Fix: validated environment-dependent cookie settings; one documented same-origin/same-site deployment contract; CSRF token and Origin checks on unsafe browser requests, including login/logout. Apply distributed IP/account auth throttles without permanent account-lockout denial of service; bounded hash workers; a reasonable minimum/maximum password policy; dummy verification for unknown accounts; duplicate-registration race handling. Registration currently discloses existing emails explicitly: select and document an enumeration policy. Add security headers at the edge/application as appropriate and no-store on sensitive responses.

### F05 — P1: internal exceptions and inconsistent errors escape the API

Evidence: `backend/main.py:94` returns `str(exc)` on 500; market routes return raw exception strings on 502. HTTP exception handling drops `exc.headers`; validation errors retain FastAPI's different response shape. Handlers synthesize CORS headers themselves. `src/services/api.ts:15` assumes JSON and reads only `message`.

Fix: stable error schema with machine code, safe message, request ID, and bounded field errors. Handle expected domain conflicts explicitly, preserve intentional headers such as Retry-After, centralize CORS middleware, redact structured server logs, and handle non-JSON/empty responses in the client. Validate an invalid body containing a password without echoing that password in responses/logs.

### F06 — DEFERRED (portfolio write/retry redesign; original P1): mutation replay can duplicate transactions

Evidence: `src/services/api.ts:29` retries almost all failures twice; POST, PUT, and DELETE use that helper. Transaction creation (`backend/services/portfolio.py:549`) generates a new ID each call and has no idempotency key.

Fix: retry only safe reads for selected transient failures, with a deadline, jitter, cancellation, and Retry-After support. Do not automatically replay financial writes without an idempotency key. Persist owner/operation/key, request fingerprint, and result atomically with the mutation; concurrent identical keys return the original result and conflicting payloads return 409. Test the committed-write/lost-response case.

### F07 — DEFERRED (portfolio redesign; original P1): financial mutations are not atomic or concurrency-safe

Evidence: transaction insert/update/delete commits before recalculation and snapshot invalidation (`backend/services/portfolio.py:638`, `:825`, `:877`); those helpers commit independently. `get_db` also commits (`backend/core/database.py`). SELL checks current holdings without a lock; update does not perform equivalent oversell validation, and replay silently clips sold quantity (`portfolio.py:485`). Default portfolio creation/change is check-then-write with no one-default database invariant.

Fix: one explicit unit of work for the ledger mutation, projection update, revision bump, and invalidation. Helpers flush rather than commit. Serialize mutations per portfolio using a row lock, with deterministic lock ordering when moving transactions. Validate the complete chronological ledger for backdated changes; reject impossible negative holdings instead of clipping. Enforce one default portfolio per owner with a partial unique index and retry expected creation races. External provider calls must not hold write locks; resolve prerequisites before entering the short transaction.

### F08 — PARTIAL: non-portfolio input bounds active; financial contracts deferred (P1): weak domain validation and ambiguous API contracts

Evidence: quick position values are unconstrained; transaction FX, execution date, strings, arrays, and JSON payloads lack comprehensive bounds. `TransactionCreatePayload.quantity` has an invalid unvalidated default (`backend/schemas/portfolio.py:92`). Transaction types include cash, tax, fee, split, and dividend events but replay engines only implement BUY/SELL. APIs still advertise runtime base currency/"all" semantics contrary to project rules. History accepts timeframe/interval but ignores timeframe and does not resample interval (`backend/services/portfolio.py:967`; `snapshots.py:473`).

Fix: discriminated transaction models with type-specific required fields; finite positive FX and bounded Decimal amounts/quantities; supported currencies, symbol syntax, time units/range, string/list/depth/body limits; forbid unexpected fields for strict command models. Implement each advertised event type or reject/remove it until supported. Keep portfolio base currency locked, remove compatibility aliases, and implement or remove ignored options. Apply matching client/OpenAPI types. Validate layout references and widget dimensions before destructive replacement; add a revision/If-Match contract to prevent stale-tab overwrites.

### F09 — DEFERRED (portfolio redesign; original P1): financial history can be materially wrong

Evidence: financial amounts use `Float` throughout `backend/core/models_db.py`; update validates normalized seconds but stores raw `payload.executed_at` (`portfolio.py:822`), and invalidates from the new date rather than the earlier of old/new dates. Snapshot backfill gets one present-day FX rate and applies it across past dates (`backend/services/snapshots.py:337`). FX can silently fall back to 1.0 or a live rate for historical conversion (`backend/services/fx.py:47`, `:105`). `currency_for_ticker` uppercases currency codes and conflates pence/GBP without a quote-unit conversion (`backend/providers/yahoo.py:16`).

Fix: Decimal/Numeric with documented precision and rounding; seconds-only persisted execution timestamps; invalidate from `min(old_date,new_date)` for edits and both affected portfolios. Preserve execution-date FX truth; snapshot valuation uses each valuation date's FX, with provenance and actual observation time. Missing required FX must be explicit, not an invented 1:1 rate. Normalize provider price unit and currency together, including GBp/GBP fixtures. Establish a single ledger/replay implementation. Respect asset calendars (including crypto weekends), cash flows, and price cutoff semantics; distinguish cost fallback, stale price, and actual market valuation.

### F10 — DEFERRED (portfolio I/O paths; original P1): synchronous network work blocks the event loop

Evidence: `currency_for_ticker` directly calls yfinance metadata; `resolve_asset_class` directly calls `provider.get_company_info`; `get_fx_rate` invokes synchronous `_get_direct_rate`. These are called by async portfolio/snapshot paths. Asset-class resolution also runs during response construction rather than only initial position creation.

Fix: async cached metadata/currency/FX services using the existing provider async wrappers and a bounded executor/semaphore for synchronous libraries. Cache immutable-enough symbol metadata, resolve asset class on first creation, and remove repeated provider lookups from response loops. Configure underlying provider timeouts: cancelling a to_thread await does not stop the underlying network call.

### F11 — DEFERRED (portfolio reads/backfills; original P2): expensive reads, N+1 work, and unbounded workloads

Evidence: listing positions replays/commits the ledger and queries transactions per position (`portfolio.py:177`, `:213`); listing transactions rewrites currencies (`:688`). List/history endpoints use unbounded `.all()`; date/history inputs can request extensive responses. Backfill replays all transactions for every day, repeatedly scans historical prices, and emits unchunked multi-row inserts (`snapshots.py:291`). A sufficiently large snapshot insert can exceed asyncpg's 32767-bind limit, which the separate OHLC path already handles.

Fix: read-only GET handlers; create defaults during account/resource initialization, not reads; update projections on mutations. Fetch/group ledger rows once, batch prices/Redis operations, keyset-paginate transactions, bound history ranges/point counts and resource counts. Backfill incrementally with price cursors/date-specific FX maps and parameter-safe chunked writes. Add query-plan-driven composite indexes after collecting representative EXPLAIN ANALYZE output; do not add indexes speculatively. Existing OHLC source/session partitioning and chunking should be reused.

### F12 — PARTIAL: watchlist prewarm parsing active; portfolio jobs deferred (P1/P2): scheduler bugs and process-local jobs undermine reliability

Evidence: missing `asyncio`, `time`, `UserPortfolio` imports break snapshot refresh when active portfolios exist (`backend/scheduler.py:65`). Watchlist prewarm expects objects with `.get()` although the schema stores strings (`:31`, `backend/schemas/models.py:242`), silently skipping watchlists. The sorted first 25 symbols and first 100 portfolios can starve others. The cron docstring says UTC but scheduler timezone is not set explicitly. Every API process starts its own scheduler/stream hub (`backend/main.py:33`); backfill deduplication is only an in-process set (`snapshots.py:259`).

Fix: repair and test job contracts first. Before multiple API workers, move scheduled/backfill work to one worker using a Redis-backed bounded queue/lease with expiry, retries, and job status. Use portfolio ledger revisions to prevent stale backfills overwriting newer mutations. Choose fair bounded batches and explicit UTC scheduling. Track/cancel/drain tasks on shutdown; do not allow fire-and-forget work to outlive Redis/DB clients. A single elected scheduler is sufficient initially; no need for a complex distributed task platform.

### F13 — P1/P2: WebSocket limits have gaps

Evidence: only per-connection command limiting is present, after JSON parsing/requestId checks (`backend/api/ws.py:21`); no principal-level connection quota or explicit app message-size/depth limits. The incoming provider `tick_queue` is unbounded (`backend/services/streaming.py:279`), while slow outbound send failures are swallowed (`:253`). Every tick updates/publishes Redis before fanout, so slow Redis can accumulate inbound work. Limits are per process, and the hub always uses Yahoo independently of the REST provider selection.

Fix: auth/session checks from F03; enforce transport message-size and schema limits, count all frames including invalid ones, per-user/IP connection and subscription budgets, idle/send deadlines, safe invalid-JSON closure, and no unrestricted raw provider payloads. Bound or coalesce inbound ticks by symbol, prioritize control messages, disconnect persistently slow clients, and decouple Redis publication from delivery. Define one provider/source policy and share upstream ingestion across workers before scaling. Keep current bounded outbound queues and subscription caps.

### F14 — P1/P2: logo proxy leaks quota and misclassifies outages

Evidence: public `/logo/{ticker}` consumes paid-provider quota; `backend/services/logos.py:78` checks a counter separately from incrementing it, and counts only final successes. All failures, including timeouts/429/500, become a 30-day NOT_FOUND entry (`:95`). Each miss creates an HTTP client; concurrent misses are not coalesced. Response bytes/content type are not bounded/validated.

Fix: decide explicitly whether logos are public; either authenticate or enforce a strict anonymous/IP budget plus a global provider budget. Reserve/count each upstream attempt atomically, including fallback attempts; use per-symbol request coalescing, a reused bounded HTTP client, content/size limits, and separate short transient-failure versus real-404 caching. Include the redaction fix in F02 immediately.

### F15 — P2: cache and dependency failure behavior is inconsistent

Evidence: many Redis reads occur outside fallback handling; clients have no explicit connection/socket timeout/pool cap (`backend/core/redis.py:52`). Lookup cache expiration equals its freshness interval, so its intended stale fallback is normally gone (`backend/services/lookup.py:31`). Price/quote/lookup keys omit provider source, unlike OHLC. Simultaneous misses have no shared refresh lock; quote cache GET/SET work is serial.

Fix: document fail-open/fail-closed behavior per dependency: optional market cache may degrade; authentication and abuse controls must not silently bypass security. Explicit bounded pools/deadlines, source/version-aware keys, stale retention beyond freshness, MGET/pipelines, and short refresh leases with jitter. Record freshness and provider observation time separately from fetch time; `YahooFinanceProvider.get_price` currently labels fetch time as the price timestamp. Never share private user caches without owner partitioning.

### F16 — P2: schema bootstrapping, infrastructure, and quality gates are incomplete

Evidence: app startup calls `create_all` alongside Alembic (`backend/main.py:27`), which can create an unversioned fresh schema. Compose publishes Postgres/unauthenticated Redis on all host interfaces with fixed dev credentials (`docker-compose.dev.yml`). Python dependencies are mostly open-ended lower bounds, and the root has competing `bun.lock`/`package-lock.json`; no `.github/workflows` directory was found. `/health` reports process status only. Existing backend tests cover replay/history/calendar helpers, not full authenticated routes or concurrent database behavior.

Fix: Alembic-only initialization and schema-revision checks; least-privilege runtime DB role; local services bound to 127.0.0.1; separate validated deployment settings. Pin the Python runtime/resolved dependency graph and select one frontend package manager/lockfile. Add CI with fresh Postgres/Redis, migrations, auth/isolation/concurrency tests, dependency and secret scans. Add readiness separate from liveness, structured redacted logs, request IDs, and bounded-cardinality metrics for request latency/errors, DB pool wait, upstream latency, cache hit/stale rates, WS lag/drop counts, and job age/failures.

## Target design and ordered roadmap

Prefer the existing modular FastAPI/SQLAlchemy/PostgreSQL/Redis architecture. No portfolio rewrite is specified here. The active checklist and deferred task index are in [todo.md](todo.md); original task IDs are retained for traceability.

1. **Containment — T01.** Remove secret/log exposure and validate configuration.
2. **Identity and browser boundary — T03–T06.** Add public user/non-portfolio UUIDs while retaining internal user keys; consolidate revocable sessions, auth throttles/CSRF, and safe errors. Session work depends on safe configuration, not a portfolio schema redesign.
3. **Non-portfolio validation and persistence — T19.** Bound user-state and market inputs, validate layout relationships, and protect layout saves from stale overwrites. Implement market history bounds without touching portfolio history.
4. **Market reliability — T13 and T16.** Repair watchlist prewarm parsing only; bound live-price WS, market caches, and logo proxy workloads. Leave portfolio prewarm inputs, snapshot scheduling, and backfill infrastructure untouched. Split WS/cache/logo changes into separate reviewable work items.
5. **Reproducibility and operational evidence — T17–T18.** Add deterministic installs, general bootstrap/configuration checks, CI, and telemetry for the active scope. Do not replace the portfolio schema or require new portfolio tests as an acceptance gate.

**Deferred:** T02, T07–T12, T14–T15, and the portfolio portions of previously mixed tasks. Revisit their findings only when the portfolio feature is redesigned. Do not incrementally repair the rushed implementation or design a replacement as part of this roadmap. Generic mutation retry changes are also deferred because the shared client currently drives portfolio writes; the active error-parsing change must preserve retry behavior.

## Checkpoints

- **Containment:** actual secrets are untracked/redacted; unsafe non-local configuration fails startup.
- **Identity/auth:** public identity reveals no internal user sequence; non-portfolio resources enforce ownership; logout/revocation, WS session expiry, CSRF, and auth limits pass focused tests without changing portfolio foreign keys.
- **Market/user-state:** excessive inputs fail before expensive work; layout references/revisions are validated; watchlist prewarm handles stored strings; WS queues and provider/cache/logo workloads are bounded.
- **Reproducibility:** clean install and current migrations work; active-scope CI and fault/load evidence pass. These checkpoints are not a declaration that the deferred portfolio feature is secure or production-ready.

## Verification strategy and budgets

Use disposable Postgres/Redis for auth/session, non-portfolio ownership/constraints, layout revision, cache/limiter, and bootstrap tests. Use two authenticated users for layout/watchlist/widget/settings/table-preference access. Mock provider responses for deterministic timeout/failure tests; CI must not depend on Yahoo availability. API-client error parsing tests should preserve existing retry behavior.

The prior review's 13 passing backend tests and portfolio probes remain historical evidence, not new portfolio implementation obligations. No portfolio database fixtures, financial acceptance criteria, transaction concurrency tests, valuation benchmarks, or snapshot job tests are required by this revised roadmap.

Collect a baseline before setting latency/throughput targets. Representative active-scope scenarios include maximum allowed watchlists/widgets, 25 symbols per quote request, bounded market OHLC ranges, and up to the configured 200 WS clients. Measure warm/cold p50/p95/p99, event-loop lag, pool wait, provider call count, memory, and queue age. Set explicit endpoint deadlines, quotas, and point-count caps from that evidence. Load/fault tests cover auth, user state, market REST, WS, logos, and caches only.

## Decisions to settle during implementation

- Prefer same-origin browser deployment and opaque server sessions; confirm only if a genuine external bearer-token client is required.
- Keep integer user primary/foreign keys private; introduce a public user UUID and opaque non-portfolio resource IDs. Portfolio relationships are unchanged.
- Choose explicit request/resource quotas and latency budgets from measured active-scope workloads.
- Confirm whether logos must be publicly accessible. No new provider integration is required.
- Keep portfolio domain semantics, schema, precision, FX policy, write retry/idempotency, and job architecture for the separate redesign.

## Reference standards

- OWASP API Security Top 10: https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- OWASP Authorization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP Session Management: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP CSRF Prevention: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP Password Storage: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- SQLAlchemy transactions: https://docs.sqlalchemy.org/en/20/orm/session_transaction.html
- Pydantic default validation: https://docs.pydantic.dev/latest/concepts/fields/#validate-default-values

These are implementation references; no live documentation/advisory lookup was performed during this local review.

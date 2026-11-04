# Backend/API remediation tasks

Implementation now includes non-portfolio identity/ownership, sessions/browser defenses, bounded market/stream/logo work, and reproducible bootstrap/CI. Validation and remaining external evidence are recorded below. Scope excludes the entire user-portfolios feature, which will receive a separate full redesign. Other active tasks remain pending. See [plan.md](plan.md) for evidence and the scope boundary. No old-user/data migration work is included. Original task IDs are retained.

Shared auth/middleware/configuration can govern requests globally, but active work must not change portfolio feature code, schema, call sites, frontend flows, tests, or jobs. Keep internal user keys and existing shared service signatures. Defer any portion that cannot meet this boundary.

## T01 — Contain secrets and unsafe configuration (P0; F02)
- [x] Untrack the real development environment file, preserve its ignored local copy, add an example/ignore rules, and redact provider URLs including HTTPX INFO logs.
- [x] Rotate the local JWT signing secret without displaying it; existing dev sessions require login after restart.
- [x] Reject missing/known-default signing keys, unsafe non-local settings, and accidental dev-env loading in non-local environments.
- [x] Provider-account credential rotation: user confirmed manual rotation on 2026-11-04. No credential value was requested or displayed; local/deployment secret provisioning remains operator-managed.
- Acceptance/verification: secret/startup checks pass; provider failure logs contain no credentials.
- Dependencies: none. Files: config, logo service, env example, .gitignore, README, focused security tests. Verification: 40 backend tests passed, including configuration isolation and raw/encoded token-log checks; changed source/examples/docs contain neither current local credential. No portfolio files changed.

## T03 — Add public IDs and secure non-portfolio relationships (P1; identity)
- [x] Add a public user UUID while keeping internal integer user keys and all portfolio foreign keys intact; align auth response/client types.
- [x] Replace owner-prefixed non-portfolio IDs and legacy fallbacks with opaque resource IDs/structured uniqueness; enforce owned screen/widget relationships.
- Acceptance/verification: two-user layout/watchlist/widget/preference tests prove isolation; no public numeric user sequence; no portfolio schema/code edits.
- Dependencies: none. Split public account identity and non-portfolio resource schema/contracts into focused changes.
- Public account slice (2026-11-04): migration `008_public_user_identity` applied to local development PostgreSQL; unique UUIDv4 defaults on `users.public_id`; auth JSON `id` and JWT `sub` use this UUID; auth lookup still returns the existing ORM user and internal integer key. Numeric-subject JWTs require login again. No portfolio code/schema/FK changes.
- Verification: 54 backend tests passed, including two opt-in real PostgreSQL tests for registration/login/me, uniqueness, and isolated migration upgrade/downgrade. All 14 auth/layout frontend tests passed. Matched baseline/current full frontend runs each had 511 passed / 38 failed, with identical failing tests across 11 unrelated chart/UI files (the earlier full run had 37 failures; refresh-transform timeout timing varies). Build remains blocked by the baseline `visibleExtrema.test.ts:161` mock missing `horzScaleBehavior`; the missed numeric auth fixture was corrected. `backend/.env.dev` exists and remains ignored.
- Remaining T03: owner-prefixed screen/widget/watchlist IDs still expose internal user-number prefixes. Account UUID completion does not satisfy full resource opacity or the two-user resource-relationship acceptance checks.

## T04 — Consolidate browser sessions (P1; F03)
- [x] Implement opaque sessions with stored digests, aligned TTL, rotation, and server-side revocation.
- [x] Reuse session/principal validation for WS; remove URL credentials and expire/revoke connections.
- Acceptance/verification: logout/revocation/deleted-user tests reject HTTP auth and WS reuse; session records/logs contain no raw token.
- Dependencies: T01; public response types coordinate with T03. Keep the existing internal user key returned to shared dependencies. No portfolio route changes.

## T05 — Protect authentication and browser writes (P1; F04)
- [x] Add bounded password/hash-worker policies, dummy verification, distributed auth limits, and registration race handling.
- [x] Apply CSRF/Origin protection, validated cookie/CORS settings, security headers, and sensitive-response cache policy centrally.
- Acceptance/verification: auth and non-portfolio write tests cover CSRF, hostile origins, throttling, races, and secure cookies.
- Dependencies: T04. Split auth abuse controls and browser middleware. No portfolio-specific integration/refactor work.

## T06 — Stabilize errors and client failure parsing (P1; F05)
- [x] Add safe error codes/request IDs/field errors, preserve expected headers, centralize CORS, and redact logs.
- [x] Handle empty/non-JSON API responses while preserving current retry behavior.
- Acceptance/verification: auth/user-state/market error fixtures disclose no passwords, tokens, SQL, or stacks; HTTP statuses/headers survive parsing.
- Dependencies: T01. Files: shared error handling, API client, focused non-portfolio tests. Mutation retry/idempotency work is deferred under T07.

## T13 — Fix watchlist prewarm parsing only (P1; active part of F12)
- [x] Parse stored watchlist strings correctly and expose parsing/upstream failures.
- [x] Bound/fairly select watchlist work without modifying portfolio-position inputs or snapshot scheduling.
- Acceptance/verification: watchlist-only fixtures prove string symbols reach market-cache prewarm and eligible watchlist symbols are not permanently starved.
- Dependencies: none. Files: isolated watchlist prewarm path and focused tests. Missing snapshot-job imports, UTC snapshot scheduling, and portfolio-job fixes remain deferred.

## T16a — Bound live-price WebSockets (P1/P2; F13)
- [x] Add principal quotas, frame/schema bounds, all-frame rate accounting, send/idle deadlines, and cleanup.
- [x] Coalesce/bound inbound ticks, separate slow Redis publication from delivery, and define upstream ownership before multiple API workers.
- Acceptance/verification: flood/slow-client/slow-Redis fixtures keep queues bounded; invalid JSON closes safely; session expiry takes effect.
- Dependencies: T04. Files: WS router, stream hub, config, focused tests. No portfolio streaming/features are included.

## T16b — Harden market caches and provider limits (P2; F15)
- [x] Set bounded Redis/provider pools and deadlines; add source-aware keys, single-flight refresh, intentional stale retention, and batched quote-cache operations.
- [x] Document optional-cache degradation versus security-control failure behavior.
- Acceptance/verification: market cache outage/miss-stampede tests prove bounded work and correct stale/source behavior; shared provider method signatures remain compatible.
- Dependencies: T01; coordinate session-store failure rules with T04. No portfolio/FX call-site changes or global portfolio I/O cleanup; defer changes needing them.

## T16c — Protect logo quota and failure caching (P1/P2; F14)
- [x] Decide public/authenticated access; apply request budgets and atomically reserve/count every provider attempt.
- [x] Reuse a bounded HTTP client, coalesce misses, validate response content/size, and distinguish true 404 from transient failures.
- Acceptance/verification: concurrent attempts stay within budget; 429/500/timeouts never become 30-day missing logos; logs contain no token.
- Dependencies: T01. Files: logo route/service, config, focused tests.

## T17 — Reproduce installs and general bootstrap (P2; F16)
- [x] Use Alembic-only initialization/revision checks and least-privilege runtime access; bind local data services to loopback.
- [x] Pin runtime/resolved dependencies and choose one frontend package manager/lockfile; triage advisories.
- Acceptance/verification: clean install/current migrations/startup works; runtime role cannot do DDL; schema mismatch fails readiness.
- Dependencies: start early; coordinate active non-portfolio migrations with T03/T04. Do not rewrite/rebaseline portfolio tables or alter their contracts. Split bootstrap and toolchain changes.

## T18 — Add active-scope CI and operational evidence (P2; F16)
- [x] Add isolated Postgres/Redis CI for auth, user-state isolation, market APIs, WS/cache/logo failure behavior, and current migration bootstrap; include secret/dependency checks.
- [x] Add structured redacted logs, request IDs, readiness/liveness, and bounded-cardinality request/pool/provider/cache/WS metrics.
- Acceptance/verification: active-scope regressions are reproducible; market/dependency faults are observable; load evidence establishes bounded resource use and agreed budgets.
- Dependencies: CI scaffolding starts with T17; final evidence follows active tasks. No new portfolio/financial/job tests, metrics, benchmarks, or release gates.

## T19 — Validate non-portfolio inputs and state consistency (P1; active part of F08)
- [x] Bound market ticker/query/history range/point count and user-state string/list/JSON size/depth; reject invalid values before I/O.
- [x] Validate layout screen/widget references/dimensions, define settings values server-side, and add layout revision/If-Match protection.
- Acceptance/verification: excessive/invalid market and user-state requests fail predictably; stale saves return conflict; invalid layout replacement leaves saved state unchanged.
- Dependencies: T03; error fixtures follow T06. Split user-state validation/concurrency and market input bounds. No financial schema or portfolio-history changes.

## Deferred — separate portfolio redesign

These are investigation references, not tasks to implement in this roadmap:

- **T02:** portfolio ownership/snapshot isolation (F01).
- **T07:** financial mutation retry/idempotency, including shared-client mutation retry changes (F06).
- **T08:** financial command/event/base-currency contracts (financial part of F08); non-portfolio bounds moved to T19.
- **T09:** ledger atomicity, locks, default-portfolio invariants, revisions (F07).
- **T10:** financial precision, replay/read-model/quick-position redesign (F07–F11).
- **T11:** execution timestamps, historical FX/valuation, financial quote-unit semantics (F09).
- **T12:** blocking provider I/O cleanup in portfolio/FX/valuation call sites (F10).
- **T14:** portfolio snapshot/backfill worker architecture and revision publication (F12).
- **T15:** portfolio reads/pagination/N+1/backfill optimization (F11).
- **T13 deferred portion:** missing snapshot scheduler imports, portfolio activity, snapshot scheduling/timezone/fairness.
- **Other mixed-task portions:** portfolio UUID/FK/schema changes, financial CI fixtures and load gates, and any shared refactor requiring portfolio edits.

## Active delivery checkpoints
- [x] Secret/configuration containment passes (provider rotation confirmed by user).
- [x] Public IDs, non-portfolio ownership, sessions, CSRF, and auth-abuse controls pass without portfolio schema changes.
- [x] Market/user-state validation and WS/cache/logo/watchlist-prewarm behavior pass focused tests with bounded workloads.
- [ ] Reproducible setup, active-scope CI, telemetry, and fault/load evidence pass.
- [x] Deferred portfolio findings remain explicitly unresolved; completing this checklist makes no portfolio-readiness claim.

## Resumed implementation evidence (2026-11-04)

- Subagents successfully ran in parallel for auth/security, streaming/caches, and errors/logos/bootstrap. Parent integrated user-state contracts and concurrency; cross-reviews addressed default-watchlist races, cancellation-safe hash limits and WS validation deadlines.
- Initial integrated backend run: 97 tests passed with `RUN_DATABASE_TESTS=1`, including disposable PostgreSQL schemas, real Redis limits, migration bootstrap and active rollback. Additional final evidence follows after review fixes.
- Frontend focused API/layout/widget-cache tests: 23 passed. Full frontend: 519 passed / 36 failed across 11 chart/UI test files already identified as baseline failures; build still fails on the preexisting `visibleExtrema.test.ts:161` mock missing `horzScaleBehavior`. No portfolio feature code/schema/tests were modified.
- Contracts and bounded budgets: [user state](../docs/user-state-contract.md); additional market/operations documents are linked on completion.
- Migrations 009/010: clean generated-schema upgrade/active rollback passed. Local development DB now reports `010_user_state_security (head)` and schema readiness passes. Matching precreated auth/session-layout tables were inspected and adopted; missing constraints applied transactionally. Four older duplicate shared table-preference rows were backed up in ignored `.verification/table-pref-duplicates-backup.json` before keeping the newest per scope. No portfolio tables were changed. Owner-prefixed resource data still has no compatibility migration; use fresh development user-state data.
- Full downgrade to base hits a preexisting portfolio migration/index defect. Active 010/009 rollback to 008 passes; portfolio migration repair remains deferred.

## Final pass verification

- Final integrated backend: **105 passed**, including PostgreSQL and Redis checks. One upstream passlib deprecation warning remains. Auth agent also verified the non-portfolio suite with `ENV=test`, HTTPS origins and secure cookies.
- Patched Vitest 4.1.12: **28 focused frontend tests passed** (auth/API/layout/widget caches). Full run remains **519 passed / 36 baseline failures in 11 chart/UI files**. Typecheck is blocked only by the known `visibleExtrema.test.ts:161` fixture missing `horzScaleBehavior`; explicit Node test types were added after upgrading Vitest.
- npm audit: **0 advisories**, runtime and dev. Python pinned runtime audit: **0 advisories**. Dependency consistency passes. Clean isolated offline npm installation passes. No forced audit fix used.
- Added Alembic-only bootstrap/readiness/least-privilege checks, loopback data-service bindings, CI and fixed-cardinality telemetry. See [operations](../docs/backend-operations.md), [resource budgets](../docs/market-resource-budgets.md), and [user-state contracts](../docs/user-state-contract.md).
- `git diff --check` passes. Changes remain uncommitted; no push/deployment performed.

Remaining verification (kept open rather than claimed complete):
- [ ] Execute the new workflow remotely, including the real restricted-runtime-role DDL denial probe and current-source gitleaks scan.
- [ ] Verify a fresh Python installation from pinned requirements; the patched existing environment and dependency consistency/audit pass.
- [ ] Obtain deployment-scale throughput measurements. Current load evidence covers deterministic concurrent misses, bounded queues, floods, slow clients, failed Redis/provider calls and concurrent resource budgets; it is not a production benchmark.

## Layout400 follow-up

`GET /user/layout` failed because existing development resource IDs and active-screen aliases did not match the new UUID contract. Local development state now uses valid resource IDs. Direct ASGI requests against the actual local database returned HTTP200 for all9 development accounts. Related15 user-state checks passed. No legacy compatibility/migration tooling was retained; development data is disposable per user instruction. Default layout creation now flushes within the caller transaction and returns its actual revision.

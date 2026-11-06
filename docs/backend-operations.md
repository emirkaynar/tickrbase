# Backend operational contract

The active roadmap excludes portfolio redesign, financial correctness, and portfolio
jobs. Shared authentication and browser protection apply globally. No portfolio
readiness claim follows from these checks.

## Install and bootstrap

Use Python 3.13 and npm 11.19.0 with Node 24 (Node >=22.12 supported). The sole
frontend lockfile is `package-lock.json`; `.npmrc` disables install scripts. Run
`npm ci --ignore-scripts`. The installed esbuild platform binary runs without
blanket-enabling lifecycle scripts. Runtime Python dependencies have exact direct
pins and resolved constraints: `pip install -r backend/requirements.txt`. Use
`backend/requirements-dev.txt` for tests, with test-only transitive versions in
`backend/requirements-dev.lock.txt`. Linux uvloop has an explicit platform pin.
Hashes and container image digests are not yet locked.

Run `python -m alembic -c backend/alembic.ini upgrade head` with a dedicated
migrator role. Application startup performs no DDL and fails before accepting
traffic if the current revision differs from repository heads. Local Compose
services bind only 127.0.0.1. Outside local mode, the runtime role must have no
superuser/CREATEDB/CREATEROLE, no schema CREATE, and own no tables. Grant schema
USAGE, table SELECT/INSERT/UPDATE/DELETE, and sequence USAGE/SELECT after migration;
configure default privileges on the migrator for future tables. Supply passwords
through the deployment secret store. `python -m scripts.check_runtime_role` checks
revision/role policy and transactionally probes that CREATE TABLE is denied.

## Sessions and browser writes

The `access_token` HTTP-only cookie holds 32 random bytes encoded as an opaque token;
only its SHA-256 digest is stored. TTL is `ACCESS_TOKEN_EXPIRE_MINUTES * 60`.
Login rotates the presented cookie, logout revokes it, and each user has at most
20 active sessions. Deleted users and revoked/expired sessions fail authentication;
WS connections revalidate their stored session. WS URL credentials are rejected.
Expired records are removed opportunistically during session creation.

Cookie/auth writes require an exact configured trusted Origin. Every supplied
hostile Origin is rejected for unsafe methods. Non-browser bearer clients may omit
Origin when no session cookie is present. Cookies default Secure outside local
mode; SameSite=None requires Secure. `/auth/` and `/user/` bodies are limited to
1 MiB with a ten-second read deadline. JSON validation responses expose field paths
and error codes, never rejected values. Sensitive responses use no-store.

Auth controls require Redis and fail closed with 503 when it is unavailable.
Atomic HMAC-keyed limits permit 30 attempts per IP/minute and ten per normalized
email/minute. Passwords require 12–128 characters. At most four hash workers run;
admission times out after 250 ms. Missing users execute dummy verification.
Watchlists are capped at 100/user and table preferences at 500/user; layout saves
require the current revision and stale saves fail with 409.

## Logos and failure policy

Logos require an authenticated cookie, including browser image requests. Each
principal has 60 requests per rolling inactivity window of 60 seconds. Every
provider attempt reserves one monthly credit atomically before I/O, including
404, failed attempts, and base-ticker fallbacks. Quota/Redis/provider failures
return 503 with Retry-After, never a false persistent 404. Only a confirmed 404
is negatively cached. Provider responses must be WebP with matching magic bytes,
at most 256 KiB. The HTTP pool has eight connections; at most 64 unique misses
are admitted per process. A miss has a 12-second total deadline; each provider
attempt has five seconds. Redis leases coalesce cross-process misses, and token
values are redacted from HTTPX/provider logs. A stopped caller does not cancel a
shared fetch; completion always retrieves task errors.

Optional market cache failures may degrade to bounded provider work. Authentication
limits, logo budgets, and stream ownership coordination fail closed. Streaming
supports one upstream owner: a second API worker fails startup rather than opening
a duplicate provider subscription. See [market resource budgets](market-resource-budgets.md).

## Signals and verification

`GET /live` checks the process. `GET /ready` checks current schema/role and Redis
under deadlines, returning only ready/unavailable. `GET /ops/metrics` requires an
authenticated user and exposes per-process request histograms, fixed provider/cache/
logo counters, provider inflight, SQL pool size/checkout/overflow, Redis capacity,
and stream queue/client/drop snapshots. Metric labels contain route templates and
status classes, never tickers, users, query strings, or raw exception messages.
Portfolio requests are excluded from new request metrics. Request logs use JSON
events and generated request IDs; unexpected exception logs contain only class
names. X-Request-ID links safe client errors to logs. Stream/cache modules retain
their own stable event logs. API CSP is restrictive and does not permit the
third-party scripts in interactive Swagger/Redoc; `/openapi.json` remains available.

The GitHub Actions active-backend workflow uses isolated Postgres/Redis services,
Alembic bootstrap, a separate runtime role, non-portfolio regression tests,
frontend auth/layout/client checks, gitleaks current-source scanning with redaction,
and dependency audits. Historical exposed credentials still require manual rotation;
source scanning cannot revoke them. CI execution itself requires a pushed branch.

Local verification after dependency remediation: isolated `npm ci --ignore-scripts
--offline` succeeded; all 20 client/auth/layout tests passed under Vitest 4.1.12;
all 16 focused logo/error/bootstrap tests passed; npm audit reported zero known
vulnerabilities for production and development dependencies, and pip-audit reported
zero for pinned runtime constraints on 2026-11-04. Fixed npm Vite/source-map-js and
Vitest/mocker/tinypool findings, updated certifi/dnspython/urllib3, and removed unused
PyJWT after switching auth to opaque sessions. Audit output is a point-in-time
advisory check, not proof of absence of vulnerabilities. Current frontend build
and regression results are recorded in [the roadmap](../tasks/todo.md).

Verification on 2026-11-06 also used a fresh Python 3.13 virtual environment under
the operating-system temp directory: constrained installation and `pip check`
succeeded, then all 106 active-scope backend tests passed, including real local
PostgreSQL/Redis checks. An empty generated schema ran the complete migration
chain; a generated runtime role passed revision/privilege checks and table reads/
writes while `CREATE TABLE` failed with PostgreSQL insufficient-privilege code
42501. Generated schema and role were removed afterward. The checksum-verified
official gitleaks 8.30.0 binary scanned a temp copy of current tracked source
(1.59 MB) with the repository config and redaction enabled: no leaks found.
The CI container explicitly loads that config from its read-only repository mount.
The runtime advisory audit was refreshed with pip-audit 2.9.0 on 2026-11-06 and
again reported no known vulnerabilities across all pinned runtime constraints.

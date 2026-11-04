# Non-portfolio state contract

Screens, widgets and watchlists use canonical UUIDv4 IDs. Account public UUIDs
remain separate from internal integer user keys. A resource ID never grants
ownership; writes require the authenticated owner, and widget/screen/state
relationships are also enforced by composite PostgreSQL foreign keys.

`GET /user/layout` returns `revision` and an ETag. Each full replacement sends
the observed revision in its JSON payload; an optional `If-Match` must agree.
The server serializes saves per owner and returns the next revision. A stale
save returns 409 without committing changes. The browser serializes its saves
and reloads after failure, discarding already queued stale saves. Changes made
after that reload may be saved normally. Widget state requires an existing
owned widget; it cannot implicitly create a layout.

Limits: 50 screens, 200 widgets per layout, 500 symbols per watchlist, 64 KiB
per JSON state/preferences document and 10 nesting levels. Persistent user budgets are
100 watchlists, 500 table preferences and 100 settings keys (including the internal
active-screen key). Removed widgets' preferences are reclaimed with the layout save. Auth and user-state
request bodies are capped before JSON parsing. Global settings have explicit
server-side keys and value types; existing portfolio setting contracts remain
deferred. Widget preferences require an owned widget; page preferences use a
structured `(owner, scope type, scope ID, table ID)` unique key.

Run migrations with the migrator role before startup. Development state using
old owner-prefixed IDs is unsupported; no compatibility or old-data migration
is provided. Use a fresh development database for this contract. Local migration reconciliation adopted matching precreated tables and backed up
four older duplicate table-preference rows before retaining the newest per scope.
Portfolio tables and portfolio feature contracts remain unchanged.

Verification: `RUN_DATABASE_TESTS=1 python -m pytest
backend/tests/test_user_state_security.py` uses generated disposable PostgreSQL
schemas, covering two users, foreign IDs, atomic failures, preferences,
settings and competing layout saves. Frontend layout tests cover save ordering,
revision propagation and conflict recovery.

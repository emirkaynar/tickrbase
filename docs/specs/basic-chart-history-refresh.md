# BasicChart history refresh scheduling

Status: Implemented; tests added and source-reviewed, not executed at the user's request.
Date: 2026-10-08

## Scope and rationale

Replace fixed chart-history polling with a chart-local candle/session scheduler. Live ticks continue updating prices; periodic provider history remains necessary to reconcile completed candles and, later, historical volume. Zero volume is not a missing-data signal and does not trigger retries.

The pure planner lives in `src/widgets/BasicChart/historyRefresh.ts`. `hooks/useChartData.ts` owns a single scheduling timeout and uses the existing history, calendar, live-clock, and widget-cache services. No global scheduler, new dependency, API, database, or persistent widget setting is added.

## Policy

- Intraday intervals refresh at the selected candle boundary plus a five-second grace period. Use a provider candle's alignment only within its own session window; otherwise use the window start. Pauses, supplied early closes, and partial final candles are respected.
- Daily, weekly, and monthly intervals refresh at each regular session close, not at midnight or only at week/month end.
- Intersect existing history-request policy with advertised history sessions. US equities/ETFs stay regular-only; other recognized instruments can use supported extended windows. Overnight requires both advertised session support and `overnight_history: true`.
- Backend cache lifetimes remain unchanged: 60 seconds intraday, 600 seconds for higher intervals. Automatic requests wait until the latest of the event deadline, `last_updated + TTL + 1 second`, and the recovery floor. Missed/deferred boundaries collapse into one request.
- Make one best-effort settlement attempt 15 minutes after the final eligible session window. This offset is a bounded second look, not an assumed Yahoo delay or a guarantee that history is final.
- An attempted scheduled event is consumed even if history is stale, its timestamp is unchanged, or the existing transport retries fail. The next candle or final settlement is the normal recovery point; there is no closed-session retry loop. A fresh provider timestamp also absorbs older events already covered by that request.

## Lifecycle and calendar

- Initial loading is allowed when hidden. Later automatic work is suspended while hidden. Visibility resume and actual reconnection request one catch-up subject to the same cache/recovery floors. Initial/repeated `open` notifications do not count as reconnects.
- Overlapping triggers share an in-flight request when its fresh timestamp covers them; otherwise one deferred catch-up remains. Price ticks do not run the planner or rearm its timer.
- Preserve API transport retries. Authentication failures stop automatic scheduling; explicit manual refresh can retry. Other errors preserve usable prices and wait for the recovery floor.
- Refresh the calendar with the same timer, normally daily; failed maintenance waits one hour. Calendar-only maintenance does not request history or redraw unchanged bars. Preserve previously fetched historical sessions outside the renewed range.
- Track the actual fetched range separately from the calendar's reviewed horizon. Never treat an expired fetched range as proof the market is closed. Renew at horizon exhaustion; retain valid in-range candle boundaries without treating the horizon as a session close.
- Within trusted calendar coverage, holidays/closed periods wait for the next eligible event or maintenance. Missing/unknown calendar coverage uses the selected intraday interval (minimum 60 seconds) or 15 minutes for higher intervals, still respecting cache/recovery floors.
- Widget removal/unmount cancels scheduling; cache-token guards reject late responses and events. Scheduling metadata is ephemeral and follows the existing widget-cache lifetime.

## Unchanged and deferred

History/tick reconciliation, the initial 100-candle view with five bars of right space, and local pan/zoom behavior are unchanged. No viewport persistence is introduced.

[Historical volume data plumbing and the optional histogram/setting](basic-chart-historical-volume.md) are implemented separately; cross-widget request deduplication remains a follow-up. This scheduler does not infer provider finality, volume availability, or source delay.

## Validation

Deterministic planner tests cover cadence, cache floors, session windows, settlement, capabilities, horizons, holidays, and DST. Hook tests cover timer timing, hidden/resume/reconnect behavior, stale/unchanged responses, auth/error recovery, calendar-only maintenance, reconciliation, and widget lifetimes. Source review was performed; no tests, builds, diagnostics, or browser checks were run for this change.

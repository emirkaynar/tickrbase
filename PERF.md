# Frontend memory investigation

## Confirmed development leak

Chrome heap snapshots from an idle dashboard with one BasicChart grew from
49.79 MiB to 481.26 MiB in total node self-size. Chart and BarStore instance
counts stayed unchanged. Retaining paths led through `window.__PREFRESH__`
to the hot-refresh runtime's `lastSeen` map and old virtual DOM props/handlers.
These totals include native nodes; they are not JS-only heap readings.

`@prefresh/core` 1.5.9 recorded every rendered vnode without retiring previous
entries. The project overrides it to 1.5.11, which replaces per-instance entries
and clears them on unmount. Component hot-refresh remains enabled.

| Reproduction | Before | After | Verification |
| --- | --- | --- | --- |
| 10,000 renders of one component | 10,000 `lastSeen` entries | 1 entry; 0 after unmount | Installed runtime hooks, isolated Node reproduction |
| Chart deletion / logout | Retained bars restored even after eviction; late ticks/responses still applied | Evicted data is not restored; obsolete writers are ignored | `useChartData.test.ts`, ownership and layout tests |
| Quote polling with a stalled request for 45 seconds | 4 request starts | 1 request start | Fake-timer regression using the Lists polling helper |
| Removed Lists cells | Detached callbacks escaped element-based pruning | Obsolete callbacks and pending pulses are pruned independently | Lists lifecycle tests |
| Scroll-effect replacement during settling | Scrolling flag remained true after its timer was cancelled | Timer ref and scrolling flag are reset | Lists lifecycle tests |

The latter rows verify lifecycle behavior, not a measured browser heap reduction.
Post-change browser heap profiling remains outstanding. No production memory
plateau or CPU improvement is claimed from these tests.

## Cache ownership rules

- The layout activates cache ownership for every widget, including inactive screens.
- Temporary widget unmounts and screen switches preserve that ownership and data.
- Permanent widget/screen removal evicts registered caches for the affected IDs.
- Account changes invalidate ownership synchronously before publishing the new user.
- Session tokens reject old layout responses even before passive effect cleanup;
  widget tokens reject late prefetches, chart responses, and ticks.
- Prefetched widget state is consumed once. A late response cannot recreate an
  already-consumed entry.

## Outstanding work

1. History bootstrap failures can still retain an unbounded pending tick buffer.
2. Raw live ticks can remain in BarStore when history does not cover their buckets.
   Any compaction must preserve OHLC values and timestamp-aware snapshot replay;
   an arbitrary tick cap is not a safe fix.
3. Per-tick bar rebuilding, `series.data()` copies, and SymbolOverview full-series
   updates remain allocation/CPU candidates, not measured optimization wins.
4. Re-measure idle growth and create/delete cycles in-browser after a fresh dev
   server/page reload. Record comparable durations, GC conditions, and retaining
   paths before attributing any remaining growth.

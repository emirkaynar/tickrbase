# BasicChart historical volume

Status: Data plumbing, optional histogram, and setting implemented and source-reviewed. Tests added, not executed at the user's request.
Date: 2026-10-09

## Implemented data contract

`Bar.volume?: number | null` carries the provider-reported volume for the requested interval. Positive values, zero, explicit null, and absence remain distinct. Zero alone does not prove either genuine zero trading or unavailable Yahoo data: yfinance normalizes missing source volume to zero.

The existing Yahoo provider, database history cache, and history response already carry nullable volume. No backend, API, database, dependency, migration, or additional request is needed for this increment.

## Reconciliation

- Historical candles retain their reported volume through the frontend history and widget-cache paths.
- Price ticks update OHLC only. They retain the matching candle's last reported history volume; that value does not become realtime or finalized volume merely because its price has changed.
- A tick-only candle has no volume field. Do not inherit a neighboring candle's volume, use quote-level daily totals, or invent zero.
- A refreshed historical candle replaces its previous volume, including positive-to-zero/null/absent changes. Existing source isolation, gap repair, session filtering, and post-snapshot price replay remain unchanged.
- The chart caches raw filtered bars. OHLC/Heikin-Ashi rendering projections do not supply volume; the histogram uses the original bars.

History refresh timing remains governed by [the candle/session scheduler](basic-chart-history-refresh.md). There are no retries triggered by zero or absent volume.

## Optional histogram and setting

- **Volume → Display** uses the existing widget-scoped Select with **Off**, **Overlay** (default), and **Pane**, immediate application, automatic saving, and Reset behavior. No additional tab or state owner is added. The setting stores a string mode; no boolean compatibility or migration code is added.
- One native Lightweight Charts 5.2.0 histogram series is created lazily. **Pane** retains a separate pane with approximately 20% of the plot's relative height. **Overlay** places bars in the bottom 20% of the price pane on a separate hidden `volume` scale, without changing the price scale's margins or autoscaling. Native sizing handles widget resizing. Switching modes replaces only the histogram; removing a separate histogram pane removes its empty pane, never the main pane. Chart removal owns final cleanup.
- The histogram uses provider-reported volume for the requested interval and raw, session-filtered candles. Up/down colors compare raw close with open, including in Heikin-Ashi mode, and use approximately 30% opacity to stay quieter than price candles. Theme changes recolor existing points without recreating the pane.
- Require at least one positive finite volume in the loaded history before displaying volume in either mode. This is a display threshold, not a claim that zero proves unavailable data. All-zero/missing history and initial loading do not display a histogram. No volume overlay text or status labels are rendered.
- Keep zero values in mixed history. Missing, null, negative, and nonfinite values are native whitespace points, not fabricated zero bars. Live price ticks only update the last point using the volume already retained by reconciliation; they do not scan history or create a pane from tick-only data.
- Volume has its own autoscaled normal scale and native volume formatting; price logarithmic/percentage modes remain price-only. Overlay has no volume axis labels; Pane retains native volume axis values. Both modes share the chart's native time scale/crosshair.
- Preference edits use cached bars without replacing the history callback or triggering a request. Full updates/add/remove preserve the local logical range; live updates use `series.update`. The initial 100-candle/five-bar-right-space view and lack of viewport persistence remain unchanged.

## Validation

Added source-reviewed reconciliation tests for value distinctions, newer ticks, authoritative revisions, gap repair, source changes, daily/weekly candles, regular-session filtering, and input immutability. Hook coverage includes initial buffered prices, temporary remounts, and scheduled history reconciliation without refitting or extra requests. No tests, builds, diagnostics, or browser checks were run.

Added source-reviewed histogram tests for positive/zero/missing/invalid values, lazy creation/removal, instance ownership, normal scale, relative pane sizing, independent overlay scaling, all display-mode transitions, theme recoloring, incremental live updates, and logical-range preservation. Hook/composition tests cover cached-data toggles and reset, stable history dependencies, raw/session-filtered candles, owner changes, widget isolation, cache-token guards, and absence of volume overlay text. Native APIs were checked against installed Lightweight Charts 5.2.0 typings and relevant source; no tests, builds, diagnostics, or browser checks were run.

Neither positive volume nor a successful history response proves finality. No realtime forming-candle volume or index/extended-session completeness is claimed. Research evidence remains in [the yfinance investigation](../research/yfinance-volume-2026-10-08/README.md).

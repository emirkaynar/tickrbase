# BasicChart visible highest / lowest

Status: Implemented and source-reviewed. Tests added, not executed at the user's request.

## Objective

Match the supplied reference with two muted price labels beside the highest and lowest points currently in the price chart's horizontal viewport. Labels read `H: <price>` and `L: <price>`; no full-width guides, markers, or price-axis badges are added.

## Behavior and acceptance criteria

- **Visual → Labels → Highest / Lowest** is a boolean preference, enabled by default, using the existing widget-scoped Switch and immediate/autosaved settings path. Reset restores the default.
- Candle and bar charts use plotted high/low values. Heikin-Ashi uses the plotted synthetic highs/lows. Line, area, and baseline charts use their plotted closing-price values. Volume and extended-session quote annotations do not participate.
- Include actual price points whose logical centers are within the visible horizontal range. Skip chart-wide whitespace/gap indices using native lookup; never equate a series array offset with a chart-wide logical index.
- Ties pick the first visible occurrence. Ignore nonfinite price values. Empty/no-data ranges show no labels.
- Labels track native time/price coordinates during pan, zoom, live updates, history revisions, price-scale changes, resizing, and volume-mode changes. Format original prices with the price series formatter, including in LOG/% mode.
- Place labels above/below their points, flipping horizontal placement near the right edge and keeping text inside the price pane. Respect inverted scales. Hide vertically offscreen points rather than pinning a misleading price annotation to the edge.
- Use existing theme colors and chart typography. Labels are noninteractive native canvas decorations and do not obscure chart input.

## Implementation and boundaries

- A native Lightweight Charts 5.2.0 series primitive in `src/widgets/BasicChart/visibleExtrema.ts` attaches only to the price series while enabled. Follow the existing `SessionLines` primitive pattern.
- Use public `dataByIndex`, `timeToIndex`, `timeToCoordinate`, and `priceToCoordinate` APIs. Cache extrema between data/range changes; only examine actual points in the visible range, not the whole history on every redraw.
- `BasicChart.tsx` owns attachment (keyed on chart type and the setting), theme refresh, and cleanup. When the chart or series was already replaced, the primitive is detached locally instead of through the removed series. No changes to the history callback or fetch dependencies.
- No autoscale override, range setters/subscriptions for persistence, timers, backend changes, dependencies, migrations, shared event bus, or drawing ecosystem.
- Preserve the user's current settings tabs, volume default, opacity, and other chart styling.

## Testing and validation

Vitest tests under `src/widgets/BasicChart/__tests__` cover bounded native lookup, gaps/fractional and empty ranges, ties, invalid prices, candle/single-value points, live/history invalidation, cached redraws, theme/scale/size changes, label clipping/placement, instance ownership, cleanup, and settings/lifecycle integration.

Per the standing user restriction, no tests, builds, terminal commands, diagnostics, or browser checks are executed. Source review is not runtime or compiler verification.

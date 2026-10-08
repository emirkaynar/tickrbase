# Widget settings framework

## Approved scope

Optional per-instance widget preferences with immediate application and automatic database saving. BasicChart is the first adopter. Shared UI uses Ark Popover and Tabs, the existing Select, and a reusable Ark Switch styled from SettingsPage.

The compact popover follows the supplied reference: title and right-aligned Reset action, a visible tab strip even for one tab, muted group headings, and label/control rows. BasicChart begins with one tab named **Graphic**. No Details or Debug tab is exposed. A future Debug tab may be gated by a global setting; neither it nor its toggle is implemented in this phase.

## Ownership

- `Shell` accepts an optional settings contract and places an ellipsis action before Remove. Widgets without settings are unchanged.
- Widget-local definitions describe ordered tabs, groups, boolean/select controls, labels, defaults and allowed values. Array order is display order.
- Shared modules under `src/widgets/settings` own presentation and the per-instance state store. BasicChart definitions remain under `BasicChart/settings`.
- Database/API remain `user_widget_states` and `/user/widgets/{id}/state`. No new table or endpoint.
- One state owner handles a migrated widget's symbol, interval, existing arbitrary state and settings. Other widgets retain their current implementations until individually migrated.
- User-global settings remain separate. The shared Switch also replaces SettingsPage's inline switch without changing save semantics.

## Persistence

The existing PUT replaces the complete payload, so all BasicChart writes use one owner. New preferences live in `state.settings`; updates retain unrelated state and unknown setting keys.

- Hydrate before permitting edits. Missing/invalid known preferences use existing-appearance defaults.
- Loading never saves defaults. A failed load leaves preferences read-only with Retry; market data may still display using fallback preferences.
- User edits apply immediately. Writes coalesce for 250ms and serialize complete payloads, including the API's retries.
- A failed save retains local values and exposes Retry. No false success indication.
- State and pending writes survive ordinary widget remounts. Permanent removal/logout disposes stores and aborts pending requests.
- Reset replaces only exposed preferences with defaults; ticker, interval, chart type, scale mode, the current in-memory viewport and unrelated state remain intact.
- Pan and zoom remain local to the chart. Loading a chart or changing its ticker/interval shows the latest 100 candles with five bars of right-side space. Fewer than 100 candles leave unused space on the left. Live updates and preference edits do not repeatedly reset that initial window.
- Concurrent editing of the same instance from multiple browser tabs/devices is outside this version's conflict-resolution scope. Closing the browser before a pending save completes is not guaranteed to preserve that edit.

## Initial BasicChart settings

| Group  | Setting          | Values/default                                                           |
| ------ | ---------------- | ------------------------------------------------------------------------ |
| Cursor | Crosshair        | Free, Snap to close (default), Snap to OHLC, Off                         |
| Volume | Display          | Off, Overlay (default), Pane; historical non-zero data required          |
| Labels | Highest / Lowest | On (default), Off; see [visible extrema](basic-chart-visible-extrema.md) |
| Grid   | Horizontal lines | On, Off (default)                                                        |
| Grid   | Vertical lines   | On, Off (default)                                                        |

Settings popovers and their nested Select machines use explicit widget-scoped IDs. Select dropdown positioning is memoized and uses a direct trigger ref with fixed positioning, avoiding generated-ID anchor lookup across portal/widget instances.

Cursor/grid settings use native chart/series options without recreating price series or resetting the viewport. The Highest / Lowest switch attaches a native price-series primitive without touching data, scales, or the viewport. The volume display select owns a lazy native histogram, either on a hidden independent overlay scale or in a separate pane, and preserves the local logical range; see [historical volume](basic-chart-historical-volume.md). Regular last-price lines/labels and custom extended-session annotations keep their default visibility. Previously saved `lastPriceLine` and `lastPriceLabel` toggles are ignored. Theme, interval and chart-type changes preserve the exposed preferences.

The floating summary and pinned status tooltip remain. The previous ChartDetailsPopover implementation is not mounted; its existing source is retained for the deferred Debug work.

## Deferred

Indicators and their separate entry point; drawings; global preference inheritance; applying defaults across widget instances; custom settings editors; Debug content/global gate; migration of all other widgets.

## Validation

Regression tests added for hydration, replacement-safe saving, coalescing/serialization, failures/retry, remount lifetime, per-instance isolation, reset/defaults, control wiring and native chart settings. Existing wrapper tests updated for shared Switch and the new chart composition.

Per the user's instruction, tests, builds and browser checks are not executed during this implementation. Source review is not runtime verification.

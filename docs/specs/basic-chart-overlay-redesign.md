# BasicChart overlay redesign

Status: Implemented and revised after manual feedback. Earlier automated validation passed; latest revisions are not revalidated because the user requested no further test runs.
Date: 2026-10-08
Source of truth: This repository document. Memory stores only a pointer and summary.

## Objective

Make each single-ticker BasicChart widget easy to read at a glance: instrument identity, latest quote, current market session, and data delay. Keep controls in the handle and move detailed market/feed information out of the plot into an on-demand panel.

The user approved a floating summary and latest-quote-only pricing. Comparison symbols may be added in the future, but are outside this redesign.

## Approved layout

Illustrative values, not fixtures or prescribed instrument metadata:

```text
ASELS ▾          drag area          1D ▾  Candles ▾  ⋯  ×
───────────────────────────────────────────────────────
Aselsan Elektronik · BIST  (● D)
123.45 TRY  +1.24%

                         chart
                                               LOG  %
```

### Handle

- Keep the ticker selector, interval selector, chart-type selector, and remove button.
- Remove price and percentage change from the ticker-selector trigger.
- Add a reusable widget-options ellipsis button immediately before Remove.
- Preserve the existing ticker selection behavior and usable drag area. Display formatting must not change the canonical symbol used for requests, subscriptions, or persistence.

### Floating summary

- First row: full instrument name, exchange, and market-status pill, all on the same row.
- Second row: latest price, currency, and percentage change.
- Use stronger emphasis for the name than the exchange; make price the most prominent value and use tabular digits.
- Use a single restrained background on marketOverlay; identity and price rows do not have separate backgrounds. No heavy border or large card treatment.
- At narrow widths, truncate the name before sacrificing the exchange or status pill. Expose the full name in a tooltip; do not wrap the pill onto another identity row.
- Preserve space for the price scale and existing LOG/% controls.
- Passive summary areas must not unnecessarily block chart gestures. Interactive pills/buttons must not initiate chart gestures or widget dragging.
- Price remains the latest accepted quote, never the crosshair/hovered candle price. Preserve current previous-close percentage calculation and currency formatting.

## Market-status pill

Compact pill containing a session-colored dot and, when the latest accepted source timestamp lags by more than 60 seconds during an active/non-closed state, a `D`. Warning icons share this same pill rather than using a separate button. A short countdown can appear after D and before the warning icon. No always-visible session text, quote-age counter, or session timeline graph.

| Session | Dot direction | Delay marker |
| --- | --- | --- |
| Regular | Green | `D` only for known positive delay |
| Pre-market | Distinct cool color, e.g. blue | Same rule |
| Post-market | Distinct warm color, e.g. amber | Same rule |
| Verified overnight | Distinct color, e.g. violet | Same rule |
| Closed | Muted gray | Same rule |

Exact non-regular colors are implementation choices to validate in both themes using existing tokens where possible. Color alone must not communicate state: accessible labels and tooltips carry the full meaning.

### Imminent-transition countdown

- Show only for verified calendar transitions strictly less than 15 minutes away and still in the future. Use synchronized market time and the existing overlay timer, independently of quote delay.
- Format whole minutes rounded down: `14m to open`, `4m to close`, or `<1m to open` in the final minute; never display `0m` or seconds.
- Name an adjacent destination session: `to open`, `to pre`, `to post`, or `to overnight`. Without an adjacent destination, regular sessions use `to close` and extended sessions use `to end`.
- Closed markets count down to the next supplied session opening. Unknown calendars, unverified activity, and transitions outside calendar coverage show no countdown. A supplied closing endpoint may equal the coverage endpoint; an opening may not.
- Layout: dot → D → countdown → warning, omitting absent segments. Keep a single tooltip-toggle button, full-height separators, and transparent dot-only styling.
- Countdown text, tinted background, and subtle four-second background-only pulse use the upcoming session's normal dot color: regular green, pre-market amber, post-market blue, overnight accent. Closing/ending without an adjacent destination uses danger red. Disable the animation for reduced-motion preferences.
- Use one tooltip anchored to the whole pill on hover and keyboard focus. Explain the session, delay, countdown, and warnings in matching order; no separate segment tooltips. The button's accessible label includes the transition meaning without an aria-live announcement loop.

### Tooltip content

Use compact title/subtitle groups, with circular tinted markers aligned to their title line. Titles use semantic colors; subtitles are smaller and muted, aligned directly beneath the title. Put closing/ending timing under the current session. Fold regular-opening countdowns into Market closed (`Opens in 4m`) or Pre-market (`Market opens in 4m`) instead of creating a duplicate upcoming group. Add a separate upcoming-session group only for a different extended destination, including verified overnight: e.g. Post-market / Ends in 4m, then Overnight session / Starts in 4m. Delay is a standalone title (`15m delayed`), or muted `Delay unknown`. Group warnings under a meaningful connection/history title when identifiable, otherwise Data warning. Do not show a session-range/timezone footer in the pill tooltip; those facts remain in Chart details, including both dates for overnight windows that cross midnight. Keep unverified overnight activity unknown; never infer its schedule. The tooltip explains the pill. Clicking or keyboard-activating the pill pins its Ark tooltip open; activate again, click outside, or press Escape to dismiss. Hover/focus still show it normally. Keep pinning local to BasicChart; other tooltips remain unchanged. The ellipsis is the only chart-details trigger.

- Session label: Market open, Pre-market, Post-market, Overnight session, or Market closed.
- Observed source-timestamp lag: for example, `Market open · 15m delayed`. Calculate from the latest accepted tick's trusted source timestamp and the synchronized market clock; do not assume Yahoo supplies a delay field or hardcode exchange delays. Under/at 60 seconds is treated as current. Round the displayed lag down to whole minutes. Closed-market idle quote age does not produce D.
- Time remaining in the current session window when known.
- Keep the current session's full time range and exchange timezone in Chart details, not the pill tooltip.
- For closed markets, show the next opening when the calendar actually supplies it. Do not mistake an arbitrary next boundary for an opening.
- Example:

```text
● Market open
  Closes in 2h 14m

D 15m delayed
```

Delayed and non-delayed tooltips retain the same useful session timing information. Session windows must respect breaks and calendar coverage; do not synthesize schedules outside known coverage. Refresh timing while visible without screen-reader announcements every second.

### Loading, unknown, and failures

- Hide the entire summary during initial loading and ticker changes, then reveal it with a short opacity fade when usable data for the selected instrument is available.
- Do not require a live tick to reveal a valid snapshot: closed markets and disconnected feeds may still have usable quotes.
- Clear the previous instrument's summary immediately on a ticker change. Late responses must not mix old identity with new pricing.
- Once usable instrument/quote data is available, missing session metadata must not hide the summary indefinitely. Show name/price and omit the normal session pill; explain missing metadata in the details panel.
- Fall back to the canonical symbol if the full name cannot be resolved. Do not fabricate a name or exchange.
- Missing delay metadata is not proof of real-time data. An unmarked dot must not produce a confident real-time assertion; tooltip/details must communicate unknown delay where relevant.
- Respect reduced-motion preferences. Quote updates must not retrigger the entrance fade.

### Feed health is separate

- The session dot describes the market, not connection health.
- Show a compact warning indicator beside the pill/identity row for connection failures, stale quotes/history, or applicable data warnings. Replace the current always-visible stack of notice paragraphs.
- Explain actionable connection/history-error warnings in the combined pill tooltip; clicking the pill pins the tooltip, not the details panel. Routine Stale quote, Stale history, and Overnight history unavailable no longer create a visible warning; retain freshness and overnight coverage as diagnostic information.
- Delayed data and stale data may coexist; do not suppress one with the other.
- A closed market is not inherently a failed feed.
- Preserve the distinction between a verified overnight session and unverified off-session/overnight activity. Never render unverified activity as an authoritative overnight session.

## Widget details and options

### Shared action button

Add `WidgetOptionsButton` alongside `WidgetRemoveButton` in `src/ui/WidgetActions/WidgetActions.tsx` and expose it through the existing UI export convention.

- Share existing widget-action styling and use the existing icon dependency.
- Provide an accessible label such as `Chart details and options` for this widget.
- Support composition as an Ark trigger, including required props/ref forwarding.
- Keep chart-specific data and panel state out of the shared button.
- Do not call it a menu button when it opens a popover.
- Preserve the existing Shell/removal behavior; avoid a generic widget-settings framework.

### Ark Popover

Use a non-modal Ark Popover, not menu semantics, because the content combines information, explanations, and actions.

- Header ellipsis opens the panel. The status pill and its warning indicator only toggle the persistent tooltip; they do not open details.
- Title: `Chart details`.
- Portal outside the chart's overflow-clipped container. Position within the viewport and allow scrolling when necessary.
- Match Lists' positioning pattern: memoized fixed positioning with an explicit header-button anchor, viewport shift/flip, and detached-anchor hiding. Keep lazy-mounted content mounted after closing so subsequent opens reuse the same panel lifecycle.
- Support keyboard activation, Escape/outside dismissal, visible focus, and focus restoration to the invoking control.
- Ensure tooltip and popover composition does not introduce nested buttons or conflicting triggers.

Content organization:

1. **Market & data:** source, exchange, session, delay, display timezone, exchange timezone/time, next transition, and relevant extended-session quote including stale state.
2. **Diagnostics (expandable):** quote age, source timestamp, last receipt, connection, history refresh time, history-session coverage, clock synchronization/offset, and all applicable warnings, including overnight-history availability.
3. **Action:** Refresh history, preserving current behavior.

Retain the existing intraday session-boundary legend somewhere appropriate in this panel. Preserve useful existing information rather than discarding it during the visual simplification.

Future widget-specific settings can become a separate section when implemented. Do not add empty Settings tabs or speculative controls.

## Existing implementation and constraints

- `src/widgets/BasicChart/BasicChart.tsx`: quote state, ticker trigger, chart lifecycle, and Shell composition.
- `src/widgets/BasicChart/BasicChart.module.css`: widget and chart-container styling.
- `src/widgets/BasicChart/components/MarketStatusOverlay.tsx`: floating identity/quote summary and compact session/warning controls.
- `src/widgets/BasicChart/components/ChartDetailsPopover.tsx`: Ark Popover, market clock/connection presentation, details, diagnostics, and refresh action.
- `src/widgets/BasicChart/components/MarketOverlay.module.css`: summary and details styling.
- `src/widgets/BasicChart/hooks/`: chart state/data, extended price label, quote snapshot, and instrument identity hooks. This local organization was explicitly requested during implementation; no widget-specific code moves to global components/hooks folders.
- `src/widgets/BasicChart/marketStatus.ts`: session/age/delay derivation. Its current missing-delay fallback must not become an unsupported real-time assertion.
- `src/widgets/BasicChart/__tests__/`: existing chart/session tests.
- `src/ui/WidgetActions/WidgetActions.tsx`: shared widget action controls.
- `src/ui/TickerSelector/TickerSelector.tsx`: lookup results contain company name/exchange, but selection currently returns only the symbol.
- `src/services/types.ts`: lookup/overview types contain name metadata; MarketContext does not contain a company name.
- `src/widgets/Lists/Lists.tsx`: existing Ark Popover usage to consult for project conventions.

Resolve instrument metadata on persisted-widget reload as well as fresh selection. Reuse existing lookup/cache patterns where suitable; carrying metadata only from selection is insufficient. Verify the actual lookup path before choosing an implementation. Keep canonical exchange identifiers for session logic separate from human-readable exchange labels.

Stack: Preact/TypeScript, CSS modules, lightweight-charts v5, Ark UI React components via existing project compatibility, and lucide-react. Reuse installed dependencies.

### Percentage scale

- The `%` control uses native `PriceScaleMode.Percentage`, relative to the first visible value. Panning/zooming can change this reference.
- Keep candles and extended-session price guides in raw price coordinates; the chart handles percentage conversion and labels.
- The overlay's daily change remains relative to previous close. Previous close also retains its existing baseline-chart role, but is not used for percentage-scale formatting.
- Switching scale modes must not recreate the series or its extended-price annotation. Reapply the selected mode when chart type changes create a new series.
- The control's tooltip explains the first-visible-value reference and its pressed state is accessible.

## Code style

Follow existing named components, typed props, Preact hooks, CSS modules, theme tokens, and four-space indentation. Example of the existing shared-action pattern:

```tsx
type RemoveProps = BaseProps & {
    onClick: () => void;
};
```

Use small focused presentation components if useful; do not refactor chart lifecycle or feed infrastructure as part of the redesign.

## Verification commands

Run from the repository root using the existing package scripts:

```sh
npm test -- src/widgets/BasicChart/__tests__
npm test
npm run build
```

`npm run build` includes TypeScript checking. There is no lint script in the current package manifest. For manual browser verification, use the project's existing Vite workflow (`npm run dev`); starting a development server is a separate runtime step, not part of saving this spec.

## Acceptance criteria and testing strategy

Use Vitest for state derivation/regressions and available component-test patterns for interaction tests. Verify visual and gesture behavior in a real browser.

- [ ] Handle contains no price/change; ticker selection and dragging still work.
- [ ] Name, exchange, and pill occupy one row; latest price/currency/change occupy the second.
- [ ] Full name resolves after both selection and persisted reload; unavailable metadata has truthful fallbacks.
- [ ] Regular, pre, post, verified overnight, and closed states have correct labels/colors; unknown and unverified states do not claim certainty.
- [x] Positive, zero, and unknown delay are tested; no hardcoded 15-minute assumption or unknown-as-real-time assertion.
- [x] Tooltip content derives valid remaining time/session ranges with exchange timezone, including breaks and calendar limits (unit-tested; browser tooltip access pending).
- [x] Initial loading and ticker switching never expose mixed-instrument identity/price; valid snapshots work without live ticks (hook and composition tests).
- [ ] Summary fades in once ready and respects reduced motion; normal ticks do not animate its entrance.
- [x] Connection/staleness warnings are represented independently of session/delay state (presentation tests; browser discoverability pending).
- [ ] Shared options button opens one correctly labelled popover; existing details, applicable notices, legend, and refresh action remain available.
- [ ] Keyboard focus, tooltip access, dismissal, and focus restoration work from each invoking control.
- [ ] At minimum widget size and with long names, summary and popover do not clip important content or obstruct scales/controls.
- [ ] Both themes, chart pan/zoom, widget drag/remove, selectors, and LOG/% behavior are verified.
- [x] Existing chart/session tests and production build pass; Vite large-chunk warning documented.

## Boundaries

- Always: preserve accepted quote-source/timestamp semantics, formatting, subscription/persistence behavior, truthful uncertainty, accessibility, and existing useful diagnostics.
- Ask first: new dependencies, backend/API changes, changes to session/feed policies, or expanded widget settings scope.
- Never: implement comparison symbols, OHLC-on-hover, a session timeline graphic, relocate LOG/% controls, redesign other widgets, or add empty future-settings scaffolding in this change.

## Implementation notes and manual checks

- Identity uses exact canonical-symbol matches from the existing lookup endpoint, with a bounded 24-hour successful-result cache. Exchange labels are supplied by lookup, falling back to the calendar exchange code; no guessed mapping is introduced.
- Readiness accepts a current-symbol quote snapshot (even a null-price snapshot, displayed as Quote unavailable) or accepted tick. Previous-symbol responses and metadata are gated immediately.
- A usable quote is no longer covered by history loading/error overlays. History errors are exposed as details/warnings instead when quote data is available.
- Delay is detected from the last accepted tick's trusted source stamp. No tick or receipt/synthetic timestamp means unknown; provider delay metadata is not used. This is observed quote lag, not a guaranteed exchange/provider delivery delay, and a quiet active symbol can have an old last-trade stamp. No backend provider-policy mapping was added.
- Quote request lifetime depends on ticker/readiness, not scale-formatting callback identity. LOG/% changes retain metadata.
- Manual feedback exposed a concrete anchor issue: the Tooltip wrapping Ark's header trigger could overwrite its trigger id. The header now uses ArkPopover.Trigger directly around WidgetOptionsButton, with a native title instead of nested tooltip trigger composition.
- The installed Ark version lacks the newer finalFocusEl/multiple-trigger API. One registered header trigger anchors the panel; pill/warning controls open the same controlled popover. Escape/Close and blank-chart dismissal restore the actual invoker, while a focusable outside target keeps focus. Verify this composition and non-modal tab behavior manually.
- Session colors use existing success, blue, amber, accent, and muted tokens. Verify both themes, truncation/minimum size, gesture handling, tooltips, fade/reduced motion, and scale controls manually.
- Snapshot source_timestamp is treated as milliseconds, consistent with live timestamps; the current producer does not populate it. Confirm that contract before a future provider supplies source timestamps.

## Validation record

- Earlier automated coverage included session windows/delay uncertainty, identity lookup/cache/cancellation, quote readiness/ticker switches/callback changes, data ownership/warning reset, summary structure, and history loading/error composition. Delay assertions were updated to the revised source-timestamp rule without running them, per the user's instruction.
- Before these manual-feedback revisions: full suite 202 tests passed across 22 files (`npm test`); focused BasicChart suite 119 tests passed across 11 files. These results do not validate the latest revisions.
- Before these revisions: TypeScript and Vite production build passed (`npm run build`). Latest revisions were not built or tested, per user request.
- Whitespace validation: `git diff --check`.
- Browser acceptance has not been completed by the agent; the user elected to test manually. Do not treat the visual/keyboard acceptance criteria above as verified solely by Node tests.
- Production build reports Vite's large-chunk warning; bundle splitting is outside this redesign.

Implementation was explicitly authorized after the design/spec discussion. No new dependencies, commits, or branches are part of this work. Update this document if agreed requirements change.

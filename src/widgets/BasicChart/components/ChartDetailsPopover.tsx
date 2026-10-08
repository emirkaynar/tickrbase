import type { ComponentChildren, JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Popover as ArkPopover } from "@ark-ui/react/popover";
import { Portal } from "@ark-ui/react/portal";
import { XIcon, RefreshCw } from "lucide-react";
import { WidgetOptionsButton } from "../../../ui";
import { livePricesClient } from "../../../services/livePrices";
import type { useChartData } from "../hooks/useChartData";
import type { ChartQuote } from "../hooks/useChartQuote";
import type { InstrumentIdentity } from "../hooks/useInstrumentIdentity";
import { formatAge, marketCountdown, marketStatus, marketTooltip } from "../marketStatus";
import { extendedQuote } from "../sessionPolicy";
import { MarketStatusOverlay } from "./MarketStatusOverlay";
import styles from "./MarketOverlay.module.css";

type Props = {
    id: string;
    symbol: string;
    identity: InstrumentIdentity;
    data: ReturnType<typeof useChartData>;
    quote: ChartQuote;
    timezone: string;
    warning: string;
    intraday: boolean;
    children: (overlay: ComponentChildren, options: ComponentChildren) => JSX.Element;
};

export function ChartDetailsPopover({ id, symbol, identity, data, quote, timezone, warning, intraday, children }: Props) {
    const [open, setOpen] = useState(false);
    const [now, setNow] = useState(() => livePricesClient.now());
    const [connection, setConnection] = useState(livePricesClient.getStatus());

    const optionsRef = useRef<HTMLButtonElement | null>(null);
    const positioning = useMemo(() => ({
        placement: "bottom-end" as const,
        strategy: "fixed" as const,
        gutter: 8,
        shift: 8,
        flip: true,
        hideWhenDetached: true,
        getAnchorElement: () => optionsRef.current,
    }), []);
    const returnFocusRef = useRef(false);
    const outsideTargetRef = useRef<EventTarget | null>(null);
    useEffect(() => {
        const timer = window.setInterval(() => setNow(livePricesClient.now()), 1000);
        const off = livePricesClient.onStatus(setConnection);
        return () => { window.clearInterval(timer); off(); };
    }, []);
    useEffect(() => { setOpen(false); returnFocusRef.current = false; }, [symbol]);

    const ownData = data.dataSymbol === symbol;
    const context = ownData ? data.marketContext : null;
    const tick = data.lastTick?.symbol === symbol ? data.lastTick : null;
    const coverage = ownData ? data.coverage : null;
    const status = marketStatus(context, tick, coverage, now);
    const countdown = marketCountdown(context, status, now);
    const tooltip = marketTooltip(context, tick, coverage, now);
    const extended = extendedQuote(context, tick, now);

    const notices = [
        connection !== "open" ? connection === "error" ? "Connection error" : connection === "reconnecting" ? "Reconnecting" : connection === "connecting" ? "Connecting" : "Disconnected" : null,

        ownData ? warning || null : null,

    ].filter((notice): notice is string => Boolean(notice));
    const exchange = identity.exchange ?? context?.exchange ?? null;
    const detailsId = `chart-details-${id}`;

    const timestamp = (ms: number | null | undefined, zone = timezone) => ms == null || !Number.isFinite(ms) ? "Unknown" : new Intl.DateTimeFormat("en-GB", {
        timeZone: zone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).format(new Date(ms));
    const offset = livePricesClient.getClockOffset();
    const snapshotTimestamp = quote.snapshot?.timestamp_origin === "source" ? quote.snapshot.source_timestamp : null;
    const sourceTimestamp = tick ? tick.timestamp_origin === "source" ? tick.ts : null : snapshotTimestamp;
    const snapshotAge = sourceTimestamp == null ? null : (now - sourceTimestamp) / 1000;
    const age = tick ? status.age : snapshotAge !== null && Number.isFinite(snapshotAge) && snapshotAge >= -5 ? Math.max(0, snapshotAge) : null;

    const overlay = <MarketStatusOverlay
        key={symbol} symbol={symbol} name={identity.name} exchange={exchange} quote={quote}
        tooltip={tooltip} delayed={status.delayed} delaySeconds={status.delaySeconds} countdown={countdown}
        notices={notices}
    />;
    // Both the popover and the button's tooltip use explicit refs to avoid trigger-id collisions.
    const options = <ArkPopover.Trigger asChild>
        <WidgetOptionsButton ref={optionsRef} title="Chart details and options" onClick={() => { outsideTargetRef.current = null; }} />
    </ArkPopover.Trigger>;

    return (
        <ArkPopover.Root
            open={open} onOpenChange={details => setOpen(details.open)}
            ids={{ content: detailsId }}
            positioning={positioning}
            onEscapeKeyDown={() => { returnFocusRef.current = true; }}
            onInteractOutside={event => {
                outsideTargetRef.current = event.target;
                returnFocusRef.current = true;
            }}
            onExitComplete={() => {
                if (!returnFocusRef.current) return;
                returnFocusRef.current = false;
                // Preserve outside control focus; return to the header after blank-chart dismissal.
                requestAnimationFrame(() => {
                    const target = outsideTargetRef.current;
                    outsideTargetRef.current = null;
                    if (target instanceof Element && target.closest("button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1']), [contenteditable='true']")) return;
                    optionsRef.current?.focus();
                });
            }}
            lazyMount
        >
            <>
                {children(overlay, options)}
                <Portal>
                    <ArkPopover.Positioner className={styles.popoverPositioner}>
                        <ArkPopover.Content className={styles.marketDetails} onPointerDown={event => event.stopPropagation()}>
                            <div class={styles.detailsHeader}>
                                <div>
                                    <ArkPopover.Title className={styles.detailsTitle}>Chart details</ArkPopover.Title>
                                    <ArkPopover.Description className={styles.detailsSymbol}>{symbol}</ArkPopover.Description>
                                </div>
                                <ArkPopover.CloseTrigger className={styles.closeButton} aria-label="Close chart details" onClick={() => { returnFocusRef.current = true; }}><XIcon size={14} /></ArkPopover.CloseTrigger>
                            </div>
                            <section class={styles.detailsSection} aria-label="Market and data">
                                <h3>Market & data</h3>
                                <dl>
                                    <dt>Source</dt><dd>{(ownData ? data.source : null) ?? quote.snapshot?.source ?? "Unknown"}</dd>
                                    <dt>Exchange</dt><dd>{exchange ?? "Unknown"}{context?.exchange && context.exchange !== exchange ? ` (${context.exchange})` : ""}</dd>
                                    <dt>Session & delay</dt><dd>{tooltip.title}</dd>
                                    {tooltip.timing && <><dt>Session timing</dt><dd>{tooltip.timing}</dd></>}
                                    {tooltip.range && <><dt>Session range</dt><dd>{tooltip.range}</dd></>}
                                    {!tooltip.session && <><dt>Calendar</dt><dd>Session metadata unavailable or unverified</dd></>}
                                    {extended && <><dt>{extended.kind.toUpperCase()} price</dt><dd>{extended.price.toFixed(2)}{extended.stale ? " · Stale" : ""}</dd></>}
                                    <dt>Display timezone</dt><dd>{timezone}</dd>
                                    <dt>Exchange timezone</dt><dd>{context?.exchange_timezone ?? "Unknown"}</dd>
                                    <dt>Exchange time</dt><dd>{context?.exchange_timezone ? timestamp(now, context.exchange_timezone) : "Unknown"}</dd>
                                    <dt>Next transition</dt><dd>{timestamp(status.next === null ? null : status.next * 1000)}</dd>
                                </dl>
                            </section>
                            {notices.length > 0 && <ul class={styles.detailsNotices}>{notices.map(notice => <li key={notice}>{notice}</li>)}</ul>}
                            <details class={styles.diagnostics}>
                                <summary>Diagnostics</summary>
                                <dl>
                                    <dt>Source quote age</dt><dd>{age === null ? "Unknown" : formatAge(age)}</dd>
                                    <dt>Delay detection</dt><dd>Source timestamp lag · 60s tolerance</dd>
                                    <dt>Quote freshness</dt><dd>{status.stale || (!tick && quote.snapshot?.stale) ? "Stale" : "No staleness reported"}</dd>
                                    <dt>History freshness</dt><dd>{ownData ? data.historyStale ? "Stale" : "No staleness reported" : "Unknown"}</dd>
                                    <dt>Source timestamp</dt><dd>{timestamp(sourceTimestamp)}</dd>
                                    <dt>Last receipt</dt><dd>{timestamp(tick?.received_at)}</dd>
                                    <dt>Connection</dt><dd>{connection}</dd>
                                    <dt>History refreshed</dt><dd>{ownData && data.historyUpdated ? timestamp(Date.parse(data.historyUpdated)) : "Unknown"}</dd>
                                    <dt>History sessions</dt><dd>{coverage?.sessions.join(", ") || "Unknown"}</dd>
                                    <dt>Overnight history</dt><dd>{coverage?.overnight_history == null ? "Unknown" : coverage.overnight_history ? "Available" : "Unavailable"}</dd>
                                    <dt>Clock</dt><dd>{offset === null ? "Awaiting server time" : Math.abs(offset) > 5000 ? `Local clock differs by ${formatAge(Math.abs(offset) / 1000)}` : "Synchronized"}</dd>
                                </dl>
                            </details>
                            {intraday && <p class={styles.sessionLegend}><span>┈ Close</span>Regular session close</p>}
                            <div class={styles.detailsFooter}>
                                <button type="button" class={styles.marketRefresh} onClick={data.refresh}><RefreshCw size={13} aria-hidden="true" />Refresh history</button>
                            </div>
                        </ArkPopover.Content>
                    </ArkPopover.Positioner>
                </Portal>
            </>
        </ArkPopover.Root>
    );
}

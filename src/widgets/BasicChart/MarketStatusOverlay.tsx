import { useEffect, useRef, useState } from "preact/hooks";
import { livePricesClient } from "../../services/livePrices";
import type { useChartData } from "./useChartData";
import { formatAge, marketStatus } from "./marketStatus";
import { extendedQuote } from "./sessionPolicy";
import styles from "./BasicChart.module.css";

export function MarketStatusOverlay({ id, data, timezone, warning, intraday }: {
    id: string; data: ReturnType<typeof useChartData>; timezone: string; warning: string; intraday: boolean;
}) {
    const [expanded, setExpanded] = useState(false);
    const [now, setNow] = useState(() => livePricesClient.now());
    const [connection, setConnection] = useState(livePricesClient.getStatus());
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        const timer = window.setInterval(() => setNow(livePricesClient.now()), 1000);
        const off = livePricesClient.onStatus(setConnection);
        return () => { window.clearInterval(timer); off(); };
    }, []);
    useEffect(() => {
        if (!expanded) return;
        const outside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setExpanded(false); };
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") { setExpanded(false); triggerRef.current?.focus(); }
        };
        document.addEventListener("pointerdown", outside);
        document.addEventListener("keydown", escape);
        return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
    }, [expanded]);
    const status = marketStatus(data.marketContext, data.lastTick, data.coverage, now);
    const quote = extendedQuote(data.marketContext, data.lastTick, now);
    const ageLabel = status.age === null ? "Quote age unknown" : `Quote age ${formatAge(status.age)}`;
    const overnightRelevant = data.marketContext?.exchange === "XNAS" || data.marketContext?.exchange === "XNYS" || data.marketContext?.sessions.some(s => s.windows.some(w => w.kind === "overnight"));
    const notices = [
        connection !== "open" ? connection === "error" ? "Connection error" : connection === "reconnecting" ? "Reconnecting" : connection === "connecting" ? "Connecting" : "Disconnected" : null,
        status.delayed ? "Delayed feed" : status.stale ? "Stale quote" : null,
        data.historyStale ? "Stale history" : null,
        warning || null,
        intraday && overnightRelevant && data.coverage?.overnight_history === false ? "Overnight history unavailable" : null,
    ].filter((value): value is string => Boolean(value));
    const timestamp = (ms: number | null | undefined, zone = timezone) => ms == null ? "Unknown" : new Intl.DateTimeFormat("en-GB", { timeZone: zone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(ms));
    const offset = livePricesClient.getClockOffset();
    return <div ref={rootRef} class={styles.marketOverlay} onPointerDown={event => event.stopPropagation()}>
        <button ref={triggerRef} type="button" class={[styles.marketTrigger, status.stale || status.delayed ? styles.marketWarning : ""].join(" ")} aria-expanded={expanded} aria-controls={`market-details-${id}`} onClick={() => setExpanded(value => !value)}>
            <span>{status.label}</span><span class={styles.marketSeparator}>·</span><span>{ageLabel}</span><span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
        </button>
        {notices.length > 0 && <div class={styles.marketNotices} role="status">{notices.map(notice => <span key={notice}>{notice}</span>)}</div>}
        {expanded && <div id={`market-details-${id}`} class={styles.marketDetails}>
            <dl>
                <dt>Source</dt><dd>{data.source ?? "Unknown"}</dd>
                {quote && <><dt>{quote.kind.toUpperCase()} price</dt><dd>{quote.price.toFixed(2)}{quote.stale ? " · Stale" : ""}</dd></>}
                <dt>Exchange</dt><dd>{data.marketContext?.exchange ?? "Unknown"}</dd>
                <dt>Display timezone</dt><dd>{timezone}</dd>
                <dt>Exchange timezone</dt><dd>{data.marketContext?.exchange_timezone ?? "Unknown"}</dd>
                <dt>Exchange time</dt><dd>{data.marketContext?.exchange_timezone ? timestamp(now, data.marketContext.exchange_timezone) : "Unknown"}</dd>
                <dt>Source timestamp</dt><dd>{data.lastTick?.timestamp_origin === "source" ? timestamp(data.lastTick.ts) : "Unknown"}</dd>
                <dt>Last receipt</dt><dd>{timestamp(data.lastTick?.received_at)}</dd>
                <dt>Connection</dt><dd>{connection}</dd>
                <dt>Next transition</dt><dd>{timestamp(status.next === null ? null : status.next * 1000)}</dd>
                <dt>History refreshed</dt><dd>{data.historyUpdated ? timestamp(Date.parse(data.historyUpdated)) : "Unknown"}</dd>
                <dt>History sessions</dt><dd>{data.coverage?.sessions.join(", ") || "Unknown"}</dd>
                <dt>Clock</dt><dd>{offset === null ? "Awaiting server time" : Math.abs(offset) > 5000 ? `Local clock differs by ${formatAge(Math.abs(offset) / 1000)}` : "Synchronized"}</dd>
            </dl>
            {intraday && <p class={styles.sessionLegend}><span>┄ Open</span><span>┈ Close</span>Regular session boundaries</p>}
            <button type="button" class={styles.marketRefresh} onClick={data.refresh}>Refresh history</button>
        </div>}
    </div>;
}

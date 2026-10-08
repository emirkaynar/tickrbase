
import { Clock3, TriangleAlert } from "lucide-react";
import { Tooltip } from "../../../ui";
import { MarketPillTooltip } from "./MarketPillTooltip";
import { formatCurrency, formatPercentChange } from "../../../utils";
import type { ChartQuote } from "../hooks/useChartQuote";
import { formatDelay } from "../marketStatus";
import type { MarketCountdown, MarketTooltip } from "../marketStatus";
import styles from "./MarketOverlay.module.css";

type Props = {
    symbol: string;
    name: string;
    exchange: string | null;
    quote: ChartQuote;
    tooltip: MarketTooltip;
    delayed: boolean;
    delaySeconds?: number | null;
    countdown?: MarketCountdown | null;
    notices: string[];

};

export function MarketStatusOverlay({ symbol, name, exchange, quote, tooltip, delayed, delaySeconds = null, countdown = null, notices }: Props) {
    if (!quote.ready) return null;
    const changeClass = quote.changePercent === null || quote.changePercent === 0
        ? styles.changeNeutral : quote.changePercent > 0 ? styles.changePositive : styles.changeNegative;
    const warningLabel = notices.length ? `Data warnings: ${notices.join("; ")}` : "";
    const pillLabel = [tooltip.session ? tooltip.title : "", countdown?.label, warningLabel].filter(Boolean).join("; ");


    const sessionNames = { regular: "Market open", pre: "Pre-market", post: "Post-market", overnight: "Overnight session", closed: "Market closed" };
    const upcomingSession = countdown && countdown.nextSession !== "closed" && countdown.nextSession !== "regular" && countdown.nextSession !== tooltip.session
        ? countdown.nextSession : null;
    const sessionTiming = !countdown ? tooltip.timing
        : tooltip.session === "closed" ? upcomingSession ? null : `Opens in ${countdown.duration}`
        : tooltip.session === "pre" && countdown.nextSession === "regular" ? `Market opens in ${countdown.duration}`
        : `${tooltip.session === "regular" ? "Closes" : "Ends"} in ${countdown.duration}`;
    const warningTitle = (notice: string) => ["Connection error", "Reconnecting", "Disconnected"].includes(notice)
        ? "Connection issue" : notice === "Connecting" ? "Connection"
        : /^history/i.test(notice) ? "History unavailable" : "Data warning";
    const pillTooltip = (
        <div class={styles.sessionTooltip}>
            {tooltip.session && <div class={`${styles.tooltipRow} ${styles.tooltipSessionRow}`} data-session={tooltip.session}>
                <span class={styles.tooltipMarker} aria-hidden="true"><span class={styles.sessionDot} /></span>
                <div class={styles.tooltipRowText}>
                    <strong>{sessionNames[tooltip.session]}</strong>
                    {sessionTiming && <span class={styles.tooltipSubtitle}>{sessionTiming}</span>}
                </div>
            </div>}
            {tooltip.session && (delayed || delaySeconds === null) && <div class={`${styles.tooltipRow} ${styles.tooltipDelayRow}`} data-unknown={delaySeconds === null}>
                <span class={styles.tooltipMarker} aria-hidden="true">{delayed ? <span class={styles.tooltipDelayGlyph}>D</span> : "?"}</span>
                <div class={styles.tooltipRowText}>
                    <strong>{delayed && delaySeconds !== null ? formatDelay(delaySeconds) : "Delay unknown"}</strong>
                </div>
            </div>}
            {tooltip.session && countdown && upcomingSession && <div class={`${styles.tooltipRow} ${styles.tooltipCountdownRow}`} data-next-session={upcomingSession}>
                <span class={styles.tooltipMarker} aria-hidden="true"><Clock3 size={12} /></span>
                <div class={styles.tooltipRowText}>
                    <strong>{sessionNames[upcomingSession]}</strong>
                    <span class={styles.tooltipSubtitle}>{`Starts in ${countdown.duration}`}</span>
                </div>
            </div>}
            {notices.map(notice => <div key={notice} class={`${styles.tooltipRow} ${styles.tooltipWarningRow}`}>
                <span class={styles.tooltipMarker} aria-hidden="true"><TriangleAlert size={12} /></span>
                <div class={styles.tooltipRowText}>
                    <strong>{warningTitle(notice)}</strong>
                    {notice !== warningTitle(notice) && <span class={styles.tooltipSubtitle}>{notice}</span>}
                </div>
            </div>)}

        </div>
    );

    return (
        <div class={styles.marketOverlay} key={symbol}>
            <div class={styles.identityRow}>
                <Tooltip content={name}>
                    <span class={styles.instrumentName} tabIndex={0}>{name}</span>
                </Tooltip>
                {exchange && <span class={styles.exchange}>· {exchange}</span>}
                {(tooltip.session || notices.length > 0) && (
                    <MarketPillTooltip content={pillTooltip}>
                        <button
                            type="button"
                            class={styles.statusPill}
                            data-session={tooltip.session ?? undefined}
                            data-dot-only={Boolean(tooltip.session && !countdown && !delayed && notices.length === 0)}
                            data-segmented={Boolean(countdown || delayed || notices.length > 0)}
                            data-delayed={Boolean(tooltip.session && delayed)}
                            aria-label={pillLabel}

                            onPointerDown={event => event.stopPropagation()}

                        >
                            {tooltip.session && <span class={styles.sessionSegment} aria-hidden="true"><span class={styles.sessionDot} /></span>}
                            {tooltip.session && delayed && <span class={styles.delayMarker} aria-hidden="true">D</span>}
                            {tooltip.session && countdown && <span class={styles.countdownSegment} data-next-session={countdown.nextSession} aria-hidden="true">{countdown.text}</span>}
                            {notices.length > 0 && <span class={styles.warningSegment} aria-hidden="true"><TriangleAlert class={styles.pillWarning} size={12} /></span>}
                        </button>
                    </MarketPillTooltip>
                )}

            </div>
            <div class={styles.priceRow}>
                {quote.price !== null ? (
                    <span class={styles.priceValue}>{formatCurrency(quote.price, symbol, { currency: quote.currency, compact: false })}</span>
                ) : <span class={styles.unavailablePrice}>Quote unavailable</span>}

                {quote.changePercent !== null && <span class={changeClass}>{formatPercentChange(quote.changePercent)}</span>}
            </div>
        </div>
    );
}

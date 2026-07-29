import { useMemo } from "preact/hooks";
import { MiniBaselineChart, Tooltip } from "../../../ui";
import type { BaselineDataPoint } from "../../../ui";
import type { Bar, OverviewData, QuoteSnapshot } from "../../../services/types";
import type { ChartOverviewInterval } from "../useOverviewState";
import styles from "../SymbolOverview.module.css";

type Props = {
    quote: QuoteSnapshot | null;
    overview: OverviewData | null;
    bars: Bar[];
    dailyBars: Bar[];
    activeInterval: ChartOverviewInterval;
    selectInterval: (interval: ChartOverviewInterval) => void;
    isIntraday: boolean;
};

import {
    formatNumber,
    formatPercent,
    formatVolume,
    toLocalDateStr,
} from "../../../utils";

export function SummaryTab({
    quote,
    overview,
    bars,
    dailyBars,
    activeInterval,
    selectInterval,
    isIntraday,
}: Props) {
    // Transform bars into BaselineDataPoint[]
    const chartData = useMemo<BaselineDataPoint[]>(() => {
        if (bars.length === 0) return [];
        let filteredBars = bars;
        if (activeInterval === "D") {
            const latestDate = toLocalDateStr(bars[bars.length - 1].time);
            filteredBars = bars.filter(
                (b) => toLocalDateStr(b.time) === latestDate,
            );
        }
        return filteredBars.map((b) => ({
            time: b.time,
            value: b.close,
        }));
    }, [bars, activeInterval]);

    const baseValue = useMemo(() => {
        if (activeInterval === "D") {
            return (
                quote?.previous_close ??
                (chartData.length > 0 ? chartData[0].value : 0)
            );
        }
        return chartData.length > 0 ? chartData[0].value : 0;
    }, [activeInterval, quote, chartData]);

    // Calculate historical changes
    const changes = useMemo(() => {
        const current = quote?.current_price;
        if (!current || dailyBars.length === 0) {
            return {
                w1: null,
                m1: null,
                m3: null,
                m6: null,
                ytd: null,
                y1: null,
            };
        }

        const len = dailyBars.length;
        const getPct = (pastBarIdx: number) => {
            if (pastBarIdx < 0 || pastBarIdx >= len) return null;
            const pastClose = dailyBars[pastBarIdx].close;
            if (!pastClose) return null;
            return ((current - pastClose) / pastClose) * 100;
        };

        // 1W = 5 trading days ago
        const w1 = getPct(len - 1 - 5);
        // 1M = 21 trading days ago
        const m1 = getPct(len - 1 - 21);
        // 3M = 63 trading days ago
        const m3 = getPct(len - 1 - 63);
        // 6M = 126 trading days ago
        const m6 = getPct(len - 1 - 126);
        // 1Y = 252 trading days ago
        const y1 = getPct(len - 1 - 252);

        // YTD: find first trading bar of current year
        const currentYear = new Date().getFullYear();
        let ytdIdx = -1;
        for (let i = len - 1; i >= 0; i--) {
            const yr = new Date(dailyBars[i].time * 1000).getFullYear();
            if (yr < currentYear) {
                ytdIdx = i; // last bar of prev year
                break;
            }
        }
        const ytd = ytdIdx >= 0 ? getPct(ytdIdx) : null;

        return {
            w1,
            m1,
            m3,
            m6,
            ytd,
            y1,
        };
    }, [quote, dailyBars]);

    const items = [
        {
            label: "High",
            value: formatNumber(quote?.day_high),
        },
        {
            label: "Low",
            value: formatNumber(quote?.day_low),
        },
        {
            label: "VWAP",
            value: formatNumber(overview?.vwap),
        },
        { label: "Volume", value: formatVolume(quote?.volume_value) },
        { label: "Volume ($)", value: formatVolume(quote?.volume) },
        {
            label: "Open",
            value: formatNumber(quote?.open),
        },
        {
            label: "Pr. Close",
            value: formatNumber(quote?.previous_close),
        },
    ];

    return (
        <div className={styles.summaryTab}>
            {/* Horizontal scrollable stat strip */}
            <div className={styles.statStrip}>
                {items.map((it) => (
                    <div key={it.label} className={styles.statItem}>
                        <div className={styles.statLabel}>{it.label}</div>
                        <div className={styles.statValue}>{it.value}</div>
                    </div>
                ))}
            </div>

            {/* Chart controls & Baseline chart */}
            <div className={styles.chartSection}>
                <div className={styles.intervalBar}>
                    {(["D", "W", "M", "Y"] as ChartOverviewInterval[]).map(
                        (inv) => (
                            <Tooltip content={inv === "D" ? "Day" : inv === "W" ? "Week" : inv === "M" ? "Month" : "Year"} key={inv}>
                                <button
                                    type="button"
                                    className={[
                                        styles.intervalBtn,
                                        activeInterval === inv
                                            ? styles.intervalBtnActive
                                            : "",
                                    ]
                                        .filter(Boolean)
                                        .join(" ")}
                                    onClick={() => selectInterval(inv)}
                                >
                                    {inv}
                                </button>
                            </Tooltip>
                        ),
                    )}
                </div>

                <div className={styles.chartWrapper}>
                    <MiniBaselineChart
                        data={chartData}
                        baseValue={baseValue}
                        isIntraday={isIntraday}
                        activeInterval={activeInterval}
                    />
                </div>
            </div>

            {/* Performance change % grid */}
            <div className={styles.changeGrid}>
                {[
                    { label: "1W", val: changes.w1 },
                    { label: "1M", val: changes.m1 },
                    { label: "3M", val: changes.m3 },
                    { label: "6M", val: changes.m6 },
                    { label: "YTD", val: changes.ytd },
                    { label: "1Y", val: changes.y1 },
                ].map((c) => {
                    const isPos = c.val != null && c.val >= 0;
                    const isNeg = c.val != null && c.val < 0;
                    return (
                        <div key={c.label} className={styles.changeCard}>
                            <span className={styles.changeLabel}>
                                {c.label}
                            </span>
                            <span
                                className={[
                                    styles.changeValue,
                                    isPos
                                        ? styles.bull
                                        : isNeg
                                          ? styles.bear
                                          : "",
                                ]
                                    .filter(Boolean)
                                    .join(" ")}
                            >
                                {formatPercent(c.val)}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

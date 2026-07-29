import { useEffect, useRef } from "preact/hooks";
import {
    createChart,
    CrosshairMode,
    BaselineSeries,
    type IChartApi,
    type ISeriesApi,
} from "lightweight-charts";
import { getChartColors, getFonts } from "../../styles/tokens";
import tooltipStyles from "../Tooltip/Tooltip.module.css";
import styles from "./MiniBaselineChart.module.css";

export type BaselineDataPoint = {
    time: number;
    value: number;
};

type Props = {
    data: BaselineDataPoint[];
    baseValue?: number;
    isIntraday?: boolean;
    activeInterval?: "D" | "W" | "M" | "Y";
    className?: string;
};

const PRICE_FORMATTER = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

function formatDate(
    unixSec: number,
    activeInterval?: "D" | "W" | "M" | "Y",
    isIntraday?: boolean,
): string {
    const dt = new Date(unixSec * 1000);
    if (activeInterval === "D") {
        return new Intl.DateTimeFormat("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }).format(dt);
    }
    if (activeInterval === "W" || isIntraday) {
        return new Intl.DateTimeFormat("en-US", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }).format(dt);
    }
    return new Intl.DateTimeFormat("en-US", {
        day: "2-digit",
        month: "short",
        year: "2-digit",
    }).format(dt);
}

export function MiniBaselineChart({
    data,
    baseValue,
    isIntraday = false,
    activeInterval,
    className,
}: Props) {
    const rootRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<"Baseline"> | null>(null);

    const activeIntervalRef = useRef(activeInterval);
    activeIntervalRef.current = activeInterval;

    const isIntradayRef = useRef(isIntraday);
    isIntradayRef.current = isIntraday;

    const baseVal = baseValue ?? (data.length > 0 ? data[0].value : 0);

    // Sync timeScale options when activeInterval or isIntraday changes
    useEffect(() => {
        if (!chartRef.current) return;
        chartRef.current.applyOptions({
            timeScale: {
                timeVisible: isIntraday || activeInterval === "W",
            },
        });
    }, [activeInterval, isIntraday]);

    // Initialize chart
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const colors = getChartColors();
        const fonts = getFonts();

        const chart = createChart(container, {
            width: Math.max(container.clientWidth, 10),
            height: Math.max(container.clientHeight, 10),
            autoSize: false,
            layout: {
                background: { color: "transparent" },
                textColor: colors.textMuted,
                fontFamily: fonts.mono,
                fontSize: 11,
            },
            grid: {
                vertLines: { visible: false },
                horzLines: { visible: false },
            },
            crosshair: {
                mode: CrosshairMode.Magnet,
                vertLine: {
                    color: colors.textSubtle,
                    width: 1,
                    style: 2, // dashed
                    labelVisible: true,
                    labelBackgroundColor: colors.bgSurface,
                },
                horzLine: {
                    visible: false,
                    labelVisible: false,
                },
            },
            rightPriceScale: { visible: false },
            leftPriceScale: { visible: false },
            localization: {
                priceFormatter: (val: number) => PRICE_FORMATTER.format(val),
                timeFormatter: (time: any) => {
                    let sec = 0;
                    if (typeof time === "number") {
                        sec = time;
                    } else if (time && typeof time === "object" && "year" in time) {
                        sec = Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000);
                    }
                    if (!sec) return "";
                    return formatDate(sec, activeIntervalRef.current, isIntradayRef.current);
                },
            },
            timeScale: {
                borderColor: colors.border,
                timeVisible: isIntraday,
                secondsVisible: false,
                borderVisible: true,
                fixLeftEdge: true,
                fixRightEdge: true,
                lockVisibleTimeRangeOnResize: true,
                tickMarkFormatter: (time: any) => {
                    const interval = activeIntervalRef.current;
                    let sec = 0;
                    if (typeof time === "number") {
                        sec = time;
                    } else if (time && typeof time === "object" && "year" in time) {
                        sec = Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000);
                    }
                    if (!sec) return null;

                    const dt = new Date(sec * 1000);
                    if (interval === "D") {
                        return new Intl.DateTimeFormat("en-US", {
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                        }).format(dt);
                    }
                    if (interval === "W") {
                        return new Intl.DateTimeFormat("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                        }).format(dt);
                    }
                    return null;
                },
            },
            handleScroll: false,
            handleScale: false,
        });

        const series = chart.addSeries(BaselineSeries, {
            baseValue: { type: "price", price: baseVal },
            topLineColor: colors.bull,
            topFillColor1: `color-mix(in srgb, ${colors.bull} 25%, transparent)`,
            topFillColor2: `color-mix(in srgb, ${colors.bull} 5%, transparent)`,
            bottomLineColor: colors.bear,
            bottomFillColor1: `color-mix(in srgb, ${colors.bear} 5%, transparent)`,
            bottomFillColor2: `color-mix(in srgb, ${colors.bear} 25%, transparent)`,
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            priceFormat: {
                type: "custom",
                formatter: (val: number) => PRICE_FORMATTER.format(val),
            },
        });

        chartRef.current = chart;
        seriesRef.current = series;

        // Tooltip handler on crosshair move
        chart.subscribeCrosshairMove((param) => {
            const tooltip = tooltipRef.current;
            const root = rootRef.current;
            if (!tooltip || !root) return;

            if (
                !param.time ||
                param.point === undefined ||
                param.point.x < 0 ||
                param.point.x > container.clientWidth ||
                param.point.y < 0 ||
                param.point.y > container.clientHeight
            ) {
                tooltip.style.display = "none";
                return;
            }

            const dataPoint = param.seriesData.get(series);
            if (!dataPoint) {
                tooltip.style.display = "none";
                return;
            }

            const priceVal = (dataPoint as { value?: number }).value;
            if (priceVal == null) {
                tooltip.style.display = "none";
                return;
            }

            const priceEl = tooltip.querySelector(`.${styles.tooltipPrice}`);
            if (priceEl) priceEl.textContent = PRICE_FORMATTER.format(priceVal);

            const rootRect = root.getBoundingClientRect();
            const x = param.point.x;
            const y = param.point.y;

            tooltip.style.display = "block";
            tooltip.style.left = `${Math.max(40, Math.min(x, rootRect.width - 40))}px`;
            tooltip.style.top = `${Math.max(30, y)}px`;
        });

        return () => {
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
        };
    }, []);

    // Update series data & baseValue
    useEffect(() => {
        const series = seriesRef.current;
        const chart = chartRef.current;
        if (!series || !chart) return;

        series.applyOptions({
            baseValue: { type: "price", price: baseVal },
        });

        const formatted = data.map((d) => ({
            time: d.time as any,
            value: d.value,
        }));

        series.setData(formatted);
        chart.timeScale().fitContent();
    }, [data, baseVal]);

    // ResizeObserver — syncs chart canvas to its DOM container cleanly
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let rafId: number | null = null;
        const ro = new ResizeObserver(() => {
            if (rafId !== null) return;
            rafId = requestAnimationFrame(() => {
                rafId = null;
                const chart = chartRef.current;
                if (!chart || !container) return;
                const w = container.clientWidth;
                const h = container.clientHeight;
                if (w > 0 && h > 0) {
                    chart.resize(w, h);
                    chart.timeScale().fitContent();
                }
            });
        });

        ro.observe(container);
        return () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            ro.disconnect();
        };
    }, []);

    return (
        <div
            ref={rootRef}
            className={[styles.root, className].filter(Boolean).join(" ")}
        >
            <div ref={containerRef} className={styles.chartContainer} />
            <div
                ref={tooltipRef}
                className={[tooltipStyles.content, styles.canvasTooltip].filter(Boolean).join(" ")}
            >
                <div className={styles.tooltipPrice} />
            </div>
        </div>
    );
}

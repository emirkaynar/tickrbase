import { useEffect, useRef } from "preact/hooks";
import {
    createChart,
    CrosshairMode,
    HistogramSeries,
    LineSeries,
    type IChartApi,
    type ISeriesApi,
} from "lightweight-charts";
import type { PortfolioHistoryPoint } from "../../services/types";
import { getChartColors, getFonts } from "../../styles/tokens";
import { formatPercent } from "../../utils/formatters";
import tooltipStyles from "../Tooltip/Tooltip.module.css";
import styles from "./PortfolioChart.module.css";

type Props = {
    points: PortfolioHistoryPoint[];
    benchmarkLabel?: string;
    className?: string;
};

function formatDate(unixSec: number): string {
    const dt = new Date(unixSec * 1000);
    return new Intl.DateTimeFormat("en-US", {
        day: "2-digit",
        month: "short",
        year: "2-digit",
    }).format(dt);
}

export function PnlChart({ points, benchmarkLabel = "Benchmark", className }: Props) {
    const rootRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const histogramSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
    const cumulativeSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const benchmarkSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

    const benchLabelRef = useRef(benchmarkLabel);
    benchLabelRef.current = benchmarkLabel;

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
                horzLines: { color: `color-mix(in srgb, ${colors.border} 40%, transparent)` },
            },
            crosshair: {
                mode: CrosshairMode.Magnet,
                vertLine: {
                    color: colors.textSubtle,
                    width: 1,
                    style: 2,
                    labelVisible: true,
                    labelBackgroundColor: colors.bgSurface,
                },
                horzLine: {
                    visible: false,
                    labelVisible: false,
                },
            },
            rightPriceScale: {
                visible: true,
                borderColor: colors.border,
                borderVisible: false,
                scaleMargins: {
                    top: 0.2,
                    bottom: 0.15,
                },
            },
            leftPriceScale: { visible: false },
            localization: {
                priceFormatter: (val: number) => formatPercent(val),
                timeFormatter: (time: any) => {
                    let sec = typeof time === "number" ? time : 0;
                    if (!sec && time && typeof time === "object" && "year" in time) {
                        sec = Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000);
                    }
                    return sec ? formatDate(sec) : "";
                },
            },
            timeScale: {
                borderColor: colors.border,
                timeVisible: false,
                secondsVisible: false,
                borderVisible: true,
                fixLeftEdge: true,
                fixRightEdge: true,
            },
            handleScroll: true,
            handleScale: true,
        });

        const histSeries = chart.addSeries(HistogramSeries, {
            priceFormat: {
                type: "custom",
                formatter: (v: number) => formatPercent(v),
            },
        });

        const cumSeries = chart.addSeries(LineSeries, {
            color: colors.primary,
            lineWidth: 2,
            priceFormat: {
                type: "custom",
                formatter: (v: number) => formatPercent(v),
            },
        });

        chartRef.current = chart;
        histogramSeriesRef.current = histSeries;
        cumulativeSeriesRef.current = cumSeries;

        // Tooltip handler matching tutorial code exactly
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

            const histData = param.seriesData.get(histSeries) as { value?: number };
            const cumData = param.seriesData.get(cumSeries) as { value?: number };

            let benchData: { value?: number } | undefined = undefined;
            if (benchmarkSeriesRef.current) {
                benchData = param.seriesData.get(benchmarkSeriesRef.current) as { value?: number };
            }

            let timeSec = typeof param.time === "number" ? param.time : 0;
            if (!timeSec && typeof param.time === "object" && "year" in param.time) {
                const tObj = param.time as any;
                timeSec = Math.floor(Date.UTC(tObj.year, tObj.month - 1, tObj.day) / 1000);
            }

            const dateStr = timeSec ? formatDate(timeSec) : "";
            const histNum = histData?.value ?? 0;
            const cumNum = cumData?.value ?? 0;
            const benchNum = benchData?.value;

            const isPos = histNum >= 0;
            const dotClass = isPos ? styles.tooltipDotBull : styles.tooltipDotBear;

            let gridItems = `
                <span class="${dotClass}"></span>
                <span class="${styles.tooltipLabel}">Period Return</span>
                <span class="${styles.tooltipVal}">${formatPercent(histNum)}</span>

                <span class="${styles.tooltipDot}"></span>
                <span class="${styles.tooltipLabel}">Cumulative</span>
                <span class="${styles.tooltipVal}">${formatPercent(cumNum)}</span>
            `;

            if (benchNum != null) {
                gridItems += `
                    <span class="${styles.tooltipDotBench}"></span>
                    <span class="${styles.tooltipLabel}">${benchLabelRef.current}</span>
                    <span class="${styles.tooltipVal}">${formatPercent(benchNum)}</span>
                `;
            }

            tooltip.innerHTML = `
                <div class="${styles.tooltip}">
                    <div class="${styles.tooltipDate}">${dateStr}</div>
                    <div class="${styles.tooltipGrid}">
                        ${gridItems}
                    </div>
                </div>
            `;
            tooltip.style.display = "flex";

            const toolTipWidth = tooltip.offsetWidth || 160;
            const toolTipHeight = tooltip.offsetHeight || 80;
            const toolTipMargin = 15;

            // Snap Y to the magnet dot on the cumulative series line
            const seriesY = cumSeries.priceToCoordinate(cumNum) ?? histSeries.priceToCoordinate(histNum);
            const y = seriesY !== null && seriesY !== undefined ? seriesY : param.point.y;

            let left = param.point.x + toolTipMargin;
            if (left > container.clientWidth - toolTipWidth) {
                left = param.point.x - toolTipMargin - toolTipWidth;
            }

            let top = y + toolTipMargin;
            if (top > container.clientHeight - toolTipHeight) {
                top = y - toolTipHeight - toolTipMargin;
            }

            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
            tooltip.style.transform = "none";
        });

        return () => {
            chart.remove();
            chartRef.current = null;
            histogramSeriesRef.current = null;
            cumulativeSeriesRef.current = null;
            benchmarkSeriesRef.current = null;
        };
    }, []);

    // Update series data
    useEffect(() => {
        const histSeries = histogramSeriesRef.current;
        const cumSeries = cumulativeSeriesRef.current;
        const chart = chartRef.current;
        if (!histSeries || !cumSeries || !chart) return;

        const colors = getChartColors();

        const histData = points
            .filter((p) => p.pnl_delta_pct != null)
            .map((p) => ({
                time: p.time as any,
                value: p.pnl_delta_pct!,
                color: (p.pnl_delta_pct ?? 0) >= 0 ? colors.bull : colors.bear,
            }));

        const cumData = points
            .filter((p) => p.pnl_pct != null || p.portfolio_percent != null)
            .map((p) => ({
                time: p.time as any,
                value: p.pnl_pct ?? p.portfolio_percent ?? 0,
            }));

        histSeries.setData(histData);
        cumSeries.setData(cumData);

        // Handle benchmark series dynamically
        const hasBench = points.some((p) => p.benchmark_percent != null);
        if (hasBench) {
            if (!benchmarkSeriesRef.current) {
                const benchSeries = chart.addSeries(LineSeries, {
                    color: colors.warning,
                    lineWidth: 2,
                    lineStyle: 2, // dashed
                    priceFormat: {
                        type: "custom",
                        formatter: (v: number) => formatPercent(v),
                    },
                });
                benchmarkSeriesRef.current = benchSeries;
            }
            const benchData = points
                .filter((p) => p.benchmark_percent != null)
                .map((p) => ({
                    time: p.time as any,
                    value: p.benchmark_percent!,
                }));
            benchmarkSeriesRef.current.setData(benchData);
        } else if (benchmarkSeriesRef.current) {
            chart.removeSeries(benchmarkSeriesRef.current);
            benchmarkSeriesRef.current = null;
        }

        chart.timeScale().fitContent();
    }, [points]);

    // ResizeObserver
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
            />
        </div>
    );
}

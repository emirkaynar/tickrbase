import { useEffect, useRef } from "preact/hooks";
import {
    AreaSeries,
    createChart,
    CrosshairMode,
    LineSeries,
    type IChartApi,
    type ISeriesApi,
} from "lightweight-charts";
import type { PortfolioHistoryPoint } from "../../services/types";
import { getChartColors, getFonts } from "../../styles/tokens";
import { formatCurrency } from "../../utils";
import {
    formatIntervalDate,
    type ChartInterval,
} from "../../utils/chartHelpers";
import { Portal } from "@ark-ui/react/portal";
import tooltipStyles from "../Tooltip/Tooltip.module.css";
import styles from "./PortfolioChart.module.css";

type Props = {
    points: PortfolioHistoryPoint[];
    baseCurrency: string;
    interval?: ChartInterval;
    className?: string;
};

export function ValueChart({
    points,
    baseCurrency,
    interval = "1d",
    className,
}: Props) {
    const rootRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);

    const tooltipDateRef = useRef<HTMLDivElement>(null);
    const tooltipValRef = useRef<HTMLSpanElement>(null);
    const tooltipCostRef = useRef<HTMLSpanElement>(null);

    const chartRef = useRef<IChartApi | null>(null);
    const valueSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
    const costSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

    const baseCurrencyRef = useRef(baseCurrency);
    baseCurrencyRef.current = baseCurrency;

    const intervalRef = useRef(interval);
    intervalRef.current = interval;

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
                alignLabels: true,
                scaleMargins: {
                    top: 0.1,
                    bottom: 0.15,
                },
            },
            leftPriceScale: { visible: false },
            localization: {
                priceFormatter: (val: number) =>
                    formatCurrency(val, baseCurrencyRef.current, {
                        compact: true,
                    }),
                timeFormatter: (time: any) => {
                    let sec = typeof time === "number" ? time : 0;
                    if (
                        !sec &&
                        time &&
                        typeof time === "object" &&
                        "year" in time
                    ) {
                        sec = Math.floor(
                            Date.UTC(time.year, time.month - 1, time.day) /
                                1000,
                        );
                    }
                    return sec
                        ? formatIntervalDate(sec, intervalRef.current)
                        : "";
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

        const valSeries = chart.addSeries(AreaSeries, {
            lineColor: colors.primary,
            topColor: colors.primary,
            bottomColor: "transparent",
            lineVisible: true,
            lineWidth: 2,
            priceFormat: {
                type: "custom",
                formatter: (val: number) =>
                    formatCurrency(val, baseCurrencyRef.current, {
                        compact: true,
                    }),
            },
        });

        valSeries.applyOptions({ priceLineVisible: false });

        const costSeries = chart.addSeries(LineSeries, {
            color: colors.text,
            lineWidth: 1,
            lineStyle: 2, // dashed
            priceFormat: {
                type: "custom",
                formatter: (val: number) =>
                    formatCurrency(val, baseCurrencyRef.current, {
                        compact: true,
                    }),
            },
        });

        costSeries.applyOptions({ priceLineVisible: false });

        chartRef.current = chart;
        valueSeriesRef.current = valSeries;
        costSeriesRef.current = costSeries;

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

            const valData = param.seriesData.get(valSeries) as {
                value?: number;
            };
            const costData = param.seriesData.get(costSeries) as {
                value?: number;
            };

            let timeSec = typeof param.time === "number" ? param.time : 0;
            if (
                !timeSec &&
                typeof param.time === "object" &&
                "year" in param.time
            ) {
                const tObj = param.time as any;
                timeSec = Math.floor(
                    Date.UTC(tObj.year, tObj.month - 1, tObj.day) / 1000,
                );
            }

            const dateStr = timeSec
                ? formatIntervalDate(timeSec, intervalRef.current)
                : "";
            const valNum = valData?.value ?? 0;
            const costNum = costData?.value ?? 0;

            const cur = baseCurrencyRef.current;
            const valStr = formatCurrency(valNum, cur, { compact: false });
            const costStr = formatCurrency(costNum, cur, { compact: false });

            if (tooltipDateRef.current)
                tooltipDateRef.current.textContent = dateStr;
            if (tooltipValRef.current)
                tooltipValRef.current.textContent = valStr;
            if (tooltipCostRef.current)
                tooltipCostRef.current.textContent = costStr;

            tooltip.style.display = "flex";

            const rootRect = root.getBoundingClientRect();
            const toolTipWidth = tooltip.offsetWidth || 160;
            const toolTipHeight = tooltip.offsetHeight || 80;
            const toolTipMargin = 15;

            // Snap Y to the magnet dot on the chart series line
            const seriesY = valSeries.priceToCoordinate(valNum);
            const y =
                seriesY !== null && seriesY !== undefined
                    ? seriesY
                    : param.point.y;

            let left = rootRect.left + param.point.x + toolTipMargin;
            if (left > rootRect.right - toolTipWidth) {
                left = rootRect.left + param.point.x - toolTipMargin - toolTipWidth;
            }

            let top = rootRect.top + y + toolTipMargin;
            if (top > rootRect.bottom - toolTipHeight) {
                top = rootRect.top + y - toolTipHeight - toolTipMargin;
            }

            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
            tooltip.style.transform = "none";
        });

        return () => {
            chart.remove();
            chartRef.current = null;
            valueSeriesRef.current = null;
            costSeriesRef.current = null;
        };
    }, []);

    // Update series data & closer starting zoom
    useEffect(() => {
        const valSeries = valueSeriesRef.current;
        const costSeries = costSeriesRef.current;
        const chart = chartRef.current;
        if (!valSeries || !costSeries || !chart) return;

        const valData = points.map((p) => ({
            time: p.time as any,
            value: p.market_value_base ?? p.portfolio_value ?? 0,
        }));

        const costData = points.map((p) => ({
            time: p.time as any,
            value: p.net_invested_base ?? 0,
        }));

        valSeries.setData(valData);
        costSeries.setData(costData);

        // Closer starting zoom: show last ~35 points on initial render
        const total = points.length;
        if (total > 0) {
            const visibleCount = Math.min(35, total);
            chart.timeScale().setVisibleLogicalRange({
                from: total - visibleCount,
                to: total - 1,
            });
        }
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
                    const total = points.length;
                    if (total > 0) {
                        const visibleCount = Math.min(35, total);
                        chart.timeScale().setVisibleLogicalRange({
                            from: total - visibleCount,
                            to: total - 1,
                        });
                    }
                }
            });
        });

        ro.observe(container);
        return () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            ro.disconnect();
        };
    }, [points.length]);

    return (
        <div
            ref={rootRef}
            className={[styles.root, className].filter(Boolean).join(" ")}
        >
            <div ref={containerRef} className={styles.chartContainer} />
            <Portal>
                <div
                    ref={tooltipRef}
                    className={[tooltipStyles.content, styles.canvasTooltip]
                        .filter(Boolean)
                        .join(" ")}
                >
                    <div className={styles.tooltip}>
                        <div ref={tooltipDateRef} className={styles.tooltipDate} />
                        <div className={styles.tooltipGrid}>
                            <span className={styles.tooltipDot} />
                            <span className={styles.tooltipLabel}>Portfolio</span>
                            <span
                                ref={tooltipValRef}
                                className={styles.tooltipVal}
                            />

                            <span className={styles.tooltipDotCost} />
                            <span className={styles.tooltipLabel}>
                                Net Invested
                            </span>
                            <span
                                ref={tooltipCostRef}
                                className={styles.tooltipVal}
                            />
                        </div>
                    </div>
                </div>
            </Portal>
        </div>
    );
}

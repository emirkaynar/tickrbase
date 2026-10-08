import { type DeepPartial, type ChartOptions, type Time, CrosshairMode } from "lightweight-charts";
import { getChartColors, getFonts } from "../../styles/tokens";
import type { ChartType } from "../../services/types";

function tzFmt(unixSec: number, opts: Intl.DateTimeFormatOptions, timezone: string = "UTC"): string {
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        ...opts,
    }).format(new Date(unixSec * 1000));
}

export function createChartConfig(
    isIntraday: boolean,
    timezone: string = "UTC",
    exchangeTimezone: string = "UTC",
): DeepPartial<ChartOptions> {
    const c = getChartColors();
    const f = getFonts();

    return {
        autoSize: false,
        layout: {
            background: { color: c.bgElevated },
            textColor: c.text,
            fontFamily: f.mono,
        },
        grid: {
            vertLines: { color: c.bgSurface },
            horzLines: { color: c.bgSurface },
        },
        crosshair: {
            mode: CrosshairMode.Magnet, // only show vert line
            vertLine: {
                labelBackgroundColor: c.bgSurface,
            },
            horzLine: {
                labelBackgroundColor: c.bgSurface,
            },
        },
        rightPriceScale: { borderColor: c.border },
        leftPriceScale: { borderColor: c.border },
        timeScale: {
            borderColor: c.border,
            timeVisible: isIntraday,
            secondsVisible: false,
            tickMarkFormatter: (unixSec: number, markType: number) => {
                if (isIntraday) {
                    if (markType <= 1)
                        return tzFmt(unixSec, {
                            month: "short",
                            year: "numeric",
                        }, timezone);
                    if (markType === 2)
                        return tzFmt(unixSec, {
                            month: "short",
                            day: "numeric",
                        }, timezone);
                    return tzFmt(unixSec, {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                    }, timezone);
                }
                if (markType === 0) return tzFmt(unixSec, { year: "numeric" }, exchangeTimezone);
                if (markType === 1) return tzFmt(unixSec, { month: "short" }, exchangeTimezone);
                return tzFmt(unixSec, { month: "short", day: "numeric" }, exchangeTimezone);
            },
        },
        localization: {
            timeFormatter: (unixSec: number) =>
                isIntraday
                    ? tzFmt(unixSec, {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                      }, timezone)
                    : tzFmt(unixSec, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                      }, exchangeTimezone),
        },
    };
}

export function getSeriesColors(type: ChartType = "candlestick") {
    const c = getChartColors();
    if (type === "line") {
        return {
            color: c.primary,
            lineWidth: 2,
        };
    }
    if (type === "area") {
        return {
            topColor: c.primary,
            bottomColor: "transparent",
            lineColor: c.primary,
            lineWidth: 2,
        };
    }
    if (type === "bar") {
        return {
            upColor: c.bull,
            downColor: c.bear,
            openVisible: true,
        };
    }
    if (type === "baseline") {
        return {
            topLineColor: c.bull,
            topFillColor1: `color-mix(in srgb, ${c.bull} 25%, transparent)`,
            topFillColor2: `color-mix(in srgb, ${c.bull} 5%, transparent)`,
            bottomLineColor: c.bear,
            bottomFillColor1: `color-mix(in srgb, ${c.bear} 5%, transparent)`,
            bottomFillColor2: `color-mix(in srgb, ${c.bear} 25%, transparent)`,
            lineWidth: 2,
        };
    }
    // Candlestick & Heikin-Ashi (default)
    return {
        upColor: c.bull,
        downColor: c.bear,
        borderVisible: false,
        wickUpColor: c.bull,
        wickDownColor: c.bear,
    };
}

export function getCandleColors() {
    return getSeriesColors("candlestick");
}

export type { Time };

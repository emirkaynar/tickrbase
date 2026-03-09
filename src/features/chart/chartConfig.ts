import type { DeepPartial, ChartOptions, Time } from "lightweight-charts";
import { getChartColors } from "../../styles/tokens";

function istFmt(unixSec: number, opts: Intl.DateTimeFormatOptions): string {
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Istanbul",
        ...opts,
    }).format(new Date(unixSec * 1000));
}

export function createChartConfig(
    isIntraday: boolean,
): DeepPartial<ChartOptions> {
    const c = getChartColors();

    return {
        autoSize: false,
        layout: {
            background: { color: c.bg },
            textColor: c.text,
        },
        grid: {
            vertLines: { color: c.bgSurface },
            horzLines: { color: c.bgSurface },
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
                        return istFmt(unixSec, {
                            month: "short",
                            year: "numeric",
                        });
                    if (markType === 2)
                        return istFmt(unixSec, {
                            month: "short",
                            day: "numeric",
                        });
                    return istFmt(unixSec, {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                    });
                }
                if (markType === 0) return istFmt(unixSec, { year: "numeric" });
                if (markType === 1) return istFmt(unixSec, { month: "short" });
                return istFmt(unixSec, { month: "short", day: "numeric" });
            },
        },
        localization: {
            timeFormatter: (unixSec: number) =>
                isIntraday
                    ? istFmt(unixSec, {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                      })
                    : istFmt(unixSec, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                      }),
        },
    };
}

export function getCandleColors() {
    const c = getChartColors();
    return {
        upColor: c.bull,
        downColor: c.bear,
        borderVisible: false,
        wickUpColor: c.bull,
        wickDownColor: c.bear,
    };
}

export type { Time };

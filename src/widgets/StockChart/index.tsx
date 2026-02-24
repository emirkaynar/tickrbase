import { useEffect, useRef, useState } from "preact/hooks";
import { createChart } from "lightweight-charts";
import type {
    CandlestickData,
    IChartApi,
    ISeriesApi,
    UTCTimestamp,
} from "lightweight-charts";
import { db } from "../../db";
import { queryOhlc } from "../../data/query";
import type { Bar, Interval } from "../../data/types";
import { INTERVALS, INTERVAL_CONFIG } from "../../data/types";
import { colors } from "../../styles/tokens";
import { SymbolSelect } from "../../components/SymbolSelect/SymbolSelect";
import { IntervalSelect } from "../../components/IntervalSelect/IntervalSelect";
import { useSymbols } from "../../data/symbols";
import "./StockChart.css";

// Tracks which widget IDs have ever successfully rendered data.
// Module-level so it survives RGL unmount/remount cycles during drag.
const everLoaded = new Set<string>();

// Last-known bars + interval per widget so a remounted chart can be seeded
// synchronously before the async DB/fetch cycle completes.
const lastState = new Map<
    string,
    { bars: Bar[]; interval: Interval; symbol: string }
>();

type Props = { id: string };

export function StockChart({ id }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const intervalRef = useRef<Interval>("1d");

    const { items: symbols } = useSymbols();

    // Seed from lastState on remount so there's no flash of default values
    const _prev = lastState.get(id);
    const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
    const [errorMsg, setErrorMsg] = useState("");
    const [symbol, setSymbol] = useState(_prev?.symbol ?? "ASELS.IS");
    const [interval, selectInterval] = useState<Interval>(
        _prev?.interval ?? "1d",
    );
    const [stateReady, setStateReady] = useState(false);

    // Restore persisted symbol+interval from DB on mount
    useEffect(() => {
        db.widgetState.get(id).then((saved) => {
            if (saved) {
                if (INTERVALS.includes(saved.interval as Interval)) {
                    selectInterval(saved.interval as Interval);
                }
                setSymbol(saved.symbol);
            }
            setStateReady(true);
        });
    }, [id]);

    // Persist symbol+interval whenever they change (skip until DB state is loaded)
    useEffect(() => {
        if (!stateReady) return;
        db.widgetState.put({ id, symbol, interval });
    }, [id, symbol, interval, stateReady]);

    // Create chart once on mount
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        function istFmt(
            unixSec: number,
            opts: Intl.DateTimeFormatOptions,
        ): string {
            return new Intl.DateTimeFormat("en-GB", {
                timeZone: "Europe/Istanbul",
                ...opts,
            }).format(new Date(unixSec * 1000));
        }

        const chart = createChart(container, {
            autoSize: false,
            width: container.clientWidth,
            height: container.clientHeight,
            layout: {
                background: { color: colors.bg },
                textColor: colors.text,
            },
            grid: {
                vertLines: { color: colors.bgSurface },
                horzLines: { color: colors.bgSurface },
            },
            rightPriceScale: { borderColor: colors.border },
            leftPriceScale: { borderColor: colors.border },
            timeScale: {
                borderColor: colors.border,
                tickMarkFormatter: (unixSec: number, markType: number) => {
                    const intraday = !["1d", "1wk", "1mo"].includes(
                        intervalRef.current,
                    );
                    if (intraday) {
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
                    if (markType === 0)
                        return istFmt(unixSec, { year: "numeric" });
                    if (markType === 1)
                        return istFmt(unixSec, { month: "short" });
                    return istFmt(unixSec, { month: "short", day: "numeric" });
                },
            },
            localization: {
                timeFormatter: (unixSec: number) => {
                    const intraday = !["1d", "1wk", "1mo"].includes(
                        intervalRef.current,
                    );
                    return intraday
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
                          });
                },
            },
        });

        // Re-fit visible range whenever the widget is resized — debounced so it
        // doesn't fire every pixel during drag, and gated so it only runs with data.
        let fitTimer: ReturnType<typeof setTimeout>;
        const ro = new ResizeObserver(() => {
            clearTimeout(fitTimer);
            fitTimer = setTimeout(() => {
                const w = container.clientWidth;
                const h = container.clientHeight;
                if (w > 0 && h > 0) {
                    chart.resize(w, h);
                    if (seriesRef.current) chart.timeScale().fitContent();
                }
            }, 150);
        });
        ro.observe(container);
        seriesRef.current = chart.addCandlestickSeries({
            upColor: colors.bull,
            downColor: colors.bear,
            borderVisible: false,
            wickUpColor: colors.bull,
            wickDownColor: colors.bear,
        });
        // Immediately seed with last-known bars so there's no blank flash on remount
        const cached = lastState.get(id);
        if (cached) {
            seriesRef.current.setData(
                cached.bars as CandlestickData<UTCTimestamp>[],
            );
            intervalRef.current = cached.interval;
            chart.timeScale().applyOptions({
                timeVisible: !["1d", "1wk", "1mo"].includes(cached.interval),
                secondsVisible: false,
            });
            chart.timeScale().fitContent();
        }
        chartRef.current = chart;

        return () => {
            clearTimeout(fitTimer);
            ro.disconnect();
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
        };
    }, []);

    // Reload data whenever symbol or interval changes; background poll keeps it live
    useEffect(() => {
        const series = seriesRef.current;
        if (!series || !stateReady) return;

        let isCancelled = false;
        const cancelled = () => isCancelled;
        // Only show loading overlay on true first-ever load
        if (!everLoaded.has(id)) setStatus("loading");

        function applyBars(bars: Bar[], fit = false) {
            if (isCancelled) return;
            intervalRef.current = interval;
            series!.setData(bars as CandlestickData<UTCTimestamp>[]);
            chartRef.current?.timeScale().applyOptions({
                timeVisible: !["1d", "1wk", "1mo"].includes(interval),
                secondsVisible: false,
            });
            if (fit) chartRef.current?.timeScale().fitContent();
            lastState.set(id, { bars, interval, symbol });
            everLoaded.add(id);
            setStatus("ok");
        }

        async function initialLoad() {
            try {
                const bars = await queryOhlc(
                    symbol,
                    interval,
                    (fresh) => applyBars(fresh, false),
                    cancelled,
                );
                if (!isCancelled) {
                    applyBars(bars, true);
                    setStatus("ok");
                }
            } catch (err) {
                if (!isCancelled) {
                    setErrorMsg(
                        err instanceof Error ? err.message : "Unknown error",
                    );
                    setStatus("error");
                }
            }
        }

        initialLoad();

        // Poll every staleMs — queryOhlc will background-refresh when stale
        const pollId = setInterval(() => {
            queryOhlc(
                symbol,
                interval,
                (fresh) => applyBars(fresh, false),
                cancelled,
            ).catch(() => {});
        }, INTERVAL_CONFIG[interval].staleMs);

        return () => {
            isCancelled = true;
            clearInterval(pollId);
        };
    }, [symbol, interval, stateReady]);

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
                border: `1px solid ${colors.border}`,
                borderRadius: "4px",
                overflow: "hidden",
            }}
        >
            <div class="widget-handle">
                <SymbolSelect
                    items={symbols}
                    value={symbol}
                    onChange={setSymbol}
                />

                {/* invisible flex spacer — this is the drag zone */}
                <div class="sc-drag-grip" />

                <IntervalSelect value={interval} onChange={selectInterval} />
            </div>

            {status === "loading" && !everLoaded.has(id) && (
                <div
                    style={{
                        padding: "16px",
                        color: "var(--color-text-subtle)",
                        fontSize: "13px",
                    }}
                >
                    Loading…
                </div>
            )}

            {status === "error" && (
                <div
                    style={{
                        padding: "16px",
                        color: "var(--color-error)",
                        fontSize: "13px",
                    }}
                >
                    Error: {errorMsg}
                </div>
            )}

            <div
                ref={containerRef}
                style={{
                    flex: 1,
                    minHeight: 0,
                    visibility:
                        everLoaded.has(id) || status === "ok"
                            ? "visible"
                            : "hidden",
                    backgroundColor: colors.bg,
                }}
            />
        </div>
    );
}

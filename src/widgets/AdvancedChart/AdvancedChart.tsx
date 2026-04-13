import { useEffect, useRef, useState } from "preact/hooks";
import { registerWidget } from "../registry";
import { Skeleton, WidgetDragButton, WidgetRemoveButton } from "../../ui";
import { db } from "../../db";
import { getChartColors } from "../../styles/tokens";
import styles from "./AdvancedChart.module.css";

type Props = { id: string; onRemove: () => void };
type ThemeMode = "dark" | "light";
type TvInterval = "D";

const TV_EMBED_URL =
    "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";

const DEFAULT_SYMBOL = "NVDA";
const DEFAULT_INTERVAL: TvInterval = "D";
const ENABLE_IFRAME_PROBE = import.meta.env.DEV;

type TradingViewMessage = {
    name?: string;
    data?: {
        short_name?: string;
    };
};

function parseTradingViewMessage(raw: unknown): TradingViewMessage | null {
    if (!raw) return null;

    const value =
        typeof raw === "string"
            ? (() => {
                  try {
                      return JSON.parse(raw) as unknown;
                  } catch {
                      return null;
                  }
              })()
            : raw;

    if (!value || typeof value !== "object") return null;
    return value as TradingViewMessage;
}

function getThemeMode(): ThemeMode {
    const current = document.documentElement.getAttribute("data-theme");
    return current === "light" ? "light" : "dark";
}

function hexToRgba(hexColor: string, alpha: number): string {
    const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hexColor);
    if (!match) return `rgba(255, 255, 255, ${alpha})`;

    const r = Number.parseInt(match[1], 16);
    const g = Number.parseInt(match[2], 16);
    const b = Number.parseInt(match[3], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function createWidgetConfig(
    symbol: string,
    interval: TvInterval,
    theme: ThemeMode,
) {
    const colors = getChartColors();

    return {
        allow_symbol_change: true,
        calendar: false,
        details: false,
        hide_side_toolbar: true,
        hide_top_toolbar: false,
        hide_legend: false,
        hide_volume: false,
        hotlist: false,
        interval,
        locale: "en",
        save_image: false,
        style: "1",
        symbol,
        theme,
        timezone: "exchange",
        backgroundColor: colors.bgElevated,
        gridColor: hexToRgba(colors.border, 0.35),
        watchlist: [],
        withdateranges: false,
        compareSymbols: [],
        studies: [],
        autosize: true,
    };
}

function AdvancedChart({ id, onRemove }: Props) {
    const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
    const [interval] = useState<TvInterval>(DEFAULT_INTERVAL);
    const [themeMode, setThemeMode] = useState<ThemeMode>(getThemeMode);
    const [error, setError] = useState("");
    const [retrySeed, setRetrySeed] = useState(0);
    const [loading, setLoading] = useState(true);
    const [hydrated, setHydrated] = useState(false);
    const hostRef = useRef<HTMLDivElement>(null);
    const iframeWindowRef = useRef<Window | null>(null);
    const symbolRef = useRef(symbol);
    const persistedSymbolRef = useRef<string | null>(null);

    useEffect(() => {
        symbolRef.current = symbol;
    }, [symbol]);

    useEffect(() => {
        let cancelled = false;
        setHydrated(false);
        setLoading(true);
        persistedSymbolRef.current = null;

        void db.widgetState
            .get(id)
            .then((saved) => {
                if (cancelled) return;
                const savedSymbol = saved?.symbol?.trim();
                const nextSymbol = savedSymbol || DEFAULT_SYMBOL;

                persistedSymbolRef.current = nextSymbol;
                setSymbol(nextSymbol);
            })
            .finally(() => {
                if (!cancelled) setHydrated(true);
            });

        return () => {
            cancelled = true;
        };
    }, [id]);

    useEffect(() => {
        if (!hydrated) return;
        if (persistedSymbolRef.current === symbol) return;
        persistedSymbolRef.current = symbol;
        void db.widgetState.put({ id, symbol });
    }, [id, symbol, hydrated]);

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (!iframeWindowRef.current) {
                const host = hostRef.current;
                const iframe = host?.querySelector(
                    "iframe",
                ) as HTMLIFrameElement | null;
                if (iframe?.contentWindow) {
                    iframeWindowRef.current = iframe.contentWindow;
                }
            }
            if (!iframeWindowRef.current) return;
            if (event.source !== iframeWindowRef.current) return;

            const payload = parseTradingViewMessage(event.data);

            if (ENABLE_IFRAME_PROBE) {
                // Dev probe to inspect symbol/event payloads from TradingView iframe.
                console.info("[AdvancedChart iframe probe]", {
                    widgetId: id,
                    origin: event.origin,
                    data: event.data,
                });
            }

            if (event.origin !== "https://www.tradingview-widget.com") return;
            if (payload?.name !== "quoteUpdate") return;

            const shortName = payload.data?.short_name?.trim();
            if (!shortName) return;
            if (shortName === persistedSymbolRef.current) return;

            persistedSymbolRef.current = shortName;
            setSymbol(shortName);
            void db.widgetState.put({ id, symbol: shortName });
        };

        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [id]);

    useEffect(() => {
        const observer = new MutationObserver(() => {
            setThemeMode(getThemeMode());
            setLoading(true);
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-theme"],
        });

        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        if (!hydrated) return;

        iframeWindowRef.current = null;
        host.innerHTML = "";
        setError("");

        const widgetRoot = document.createElement("div");
        widgetRoot.className = "tradingview-widget-container__widget";
        widgetRoot.style.height = "100%";
        widgetRoot.style.width = "100%";
        host.appendChild(widgetRoot);

        const script = document.createElement("script");
        script.src = TV_EMBED_URL;
        script.type = "text/javascript";
        script.async = true;
        script.innerHTML = JSON.stringify(
            createWidgetConfig(symbolRef.current, interval, themeMode),
        );
        script.onerror = () => {
            setError(
                "TradingView failed to load. Check network/adblock and retry.",
            );
        };

        host.appendChild(script);

        const bindIframeWindow = () => {
            const iframe = host.querySelector(
                "iframe",
            ) as HTMLIFrameElement | null;
            if (!iframe?.contentWindow) return false;
            iframeWindowRef.current = iframe.contentWindow;
            return true;
        };

        // Bind iframe window reliably across slow loads/re-inits.
        bindIframeWindow();

        const iframeObserver = new MutationObserver(() => {
            void bindIframeWindow();
        });
        iframeObserver.observe(host, { childList: true, subtree: true });

        let rafId = 0;
        const watchUntilBound = () => {
            if (bindIframeWindow()) return;
            rafId = window.requestAnimationFrame(watchUntilBound);
        };
        watchUntilBound();

        // Hide skeleton after a delay to allow TradingView to render
        const loadingTimeout = setTimeout(() => {
            setLoading(false);
        }, 2000);

        return () => {
            iframeWindowRef.current = null;
            host.innerHTML = "";
            clearTimeout(loadingTimeout);
            iframeObserver.disconnect();
            if (rafId) window.cancelAnimationFrame(rafId);
        };
    }, [interval, themeMode, retrySeed, hydrated]);

    return (
        <div class={styles.root}>
            <div class={styles.chartArea}>
                <div class={styles.dragOverlay}>
                    <div class={styles.passThroughLane} />
                    <div class={styles.actions}>
                        <WidgetDragButton class={styles.dragBtn} />
                        <WidgetRemoveButton
                            class={styles.removeBtn}
                            onClick={onRemove}
                        />
                    </div>
                </div>

                <div
                    class={`tradingview-widget-container ${styles.widgetHost}`}
                    data-widget-id={id}
                    ref={hostRef}
                />

                {loading && <Skeleton variant="rect" />}

                {error && (
                    <div class={styles.errorOverlay}>
                        <div class={styles.errorText}>{error}</div>
                        <button
                            type="button"
                            class={styles.retryBtn}
                            onClick={() => {
                                setLoading(true);
                                setRetrySeed((x) => x + 1);
                            }}
                        >
                            Retry
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

registerWidget({
    type: "advanced-chart",
    label: "Advanced Chart",
    defaultSize: { w: 12, h: 12 },
    minSize: { w: 7, h: 8 },
    component: AdvancedChart,
});

export { AdvancedChart };

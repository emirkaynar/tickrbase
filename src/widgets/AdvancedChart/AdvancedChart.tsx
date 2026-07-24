import { useEffect, useRef, useState } from "preact/hooks";
import { registerWidget } from "../registry";
import { Shell } from "../Shell";
import { api } from "../../services/api";
import { getChartColors } from "../../styles/tokens";
import styles from "./AdvancedChart.module.css";

import { getWidgetStateFromCache } from "../../grid/useLayout";

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
    const [retrySeed] = useState(0);
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

        const cached = getWidgetStateFromCache(id);
        if (cached) {
            const savedSymbol = cached?.symbol?.trim();
            const nextSymbol = savedSymbol || DEFAULT_SYMBOL;
            persistedSymbolRef.current = nextSymbol;
            setSymbol(nextSymbol);
            setHydrated(true);
            return;
        }

        void api.get<any>(`/user/widgets/${id}/state`)
            .then((saved) => {
                if (cancelled) return;
                const savedSymbol = saved?.symbol?.trim();
                const nextSymbol = savedSymbol || DEFAULT_SYMBOL;

                persistedSymbolRef.current = nextSymbol;
                setSymbol(nextSymbol);
            })
            .catch(() => {
                if (!cancelled) setSymbol(DEFAULT_SYMBOL);
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
        void api.put(`/user/widgets/${id}/state`, { symbol });
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
            void api.put(`/user/widgets/${id}/state`, { symbol: shortName });
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
        <Shell
            id={id}
            className={styles.root}
            headerLeft={<div class={styles.heading}>Advanced Chart</div>}
            loading={loading}
            error={error}
            onRemove={onRemove}
        >
            <div class={styles.chartArea}>
                <div
                    class={`tradingview-widget-container ${styles.widgetHost}`}
                    data-widget-id={id}
                    ref={hostRef}
                />
            </div>
        </Shell>
    );
}

registerWidget({
    type: "advanced-chart",
    label: "Advanced Chart",
    defaultSize: { w: 8, h: 9 },
    minSize: { w: 6, h: 6 },
    component: AdvancedChart,
    settingSections: [
        {
            category: "Widgets",
            subcategoryId: "advanced-chart",
            subcategoryLabel: "Advanced Chart",
            subcategoryIcon: "ChartCandlestick",
            settings: [
                {
                    id: "advancedChart.defaultSymbol",
                    type: "string",
                    label: "Default Symbol",
                    description: "The default symbol to show when no symbol is set.",
                    defaultValue: DEFAULT_SYMBOL,
                },
            ],
        },
    ],
});

export { AdvancedChart };

import { useEffect, useRef, useState } from "preact/hooks";
import { fetchHistory } from "../../services/history";
import { fetchMarketContext } from "../../services/marketContext";
import { livePricesClient } from "../../services/livePrices";
import type { LiveTick } from "../../services/livePrices";
import type { Bar, DataCoverage, Interval, MarketContext } from "../../services/types";
import { BarStore, intervalSeconds } from "./barStore";
import { historySessions, regularOnly } from "./sessionPolicy";
import { getWidgetCacheToken, isWidgetCacheCurrent, registerWidgetCache } from "../widgetCache";

type Snapshot = {
    marketContext: MarketContext | null;
    coverage: DataCoverage | null;
    source: string | null;
    lastTick: LiveTick | null;
    historyStale: boolean;
    historyUpdated: string | null;
};
const emptySnapshot: Snapshot = { marketContext: null, coverage: null, source: null, lastTick: null, historyStale: false, historyUpdated: null };
const retained = registerWidgetCache("chartData", new Map<string, { symbol: string; interval: Interval; store: BarStore; snapshot: Snapshot }>());

export function useChartData(id: string, symbol: string, interval: Interval, ready: boolean,
    onBars: (bars: Bar[], fit: boolean, context: MarketContext | null, live: boolean) => void,
    onStatus: (status: "loading" | "ok" | "error", message?: string) => void,
    onWarning: (message: string) => void,
) {
    const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
    const refreshRef = useRef<(() => void) | null>(null);
    useEffect(() => {
        if (!ready) return;
        const cacheToken = getWidgetCacheToken(id);
        if (!isWidgetCacheCurrent(id, cacheToken)) return;
        let cancelled = false;
        const active = () => !cancelled && isWidgetCacheCurrent(id, cacheToken);
        let loading = true;
        let inFlight = false;
        let refreshAgain = false;
        let contextFetchedAt = 0;
        const ctrl = new AbortController();
        const previous = retained.get(id);
        const cached = previous?.symbol === symbol && previous.interval === interval ? previous : null;
        const store = cached?.store ?? new BarStore(interval);
        let current: Snapshot = cached?.snapshot ?? { ...emptySnapshot };
        let calendarStart = current.marketContext?.sessions[0]?.regular_open ?? livePricesClient.now() / 1000 - 350 * 86400;
        let buffered: LiveTick[] = [];
        const commit = () => {
            if (!active()) return;
            retained.set(id, { symbol, interval, store, snapshot: current });
            setSnapshot(current);
        };
        commit();
        onBars(cached?.store.bars(current.marketContext) ?? [], true, current.marketContext, false);
        const refresh = async () => {
            if (!active()) return;
            if (inFlight) { refreshAgain = true; return; }
            inFlight = true;
            const initial = loading;
            if (initial && !cached) onStatus("loading");
            try {
                const now = livePricesClient.now() / 1000;
                let contextStart = calendarStart;
                if (initial || now - contextFetchedAt > 3600) {
                    const requestedStart = Math.max(0, Math.min(store.bars()[0]?.time ?? now - 350 * 86400, now - 7 * 86400), now - 350 * 86400);
                    try {
                        const context = await fetchMarketContext(symbol, requestedStart, now + 8 * 86400, ctrl.signal);
                        if (!active()) return;
                        current = { ...current, marketContext: context };
                        contextStart = requestedStart;
                        calendarStart = requestedStart;
                        contextFetchedAt = now;
                    } catch { /* Calendar failure does not hide otherwise valid prices. */ }
                }
                const intraday = intervalSeconds(interval) !== null;
                const sessions = historySessions(current.marketContext, intraday);
                if (!active()) return;
                const data = await fetchHistory(symbol, interval, "max", initial ? undefined : store.historySince(), ctrl.signal, sessions);
                if (!active()) return;
                // Hourly history may exceed the endpoint's 366-day calendar request limit.
                const firstTime = Math.min(data.candles[0]?.time ?? now, store.bars()[0]?.time ?? now);
                if (intraday && regularOnly(current.marketContext) && firstTime < contextStart) {
                    const calendars = [];
                    while (firstTime < contextStart) {
                        const start = Math.max(firstTime - 86400, contextStart - 350 * 86400);
                        calendars.push(await fetchMarketContext(symbol, start, contextStart, ctrl.signal));
                        if (!active()) return;
                        contextStart = start;
                    }
                    const sessionsByDate = new Map([...calendars.flatMap(context => context.sessions), ...current.marketContext!.sessions].map(session => [session.trading_date, session]));
                    current = { ...current, marketContext: { ...current.marketContext!, sessions: [...sessionsByDate.values()].sort((a, b) => a.regular_open - b.regular_open) } };
                    calendarStart = contextStart;
                }
                const source = data.source ?? "unknown";
                const changedSource = store.source !== null && store.source !== source;
                const cutoff = data.snapshot_time ?? null;
                store.mergeHistory(data.candles, cutoff, source);
                current = { ...current, source, coverage: data.coverage ?? null, historyStale: data.stale, historyUpdated: data.last_updated, lastTick: changedSource || current.lastTick?.source !== source ? null : current.lastTick };
                for (const tick of buffered) {
                    if (tick.source !== source) continue;
                    if (store.shouldReplay(tick, cutoff, current.marketContext)) {
                        store.addTick(tick, current.marketContext);
                    }
                }
                buffered = [];
                loading = false;
                onBars(store.bars(current.marketContext), initial, current.marketContext, false);
                onStatus("ok");
                onWarning("");
                commit();
            } catch (err) {
                if (!active()) return;
                const message = err instanceof Error ? err.message : "History unavailable";
                if (initial && !cached) onStatus("error", message);
                else onWarning(message);
            } finally {
                inFlight = false;
                if (refreshAgain && active()) { refreshAgain = false; void refresh(); }
            }
        };
        refreshRef.current = () => { void refresh(); };
        const offTick = livePricesClient.onTick(tick => {
            if (!active() || tick.symbol !== symbol) return;
            if (!Number.isFinite(tick.price) || tick.price <= 0 || !Number.isFinite(tick.ts)) return;
            if (current.source && tick.source !== current.source) return;
            if (current.lastTick && tick.ts <= current.lastTick.ts) return;
            if (tick.timestamp_origin === "source" && tick.ts > livePricesClient.now() + 5000 && livePricesClient.getClockOffset() !== null) return;
            current = { ...current, lastTick: tick };
            if (loading) buffered.push(tick);
            else if (store.addTick(tick, current.marketContext)) onBars(store.bars(current.marketContext), false, current.marketContext, true);
            commit();
        });
        let wasOpen = false;
        const offStatus = livePricesClient.onStatus(status => {
            if (!active()) return;
            if (status === "open") {
                if (wasOpen) void refresh();
                wasOpen = true;
            }
        });
        const resume = () => { if (active() && document.visibilityState === "visible") { livePricesClient.ping(); void refresh(); } };
        document.addEventListener("visibilitychange", resume);
        const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, intervalSeconds(interval) !== null ? 60_000 : 300_000);
        void refresh();
        return () => {
            cancelled = true;
            buffered = [];
            ctrl.abort();
            offTick(); offStatus();
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", resume);
            refreshRef.current = null;
        };
    }, [id, symbol, interval, ready, onBars, onStatus, onWarning]);
    return { ...snapshot, refresh: () => refreshRef.current?.() };
}

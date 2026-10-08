import { useEffect, useRef, useState } from "preact/hooks";
import { fetchHistory } from "../../../services/history";
import { ApiError } from "../../../services/api";
import { fetchMarketContext } from "../../../services/marketContext";
import { livePricesClient } from "../../../services/livePrices";
import type { LiveStatus, LiveTick } from "../../../services/livePrices";
import type {
  Bar,
  DataCoverage,
  Interval,
  MarketContext,
} from "../../../services/types";
import { BarStore, intervalSeconds } from "../barStore";
import { historySessions, regularOnly } from "../sessionPolicy";
import {
  HISTORY_GRACE_SECONDS,
  HISTORY_SETTLEMENT_SECONDS,
  historyCacheSeconds,
  planHistoryRefresh,
} from "../historyRefresh";
import type { CalendarRange, HistoryRefreshAction } from "../historyRefresh";
import {
  getWidgetCacheToken,
  isWidgetCacheCurrent,
  registerWidgetCache,
} from "../../widgetCache";

type Snapshot = {
  dataSymbol: string | null;
  marketContext: MarketContext | null;
  coverage: DataCoverage | null;
  source: string | null;
  lastTick: LiveTick | null;
  historyStale: boolean;
  historyUpdated: string | null;
};
const emptySnapshot: Snapshot = {
  dataSymbol: null,
  marketContext: null,
  coverage: null,
  source: null,
  lastTick: null,
  historyStale: false,
  historyUpdated: null,
};
const retained = registerWidgetCache(
  "chartData",
  new Map<
    string,
    {
      symbol: string;
      interval: Interval;
      store: BarStore;
      snapshot: Snapshot;
      calendarRange: CalendarRange | null;
      calendarAt: number;
      handledThrough: number;
      settledThrough: number;
      anchor: number | null;
    }
  >(),
);

export function useChartData(
  id: string,
  symbol: string,
  interval: Interval,
  ready: boolean,
  onBars: (
    bars: Bar[],
    fit: boolean,
    context: MarketContext | null,
    live: boolean,
  ) => void,
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
    let timer: number | null = null;
    let authStopped = false;
    const ctrl = new AbortController();
    const previous = retained.get(id);
    const cached =
      previous?.symbol === symbol && previous.interval === interval
        ? previous
        : null;
    const hasCachedHistory = cached?.snapshot.source != null;
    const store = cached?.store ?? new BarStore(interval);
    let current: Snapshot = {
      ...(cached?.snapshot ?? emptySnapshot),
      dataSymbol: symbol,
    };
    let calendarStart =
      current.marketContext?.sessions[0]?.regular_open ??
      livePricesClient.now() / 1000 - 350 * 86400;
    let buffered: LiveTick[] = [];
    let calendarRange = cached?.calendarRange ?? null;
    let calendarAt = cached?.calendarAt ?? 0;
    let handledThrough = cached?.handledThrough ?? -Infinity;
    let settledThrough = cached?.settledThrough ?? -Infinity;
    let anchor = cached?.anchor ?? null;
    let lastAttempt = 0;
    let notBefore = 0;
    let catchUpAt: number | null = null;
    const nowSeconds = () => livePricesClient.now() / 1000;
    const visible = () => document.visibilityState === "visible";
    const clearTimer = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    const updatedSeconds = () => {
      const stamp = current.historyUpdated
        ? Date.parse(current.historyUpdated) / 1000
        : NaN;
      return Number.isFinite(stamp) ? Math.min(stamp, nowSeconds()) : null;
    };
    const plan = (): HistoryRefreshAction => {
      const updated = updatedSeconds();
      const next = planHistoryRefresh({
        now: nowSeconds(),
        interval,
        context: current.marketContext,
        coverage: current.coverage,
        calendarRange,
        calendarAt,
        lastUpdated: updated,
        lastAttempt,
        notBefore,
        handledThrough,
        settledThrough,
        anchor,
      });
      if (
        catchUpAt === null ||
        (next.kind === "calendar" && next.at <= nowSeconds())
      )
        return next;
      const at = Math.max(
        catchUpAt,
        notBefore,
        updated === null ? 0 : updated + historyCacheSeconds(interval) + 1,
      );
      return next.at <= at ? next : { kind: "history", at };
    };
    const arm = () => {
      clearTimer();
      if (!active() || inFlight || authStopped || !visible()) return;
      const action = plan();
      timer = window.setTimeout(
        () => {
          timer = null;
          if (!active() || !visible() || authStopped) return;
          // Crossing a trusted horizon changes the planner to fallback; still
          // service the calendar maintenance that woke us at that horizon.
          const next =
            action.kind === "calendar" && action.at <= nowSeconds()
              ? action
              : plan();
          if (next.at > nowSeconds()) {
            arm();
            return;
          }
          void refresh(next);
        },
        Math.max(1, Math.min((action.at - nowSeconds()) * 1000, 2_147_483_647)),
      );
    };
    const commit = () => {
      if (!active()) return;
      retained.set(id, {
        symbol,
        interval,
        store,
        snapshot: current,
        calendarRange,
        calendarAt,
        handledThrough,
        settledThrough,
        anchor,
      });
      setSnapshot({ ...current, dataSymbol: symbol });
    };
    onWarning("");
    commit();
    onBars(
      cached?.store.bars(current.marketContext) ?? [],
      true,
      current.marketContext,
      false,
    );
    const updateCalendar = async () => {
      const now = nowSeconds();
      const requestedStart = Math.max(
        0,
        Math.min(store.bars()[0]?.time ?? now - 350 * 86400, now - 7 * 86400),
        now - 350 * 86400,
      );
      const requestedEnd = now + 8 * 86400;
      try {
        const context = await fetchMarketContext(
          symbol,
          requestedStart,
          requestedEnd,
          ctrl.signal,
        );
        if (!active()) return;
        const sameMarket =
          current.marketContext?.exchange === context.exchange &&
          current.marketContext?.exchange_timezone ===
            context.exchange_timezone;
        // Calendar-only renewal must not discard older sessions used to filter US bars.
        const olderSessions = sameMarket
          ? current.marketContext!.sessions.filter(
              (session) => session.regular_close <= requestedStart,
            )
          : [];
        const sessionsByDate = new Map(
          [...olderSessions, ...context.sessions].map((session) => [
            session.trading_date,
            session,
          ]),
        );
        current = {
          ...current,
          marketContext: {
            ...context,
            sessions: [...sessionsByDate.values()].sort(
              (a, b) => a.regular_open - b.regular_open,
            ),
          },
        };
        calendarStart =
          sameMarket && calendarRange
            ? Math.min(calendarRange.from, requestedStart)
            : requestedStart;
        calendarRange = { from: calendarStart, to: requestedEnd };
        const coveredUntil = Math.min(
          requestedEnd,
          context.calendar_coverage?.to ?? requestedEnd,
        );
        calendarAt = Math.min(
          now + 86400,
          coveredUntil > now + 3600 ? coveredUntil - 3600 : now + 86400,
        );
      } catch (error) {
        calendarAt = nowSeconds() + 3600;
        if (
          error instanceof ApiError &&
          (error.status === 401 || error.status === 403)
        )
          throw error;
        // Retain usable context and prices; unknown/exhausted calendar time uses fallback cadence.
      }
    };
    // An unchanged/stale response or terminal failure still consumes the attempt;
    // recovery is the next candle or the one best-effort closing settlement.
    const acknowledgeAction = (action: HistoryRefreshAction | undefined) => {
      if (action?.kind !== "history" || action.boundary === undefined) return;
      handledThrough = Math.max(handledThrough, action.boundary);
      if (action.settlement)
        settledThrough = Math.max(settledThrough, action.boundary);
    };
    const refresh = async (action?: HistoryRefreshAction, manual = false) => {
      if (!active() || inFlight || (!manual && (!visible() || authStopped)))
        return;
      clearTimer();
      inFlight = true;
      const initial = loading;
      const calendarOnly = action?.kind === "calendar";
      if (!calendarOnly) {
        catchUpAt = null;
        lastAttempt = nowSeconds();
        notBefore = lastAttempt + historyCacheSeconds(interval) + 1;
      }
      if (initial && !hasCachedHistory && !calendarOnly) onStatus("loading");
      try {
        const previousContext = current.marketContext;
        if (calendarOnly || calendarAt <= nowSeconds()) await updateCalendar();
        if (!active()) return;
        if (calendarOnly) {
          if (
            current.source !== null &&
            (previousContext?.exchange !== current.marketContext?.exchange ||
              previousContext?.instrument_type !==
                current.marketContext?.instrument_type ||
              previousContext?.exchange_timezone !==
                current.marketContext?.exchange_timezone ||
              JSON.stringify(previousContext?.sessions) !==
                JSON.stringify(current.marketContext?.sessions))
          )
            onBars(
              store.bars(current.marketContext),
              false,
              current.marketContext,
              false,
            );
          commit();
          return;
        }
        const now = nowSeconds();
        let contextStart = calendarStart;
        const intraday = intervalSeconds(interval) !== null;
        const sessions = historySessions(current.marketContext, intraday);
        if (!active()) return;
        const data = await fetchHistory(
          symbol,
          interval,
          "max",
          initial ? undefined : store.historySince(),
          ctrl.signal,
          sessions,
        );
        if (!active()) return;
        // Hourly history may exceed the endpoint's 366-day calendar request limit.
        const firstTime = Math.min(
          data.candles[0]?.time ?? now,
          store.bars()[0]?.time ?? now,
        );
        if (
          intraday &&
          regularOnly(current.marketContext) &&
          firstTime < contextStart
        ) {
          const calendars = [];
          while (firstTime < contextStart) {
            const start = Math.max(
              firstTime - 86400,
              contextStart - 350 * 86400,
            );
            calendars.push(
              await fetchMarketContext(
                symbol,
                start,
                contextStart,
                ctrl.signal,
              ),
            );
            if (!active()) return;
            contextStart = start;
          }
          const sessionsByDate = new Map(
            [
              ...calendars.flatMap((context) => context.sessions),
              ...current.marketContext!.sessions,
            ].map((session) => [session.trading_date, session]),
          );
          current = {
            ...current,
            marketContext: {
              ...current.marketContext!,
              sessions: [...sessionsByDate.values()].sort(
                (a, b) => a.regular_open - b.regular_open,
              ),
            },
          };
          calendarStart = contextStart;
          if (calendarRange)
            calendarRange = { ...calendarRange, from: contextStart };
        }
        const source = data.source ?? "unknown";
        const changedSource = store.source !== null && store.source !== source;
        const cutoff = data.snapshot_time ?? null;
        store.mergeHistory(data.candles, cutoff, source);
        current = {
          ...current,
          source,
          coverage: data.coverage ?? null,
          historyStale: data.stale,
          historyUpdated: data.last_updated,
          lastTick:
            changedSource || current.lastTick?.source !== source
              ? null
              : current.lastTick,
        };
        anchor = data.candles.at(-1)?.time ?? anchor;
        const updated = updatedSeconds();
        if (!data.stale && updated !== null) {
          handledThrough = Math.max(
            handledThrough,
            updated - HISTORY_GRACE_SECONDS,
          );
          settledThrough = Math.max(
            settledThrough,
            updated - HISTORY_SETTLEMENT_SECONDS,
          );
          if (catchUpAt !== null && updated >= catchUpAt) catchUpAt = null;
        }
        acknowledgeAction(action);
        for (const tick of buffered) {
          if (tick.source !== source) continue;
          if (store.shouldReplay(tick, cutoff, current.marketContext)) {
            store.addTick(tick, current.marketContext);
          }
        }
        buffered = [];
        loading = false;
        onBars(
          store.bars(current.marketContext),
          initial,
          current.marketContext,
          false,
        );
        onStatus("ok");
        onWarning("");
        commit();
      } catch (err) {
        if (!active()) return;
        acknowledgeAction(action);
        if (!calendarOnly)
          notBefore = Math.max(
            notBefore,
            nowSeconds() + historyCacheSeconds(interval) + 1,
          );
        authStopped =
          err instanceof ApiError && (err.status === 401 || err.status === 403);
        const message =
          err instanceof Error ? err.message : "History unavailable";
        if (initial && !hasCachedHistory) onStatus("error", message);
        else onWarning(message);
        commit();
      } finally {
        inFlight = false;
        arm();
      }
    };
    refreshRef.current = () => {
      authStopped = false;
      void refresh(undefined, true);
    };
    const offTick = livePricesClient.onTick((tick) => {
      if (!active() || tick.symbol !== symbol) return;
      if (
        !Number.isFinite(tick.price) ||
        tick.price <= 0 ||
        !Number.isFinite(tick.ts)
      )
        return;
      if (current.source && tick.source !== current.source) return;
      if (current.lastTick && tick.ts <= current.lastTick.ts) return;
      if (
        tick.timestamp_origin === "source" &&
        tick.ts > livePricesClient.now() + 5000 &&
        livePricesClient.getClockOffset() !== null
      )
        return;
      current = { ...current, lastTick: tick };
      if (loading) buffered.push(tick);
      else if (store.addTick(tick, current.marketContext))
        onBars(
          store.bars(current.marketContext),
          false,
          current.marketContext,
          true,
        );
      commit();
    });
    const requestCatchUp = () => {
      if (!active() || !visible() || authStopped) return;
      catchUpAt = nowSeconds();
      if (inFlight) return;
      const next = plan();
      if (next.at <= nowSeconds()) void refresh(next);
      else arm();
    };
    let wasOpen = false;
    let previousStatus: LiveStatus | null = null;
    const offStatus = livePricesClient.onStatus((status) => {
      if (!active()) return;
      if (status === "open") {
        if (wasOpen && previousStatus !== "open") requestCatchUp();
        wasOpen = true;
      }
      previousStatus = status;
    });
    let wasHidden = !visible();
    const resume = () => {
      if (!active()) return;
      if (!visible()) {
        wasHidden = true;
        clearTimer();
        return;
      }
      if (!wasHidden) return;
      wasHidden = false;
      livePricesClient.ping();
      requestCatchUp();
    };
    document.addEventListener("visibilitychange", resume);
    void refresh(undefined, true);
    return () => {
      cancelled = true;
      buffered = [];
      ctrl.abort();
      offTick();
      offStatus();
      clearTimer();
      document.removeEventListener("visibilitychange", resume);
      refreshRef.current = null;
    };
  }, [id, symbol, interval, ready, onBars, onStatus, onWarning]);
  return { ...snapshot, refresh: () => refreshRef.current?.() };
}

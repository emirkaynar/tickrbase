import type { Bar, MarketContext } from "../../services/types";
import type { LiveTick } from "../../services/livePrices";

export function regularOnly(context: MarketContext | null): context is MarketContext {
    return Boolean(context && ["XNAS", "XNYS"].includes(context.exchange ?? "") && ["EQUITY", "ETF"].includes(context.instrument_type ?? ""));
}

export function historySessions(context: MarketContext | null, intraday: boolean): "regular" | "extended" {
    return intraday && context?.exchange && !regularOnly(context) ? "extended" : "regular";
}

export function regularTime(context: MarketContext, time: number): boolean {
    return context.sessions.some(session => session.regular_open <= time && time < session.regular_close);
}

export function regularBars(bars: Bar[], context: MarketContext | null): Bar[] {
    if (!regularOnly(context)) return bars;
    const sessions = [...context.sessions].sort((a, b) => a.regular_open - b.regular_open);
    let index = 0;
    // Candle stores provide chronological bars; scan rather than searching every day per bar.
    return bars.filter(bar => {
        while (index < sessions.length && sessions[index].regular_close <= bar.time) index++;
        return index < sessions.length && sessions[index].regular_open <= bar.time;
    });
}

export function candleContext(context: MarketContext | null): MarketContext | null {
    return regularOnly(context) ? { ...context, sessions: context.sessions.map(session => ({
        ...session, windows: session.windows.filter(window => window.kind === "regular"),
    })) } : context;
}

export function sessionBoundaries(bars: Bar[], context: MarketContext | null): number[] {
    if (!bars.length || !context) return [];
    const first = bars[0].time, last = bars.at(-1)!.time;
    // Boundary whitespace must stay inside the observed candle range.
    return context.sessions.filter(session => session.regular_open <= last && session.regular_close > first)
        .flatMap(session => [session.regular_open, session.regular_close]).filter(time => time >= first && time <= last);
}

function phaseAt(context: MarketContext, time: number): { kind: "pre" | "post" | "overnight" | "regular"; key: string } | null {
    const horizon = context.calendar_coverage;
    if (!horizon || time < horizon.from || time >= horizon.to) return null;
    const window = context.sessions.flatMap(session => session.windows).find(window => window.start <= time && time < window.end);
    if (window) return { kind: window.kind, key: `${window.kind}:${window.start}` };
    if (!context.exchange_timezone) return null;
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: context.exchange_timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(time * 1000));
    const get = (type: string) => Number(parts.find(part => part.type === type)?.value);
    const hour = get("hour");
    if (hour >= 4 && hour < 20) return null;
    const date = new Date(Date.UTC(get("year"), get("month") - 1, get("day") - (hour < 4 ? 1 : 0)));
    return { kind: "overnight", key: `overnight:${date.toISOString().slice(0, 10)}` };
}

export function extendedQuote(context: MarketContext | null, tick: LiveTick | null, nowMs: number) {
    if (!regularOnly(context) || !tick || tick.symbol !== context.ticker || tick.timestamp_origin !== "source" ||
        !Number.isFinite(tick.price) || tick.price <= 0 || !Number.isFinite(tick.ts) || tick.ts > nowMs + 5000) return null;
    const current = phaseAt(context, nowMs / 1000), observed = phaseAt(context, tick.ts / 1000);
    if (!current || !observed || current.kind === "regular" || current.key !== observed.key) return null;
    return { price: tick.price, kind: current.kind, stale: nowMs - tick.ts > 60_000 };
}

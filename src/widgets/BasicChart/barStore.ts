import type { Bar, Interval, MarketContext } from "../../services/types";
import type { LiveTick } from "../../services/livePrices";
import { regularBars, regularOnly, regularTime } from "./sessionPolicy";

export function intervalSeconds(interval: Interval): number | null {
    return ({ "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600 } as Partial<Record<Interval, number>>)[interval] ?? null;
}

function dateParts(ts: number, zone: string): [number, number, number] {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ts * 1000));
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
    return [get("year"), get("month"), get("day")];
}

/** UTC timestamp of midnight in the exchange timezone, including DST. */
export function exchangeMidnight(year: number, month: number, day: number, zone: string): number {
    const desired = Date.UTC(year, month - 1, day);
    let guess = desired;
    const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    for (let i = 0; i < 3; i++) {
        const parts = formatter.formatToParts(new Date(guess));
        const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
        const localAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
        guess += desired - localAsUtc;
    }
    return guess / 1000;
}

export function tickBucket(ts: number, interval: Interval, context: MarketContext | null, anchor: number | null): number | null {
    const step = intervalSeconds(interval);
    if (step !== null) {
        if (!context?.exchange || regularOnly(context) && !regularTime(context, ts)) return null;
        const window = context?.sessions.flatMap(s => s.windows).find(w => w.start <= ts && ts < w.end);
        const origin = window?.start ?? anchor ?? 0;
        return Math.floor((ts - origin) / step) * step + origin;
    }
    const zone = context?.exchange_timezone;
    // Higher-timeframe history is regular-session data. Unknown sessions cannot
    // safely establish either its trading date or its aggregation boundary.
    if (!zone || !context?.sessions.some(s => s.regular_open <= ts && ts < s.regular_close)) return null;
    const [year, month, day] = dateParts(ts, zone);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (interval === "1wk") date.setUTCDate(day - (date.getUTCDay() + 6) % 7);
    if (interval === "1mo") date.setUTCDate(1);
    return exchangeMidnight(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), zone);
}

export class BarStore {
    private history = new Map<number, Bar>();
    private ticks = new Map<number, LiveTick[]>();
    private lastTick = -Infinity;
    private historicalCursor: number | null = null;
    source: string | null = null;
    readonly interval: Interval;
    constructor(interval: Interval) { this.interval = interval; }

    historySince(): number | undefined {
        return this.historicalCursor === null ? undefined : this.historicalCursor - 2 * (intervalSeconds(this.interval) ?? 86400);
    }

    mergeHistory(bars: Bar[], snapshotMs: number | null, source: string): void {
        if (this.source !== null && this.source !== source) {
            this.history.clear();
            this.ticks.clear();
            this.lastTick = -Infinity;
            this.historicalCursor = null;
        }
        this.source = source;
        for (const bar of bars) {
            this.history.set(bar.time, { ...bar });
            this.historicalCursor = Math.max(this.historicalCursor ?? bar.time, bar.time);
            if (snapshotMs !== null) {
                const retained = (this.ticks.get(bar.time) ?? []).filter(t => t.ts > snapshotMs);
                if (retained.length) this.ticks.set(bar.time, retained);
                else this.ticks.delete(bar.time);
            }
        }
    }

    shouldReplay(tick: LiveTick, snapshotMs: number | null, context: MarketContext | null): boolean {
        const first = this.history.keys().next().value as number | undefined;
        const bucket = tickBucket(tick.ts / 1000, this.interval, context, first ?? null);
        return snapshotMs === null || tick.ts > snapshotMs || bucket !== null && !this.history.has(bucket);
    }

    addTick(tick: LiveTick, context: MarketContext | null): boolean {
        if (tick.timestamp_origin !== "source" || tick.ts <= this.lastTick || !Number.isFinite(tick.price) || tick.price <= 0) return false;
        if (this.source !== null && tick.source !== this.source) return false;
        const first = this.history.keys().next().value as number | undefined;
        const bucket = tickBucket(tick.ts / 1000, this.interval, context, first ?? null);
        if (bucket === null) return false;
        this.source ??= tick.source ?? "unknown";
        this.lastTick = tick.ts;
        const ticks = this.ticks.get(bucket) ?? [];
        ticks.push(tick);
        this.ticks.set(bucket, ticks);
        return true;
    }

    bars(context: MarketContext | null = null): Bar[] {
        const result = new Map(this.history);
        for (const [bucket, ticks] of this.ticks) {
            if (!ticks.length) continue;
            const historical = result.get(bucket);
            const prices = ticks.map(t => t.price);
            const first = ticks[0].price;
            result.set(bucket, {
                time: bucket,
                open: historical?.open ?? first,
                high: prices.reduce((a, b) => Math.max(a, b), historical?.high ?? first),
                low: prices.reduce((a, b) => Math.min(a, b), historical?.low ?? first),
                close: ticks[ticks.length - 1].price,
            });
        }
        const bars = [...result.values()].sort((a, b) => a.time - b.time);
        return intervalSeconds(this.interval) !== null ? regularBars(bars, context) : bars;
    }
}

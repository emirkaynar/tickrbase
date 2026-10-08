import type { LiveTick } from "../../services/livePrices";
import type { DataCoverage, MarketContext } from "../../services/types";
import { extendedQuote } from "./sessionPolicy";

export function marketStatus(context: MarketContext | null, tick: LiveTick | null, coverage: DataCoverage | null, nowMs: number) {
    const now = nowMs / 1000;
    const horizon = context?.calendar_coverage;
    const known = Boolean(horizon && now >= horizon.from && now < horizon.to);
    const windows = context?.sessions.flatMap(s => s.windows) ?? [];
    const current = known ? windows.find(w => w.start <= now && now < w.end) : undefined;
    const trusted = tick?.timestamp_origin === "source";
    const age = trusted ? (nowMs - tick.ts) / 1000 : null;
    const ageValid = age !== null && age >= -5;
    const sourceCovered = Boolean(current && coverage?.sessions.includes(current.kind));
    const activeQuote = extendedQuote(context, tick, nowMs);
    const stale = Boolean(sourceCovered && ageValid && age > 60 || activeQuote?.stale);
    const recentActivity = trusted && ageValid && age < 60;
    const offSessionActivity = known && !current && recentActivity;
    const us = context?.exchange === "XNAS" || context?.exchange === "XNYS";
    const hour = context?.exchange_timezone ? Number(new Intl.DateTimeFormat("en-GB", { timeZone: context.exchange_timezone, hour: "2-digit", hourCycle: "h23" }).format(new Date(nowMs))) : null;
    const overnight = Boolean(activeQuote?.kind === "overnight" || offSessionActivity && us && hour !== null && (hour >= 20 || hour < 4));
    const labels = { regular: "Regular session", pre: "Pre-market", post: "Post-market", overnight: "Overnight" };
    const label = !known ? "Session unknown" : current ? labels[current.kind] : overnight ? "Overnight activity · venue unverified" : "Closed";
    const next = known ? windows.flatMap(w => [w.start, w.end]).filter(t => t > now).sort((a, b) => a - b)[0] ?? null : null;
    const delayed = (tick?.delay_seconds ?? coverage?.delay_seconds ?? 0) > 0;
    return { label, stale, delayed, age: ageValid ? Math.max(0, age) : null, next, current: current?.kind ?? null };
}

export function formatAge(seconds: number): string {
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
}

import type { LiveTick } from "../../services/livePrices";
import type { DataCoverage, MarketContext, SessionWindow } from "../../services/types";
import { extendedQuote } from "./sessionPolicy";

export type MarketStatus = {
    label: string;
    stale: boolean;
    delayed: boolean;
    age: number | null;
    next: number | null;
    current: SessionWindow["kind"] | null;
    known: boolean;
    window: SessionWindow | null;
    nextOpen: number | null;
    delaySeconds: number | null;
};

export type MarketTooltip = {
    title: string;
    timing: string | null;
    range: string | null;
    timezone: string | null;
    session: SessionWindow["kind"] | "closed" | null;
    known: boolean;
};


export function marketStatus(context: MarketContext | null, tick: LiveTick | null, coverage: DataCoverage | null, nowMs: number): MarketStatus {
    const now = nowMs / 1000;
    const horizon = context?.calendar_coverage;
    const known = Boolean(horizon && now >= horizon.from && now < horizon.to);
    const windows = context?.sessions.flatMap(s => s.windows) ?? [];
    const current = known ? windows.find(w => w.start <= now && now < w.end) : undefined;
    const trusted = tick?.timestamp_origin === "source";
    const age = trusted ? (nowMs - tick.ts) / 1000 : null;
    const ageValid = age !== null && Number.isFinite(age) && age >= -5;
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
    const futureCovered = (time: number) => known && time > now && time < horizon!.to;
    const next = windows.flatMap(w => [w.start, w.end]).filter(futureCovered).sort((a, b) => a - b)[0] ?? null;
    const nextOpen = windows.map(w => w.start).filter(futureCovered).sort((a, b) => a - b)[0] ?? null;
    // Measure observed quote lag from the accepted source timestamp, not provider
    // delay metadata. An idle closed market is not a delayed active feed.
    const delaySeconds = ageValid ? Math.floor(Math.max(0, age)) : null;
    const delayed = delaySeconds !== null && delaySeconds > 60 && label !== "Closed";
    return { label, stale, delayed, age: ageValid ? Math.max(0, age) : null, next, current: current?.kind ?? null,
        known, window: current ?? null, nextOpen, delaySeconds };
}

export type MarketCountdown = { text: string; label: string; duration: string; time: number; nextSession: SessionWindow["kind"] | "closed" };

export function marketCountdown(context: MarketContext | null, status: MarketStatus, nowMs: number): MarketCountdown | null {
    const horizon = context?.calendar_coverage;
    if (!context || !horizon || !status.known || !Number.isFinite(nowMs) ||
        (!status.window && status.label !== "Closed")) return null;

    const now = nowMs / 1000;
    const windows = context.sessions.flatMap(session => session.windows)
        .filter(window => Number.isFinite(window.start) && Number.isFinite(window.end) && window.end > window.start);
    const nextWindow = windows.filter(window => window.start > now && window.start < horizon.to)
        .sort((a, b) => a.start - b.start)[0];
    const time = status.window?.end ?? nextWindow?.start;
    // A supplied end at the exclusive coverage boundary is valid, but an opening there is not.
    if (time == null || !Number.isFinite(time) || time > horizon.to) return null;
    const remaining = time - now;
    if (remaining <= 0 || remaining >= 15 * 60) return null;

    const destination = windows.find(window => window.start === time && window.start < horizon.to);
    const names = { regular: "Regular session", pre: "Pre-market", post: "Post-market", overnight: "Overnight" };
    const targets = { regular: "open", pre: "pre", post: "post", overnight: "overnight" };
    const action = destination ? targets[destination.kind] : status.window?.kind === "regular" ? "close" : "end";
    const event = destination ? destination.kind === "regular" ? "Market opens" : `${names[destination.kind]} starts`
        : status.window?.kind === "regular" ? "Market closes" : `${names[status.window!.kind]} ends`;
    const minutes = Math.floor(remaining / 60);
    const duration = remaining < 60 ? "<1m" : `${minutes}m`;
    return {
        text: `${duration} to ${action}`,
        duration,
        label: `${event} in ${remaining < 60 ? "less than one minute" : `${minutes} minute${minutes === 1 ? "" : "s"}`}`,
        time,
        nextSession: destination?.kind ?? "closed",
    };
}

export function formatDelay(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    return [hours ? `${hours}h` : null, minutes ? `${minutes}m` : null]
        .filter(Boolean).join(" ") + " delayed";
}

export function marketTooltip(context: MarketContext | null, tick: LiveTick | null, coverage: DataCoverage | null, nowMs: number): MarketTooltip {
    const status = marketStatus(context, tick, coverage, nowMs);
    const window = status.window;
    // A known calendar gap can still contain unverified activity; do not give it a normal session pill.
    const session = !status.known ? null : window?.kind ?? (status.label === "Closed" ? "closed" : null);
    const titles = { regular: "Market open", pre: "Pre-market", post: "Post-market", overnight: "Overnight session", closed: "Market closed" };
    const delay = status.delaySeconds === null ? "Delay unknown" : status.delayed ? formatDelay(status.delaySeconds) : null;
    const title = `${session ? titles[session] : status.label}${delay ? ` · ${delay}` : ""}`;
    const zone = context?.exchange_timezone ?? null;
    const result: MarketTooltip = { title, timing: null, range: null, timezone: zone ? `Exchange time · ${zone}` : null, session, known: status.known };
    const horizon = context?.calendar_coverage;
    if (!status.known || !horizon) return result;

    // The horizon's exclusive end may be a supplied closing boundary, but never a known next opening.
    if (window && window.end <= horizon.to) {
        const minutes = Math.ceil((window.end * 1000 - nowMs) / 60_000);
        result.timing = `${window.kind === "regular" ? "Closes" : "Ends"} in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    }
    if (!zone) return result;
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const date = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "short", day: "numeric" });
    const dateTime = (seconds: number) => `${date.format(new Date(seconds * 1000))}, ${time.format(new Date(seconds * 1000))}`;
    if (!window && status.nextOpen !== null) result.timing = `Opens ${dateTime(status.nextOpen)} · ${zone}`;
    if (window && window.start >= horizon.from && window.end <= horizon.to) {
        const start = new Date(window.start * 1000), end = new Date(window.end * 1000);
        const crossMidnight = date.format(start) !== date.format(end);
        const range = crossMidnight ? `${dateTime(window.start)}–${dateTime(window.end)}` : `${time.format(start)}–${time.format(end)}`;
        result.range = `${window.kind === "regular" ? "Regular session" : titles[window.kind]}: ${range}`;
    }
    return result;
}

export function formatAge(seconds: number): string {
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
}

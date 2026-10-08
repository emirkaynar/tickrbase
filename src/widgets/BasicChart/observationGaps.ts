import type { Bar, Interval, MarketContext } from "../../services/types";
import { intervalSeconds } from "./barStore";

export type ObservationGap = { start: number; end: number };

/** Missing observations within scheduled windows; closed periods stay compressed. */
export function observationGaps(bars: Bar[], interval: Interval, context: MarketContext | null): ObservationGap[] {
    const step = intervalSeconds(interval);
    if (step === null || !context) return [];
    const windows = context.sessions.flatMap(s => s.windows).sort((a, b) => a.start - b.start);
    let windowIndex = 0;
    const gaps: ObservationGap[] = [];
    for (let i = 1; i < bars.length; i++) {
        const start = bars[i - 1].time + step, end = bars[i].time;
        if (end <= start) continue;
        while (windowIndex < windows.length && windows[windowIndex].end <= start) windowIndex++;
        for (let w = windowIndex; w < windows.length && windows[w].start < end; w++) {
            const window = windows[w];
            const left = Math.max(start, window.start), right = Math.min(end, window.end);
            if (right > left) gaps.push({ start: left, end: right });
        }
    }
    return gaps;
}

export function gapWhitespace(gaps: ObservationGap[], interval: Interval): number[] {
    const step = intervalSeconds(interval);
    if (step === null) return [];
    const times: number[] = [];
    for (const gap of gaps) {
        // Bound additional time-axis points for very sparse long histories.
        const count = Math.ceil((gap.end - gap.start) / step);
        const stride = step * Math.max(1, Math.ceil(count / Math.max(1, 10000 - times.length)));
        for (let time = gap.start; time < gap.end && times.length < 10000; time += stride) times.push(time);
        if (times.length >= 10000) break;
    }
    return times;
}

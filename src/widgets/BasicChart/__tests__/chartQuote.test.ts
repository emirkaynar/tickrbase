import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveTick } from "../../../services/livePrices";
import type { QuoteSnapshot, QuotesResponse } from "../../../services/types";
import { fetchQuotes } from "../../../services/quotes";

const harness = vi.hoisted(() => ({
    state: undefined as unknown,
    refs: [] as Array<{ current: unknown }>,
    refIndex: 0,
    deps: undefined as unknown[] | undefined,
    pending: undefined as (() => (() => void) | undefined) | undefined,
    cleanup: undefined as (() => void) | undefined,
}));
vi.mock("preact/hooks", () => ({
    useState: (initial: unknown) => {
        if (harness.state === undefined) harness.state = initial;
        return [harness.state, (value: unknown) => { harness.state = value; }];
    },
    useRef: (initial: unknown) => {
        const index = harness.refIndex++;
        harness.refs[index] ??= { current: initial };
        return harness.refs[index];
    },
    useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
        if (!harness.deps || deps.some((dep, i) => !Object.is(dep, harness.deps![i]))) {
            harness.pending = effect;
            harness.deps = deps;
        }
    },
}));
vi.mock("../../../services/quotes", async importOriginal => ({
    ...await importOriginal<typeof import("../../../services/quotes")>(),
    fetchQuotes: vi.fn(),
}));

let useChartQuote: typeof import("../hooks/useChartQuote.ts").useChartQuote;
const setPrevClose = vi.fn<(value: number | null) => void>();
const empty = { price: null, currency: null, changePercent: null, snapshot: null, ready: false };
const tick = (symbol: string, price: number, ts = 100): LiveTick => ({ symbol, price, ts, source: "accepted" });
const quote = (symbol: string, overrides: Partial<QuoteSnapshot> = {}): QuoteSnapshot => ({
    symbol, current_price: 110, previous_close: 100, currency: "USD",
    open: null, day_low: null, day_high: null, change: null, change_percent: 999,
    volume: null, volume_value: null, bid: null, ask: null,
    stale: false, last_updated: "2026-10-08T00:00:00Z", ...overrides,
});
const response = (...quotes: QuoteSnapshot[]): QuotesResponse => ({
    symbols: quotes.map(item => item.symbol), quotes, stale: false, last_updated: "2026-10-08T00:00:00Z",
});
function render(symbol = "AAPL", ready = true, lastTick: LiveTick | null = null, handler = setPrevClose) {
    harness.refIndex = 0;
    return useChartQuote(symbol, ready, lastTick, handler);
}
function flushEffect() {
    if (!harness.pending) return;
    harness.cleanup?.();
    const effect = harness.pending;
    harness.pending = undefined;
    harness.cleanup = effect();
}
async function settle() {
    for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(async () => {
    harness.cleanup?.();
    harness.state = undefined;
    harness.refs = [];
    harness.refIndex = 0;
    harness.deps = undefined;
    harness.pending = undefined;
    harness.cleanup = undefined;
    vi.clearAllMocks();
    vi.mocked(fetchQuotes).mockReset();
    ({ useChartQuote } = await import("../hooks/useChartQuote.ts"));
});

describe("useChartQuote (Node hook harness)", () => {
    it("waits for readiness, then requests the session snapshot and resets previous close", () => {
        expect(render("AAPL", false, tick("AAPL", 120))).toEqual(empty);
        flushEffect();
        expect(fetchQuotes).not.toHaveBeenCalled();
        vi.mocked(fetchQuotes).mockReturnValue(new Promise(() => {}));
        expect(render()).toEqual(empty);
        flushEffect();
        expect(fetchQuotes).toHaveBeenCalledWith(["AAPL"], ["session"], expect.any(AbortSignal));
        expect(setPrevClose).toHaveBeenLastCalledWith(null);
    });

    it("becomes ready from a matching snapshot without a live tick, not the first result", async () => {
        const snapshot = quote("AAPL");
        vi.mocked(fetchQuotes).mockResolvedValue(response(quote("AAP", { currency: "EUR" }), snapshot));
        render();
        flushEffect();
        await settle();
        expect(render()).toEqual({ price: 110, currency: "USD", changePercent: 10, snapshot, ready: true });
        expect(setPrevClose).toHaveBeenLastCalledWith(100);
    });

    it("preserves loaded metadata without refetching when the previous-close handler changes", async () => {
        const snapshot = quote("AAPL");
        vi.mocked(fetchQuotes).mockResolvedValueOnce(response(snapshot)).mockReturnValueOnce(new Promise(() => {}));
        render();
        flushEffect();
        await settle();
        const loaded = render();
        const newest = vi.fn<(value: number | null) => void>();
        expect(render("AAPL", true, null, newest)).toEqual(loaded);
        flushEffect();
        expect(render("AAPL", true, null, newest)).toEqual(loaded);
        expect(fetchQuotes).toHaveBeenCalledTimes(1);
        expect(newest).not.toHaveBeenCalled();
        expect(setPrevClose.mock.calls).toEqual([[null], [100]]);
    });

    it("keeps the in-flight request and forwards completion to the newest handler", async () => {
        let resolve!: (value: QuotesResponse) => void;
        vi.mocked(fetchQuotes).mockReturnValueOnce(new Promise(done => { resolve = done; })).mockReturnValueOnce(new Promise(() => {}));
        render();
        flushEffect();
        const signal = vi.mocked(fetchQuotes).mock.calls[0][2]!;
        const newest = vi.fn<(value: number | null) => void>();
        render("AAPL", true, null, newest);
        flushEffect();
        expect(fetchQuotes).toHaveBeenCalledTimes(1);
        expect(signal.aborted).toBe(false);
        const snapshot = quote("AAPL");
        resolve(response(snapshot));
        await settle();
        expect(render("AAPL", true, null, newest)).toEqual({ price: 110, currency: "USD", changePercent: 10, snapshot, ready: true });
        expect(setPrevClose.mock.calls).toEqual([[null]]);
        expect(newest.mock.calls).toEqual([[100]]);
    });

    it("resets previous close using the newest handler when a new load begins", () => {
        vi.mocked(fetchQuotes).mockReturnValue(new Promise(() => {}));
        render();
        flushEffect();
        const scheduled = vi.fn<(value: number | null) => void>();
        const newest = vi.fn<(value: number | null) => void>();
        render("MSFT", true, null, scheduled);
        render("MSFT", true, null, newest);
        flushEffect();
        expect(scheduled).not.toHaveBeenCalled();
        expect(newest.mock.calls).toEqual([[null]]);
        expect(fetchQuotes).toHaveBeenCalledTimes(2);
    });

    it("marks a matching null-price snapshot ready and does not fabricate a price or currency", async () => {
        const snapshot = quote("AAPL", { current_price: null, currency: undefined });
        vi.mocked(fetchQuotes).mockResolvedValue(response(snapshot));
        render();
        flushEffect();
        await settle();
        expect(render()).toEqual({ ...empty, snapshot, ready: true });
    });

    it("keeps the latest accepted tick price and adds percent when its snapshot arrives", async () => {
        let resolve!: (value: QuotesResponse) => void;
        vi.mocked(fetchQuotes).mockReturnValue(new Promise(done => { resolve = done; }));
        const first = tick("AAPL", 120);
        expect(render("AAPL", true, first)).toEqual({ ...empty, price: 120, ready: true });
        flushEffect();
        const latest = tick("AAPL", 130, 101);
        expect(render("AAPL", true, latest).price).toBe(130);
        flushEffect();
        expect(fetchQuotes).toHaveBeenCalledTimes(1);
        const snapshot = quote("AAPL");
        resolve(response(snapshot));
        await settle();
        expect(render("AAPL", true, latest)).toEqual({ price: 130, currency: "USD", changePercent: 30, snapshot, ready: true });
        expect(render("AAPL", true, tick("AAPL", 0))).toEqual({ price: 0, currency: "USD", changePercent: -100, snapshot, ready: true });
    });

    it("uses the supplied accepted tick without filtering its source or timestamp again", async () => {
        vi.mocked(fetchQuotes).mockResolvedValue(response(quote("AAPL")));
        render();
        flushEffect();
        await settle();
        expect(render("AAPL", true, { ...tick("AAPL", 140, 1), source: "alternate", timestamp_origin: "receipt" }).price).toBe(140);
        expect(render("AAPL", true, tick("MSFT", 900)).price).toBe(110);
    });

    it.each([null, 0])("uses calcChangePercent's null result for previous close %s", async previous_close => {
        vi.mocked(fetchQuotes).mockResolvedValue(response(quote("AAPL", { previous_close })));
        render();
        flushEffect();
        await settle();
        expect(render("AAPL", true, tick("AAPL", 120)).changePercent).toBeNull();
        expect(setPrevClose).toHaveBeenLastCalledWith(previous_close);
    });

    it("hides all old-symbol fields immediately before the new effect runs", async () => {
        vi.mocked(fetchQuotes).mockResolvedValueOnce(response(quote("AAPL"))).mockReturnValueOnce(new Promise(() => {}));
        render();
        flushEffect();
        await settle();
        expect(render().ready).toBe(true);
        expect(render("MSFT", true, tick("AAPL", 120))).toEqual(empty);
        flushEffect();
        expect(setPrevClose).toHaveBeenLastCalledWith(null);
        expect(render("MSFT", true, tick("MSFT", 200))).toEqual({ ...empty, price: 200, ready: true });
    });

    it("ignores an old-symbol response even before effect cleanup and rejects it after returning to that symbol", async () => {
        let resolve!: (value: QuotesResponse) => void;
        vi.mocked(fetchQuotes).mockReturnValueOnce(new Promise(done => { resolve = done; })).mockReturnValueOnce(new Promise(() => {}));
        render();
        flushEffect();
        const signal = vi.mocked(fetchQuotes).mock.calls[0][2]!;
        render("MSFT");
        render("AAPL");
        resolve(response(quote("AAPL")));
        await settle();
        expect(render()).toEqual(empty);
        expect(setPrevClose).toHaveBeenCalledTimes(1);
        flushEffect();
        expect(signal.aborted).toBe(true);
    });

    it("does not replace a newer completed snapshot with a late old reply", async () => {
        let resolveOld!: (value: QuotesResponse) => void;
        const snapshot = quote("MSFT", { current_price: 220, previous_close: 200, currency: "EUR" });
        vi.mocked(fetchQuotes)
            .mockReturnValueOnce(new Promise(done => { resolveOld = done; }))
            .mockResolvedValueOnce(response(snapshot));
        render();
        flushEffect();
        render("MSFT");
        flushEffect();
        await settle();
        resolveOld(response(quote("AAPL")));
        await settle();
        expect(render("MSFT")).toEqual({ price: 220, currency: "EUR", changePercent: 10, snapshot, ready: true });
        expect(setPrevClose.mock.calls).toEqual([[null], [null], [200]]);
    });

    it("ignores a pending snapshot after readiness is lost even before cleanup", async () => {
        let resolve!: (value: QuotesResponse) => void;
        vi.mocked(fetchQuotes).mockReturnValue(new Promise(done => { resolve = done; }));
        render();
        flushEffect();
        expect(render("AAPL", false)).toEqual(empty);
        resolve(response(quote("AAPL")));
        await settle();
        expect(harness.state).toBeNull();
        expect(setPrevClose).toHaveBeenCalledTimes(1);
        flushEffect();
        expect(setPrevClose).toHaveBeenLastCalledWith(null);
    });

    it("ignores a pending snapshot after the hook unmounts", async () => {
        let resolve!: (value: QuotesResponse) => void;
        vi.mocked(fetchQuotes).mockReturnValue(new Promise(done => { resolve = done; }));
        render();
        flushEffect();
        harness.cleanup?.();
        resolve(response(quote("AAPL")));
        await settle();
        expect(harness.state).toBeNull();
        expect(setPrevClose).toHaveBeenCalledTimes(1);
        expect(vi.mocked(fetchQuotes).mock.calls[0][2]!.aborted).toBe(true);
    });

    it("leaves unmatched snapshots unavailable and never uses another symbol's previous close", async () => {
        vi.mocked(fetchQuotes).mockResolvedValue(response(quote("AAP"), quote("AAPL.L")));
        render();
        flushEffect();
        await settle();
        expect(render()).toEqual(empty);
        expect(setPrevClose.mock.calls).toEqual([[null]]);
        expect(render("AAPL", true, tick("AAPL", 120))).toEqual({ ...empty, price: 120, ready: true });
    });

    it("handles fetch failure without hiding a matching accepted tick", async () => {
        vi.mocked(fetchQuotes).mockRejectedValue(new Error("offline"));
        render();
        flushEffect();
        await settle();
        expect(render()).toEqual(empty);
        expect(render("AAPL", true, tick("AAPL", 120))).toEqual({ ...empty, price: 120, ready: true });
        expect(setPrevClose.mock.calls).toEqual([[null]]);
    });
});

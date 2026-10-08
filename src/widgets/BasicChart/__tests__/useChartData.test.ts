import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveTick } from "../../../services/livePrices";
import { fetchHistory } from "../../../services/history";
import { fetchMarketContext } from "../../../services/marketContext";
import { activateWidgetCache, clearWidgetCaches, removeWidgetCaches } from "../../widgetCache";
import { useChartData } from "../useChartData";

const harness = vi.hoisted(() => ({
    effects: [] as Array<() => (() => void) | undefined>,
    ticks: new Set<(tick: LiveTick) => void>(),
}));
vi.mock("preact/hooks", () => ({
    useState: (initial: unknown) => [initial, vi.fn()],
    useRef: (initial: unknown) => ({ current: initial }),
    useEffect: (effect: () => (() => void) | undefined) => harness.effects.push(effect),
}));
vi.mock("../../../services/history", () => ({ fetchHistory: vi.fn() }));
vi.mock("../../../services/marketContext", () => ({ fetchMarketContext: vi.fn() }));
vi.mock("../../../services/livePrices", () => ({
    livePricesClient: {
        now: () => 1_791_360_000_000,
        getClockOffset: () => null,
        ping: vi.fn(),
        onTick: (listener: (tick: LiveTick) => void) => {
            harness.ticks.add(listener);
            return () => harness.ticks.delete(listener);
        },
        onStatus: () => () => {},
    },
}));

const bar = { time: 60, open: 10, high: 10, low: 10, close: 10 };
const history = { ticker: "TEST", interval: "1m" as const, candles: [bar], source: "test", snapshot_time: 90_000, stale: false, last_updated: "2026-10-07T00:00:00Z" };
const context = { ticker: "TEST", exchange: "XIST", instrument_type: "EQUITY", exchange_timezone: "Europe/Istanbul", sessions: [], calendar_coverage: null, server_time: 0 };
const cleanups: Array<() => void> = [];

async function settle() {
    for (let i = 0; i < 10; i++) await Promise.resolve();
}

async function mount(id: string) {
    const onBars = vi.fn();
    useChartData(id, "TEST", "1m", true, onBars, vi.fn(), vi.fn());
    const cleanup = harness.effects.pop()!()!;
    cleanups.push(cleanup);
    await settle();
    return { onBars, cleanup };
}

describe("chart data cache lifecycle", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearWidgetCaches();
        harness.effects.length = 0;
        harness.ticks.clear();
        vi.stubGlobal("window", { setInterval: vi.fn(() => 1), clearInterval: vi.fn() });
        vi.stubGlobal("document", { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn() });
        vi.mocked(fetchHistory).mockResolvedValue(history);
        vi.mocked(fetchMarketContext).mockResolvedValue(context);
    });
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
        vi.unstubAllGlobals();
    });

    it("restores bars after a temporary unmount", async () => {
        const id = "temporary-remount";
        activateWidgetCache(id);
        const first = await mount(id);
        first.cleanup();
        const second = await mount(id);
        expect(second.onBars.mock.calls[0][0]).toEqual([bar]);
    });

    it("does not restore deleted widget data when an id is reused", async () => {
        const id = "deleted-chart";
        activateWidgetCache(id);
        const first = await mount(id);
        first.cleanup();
        removeWidgetCaches(id);
        activateWidgetCache(id);
        const second = await mount(id);
        expect(second.onBars.mock.calls[0][0]).toEqual([]);
    });

    it("does not restore another authenticated session's chart data", async () => {
        const id = "session-chart";
        activateWidgetCache(id);
        const first = await mount(id);
        first.cleanup();
        clearWidgetCaches();
        activateWidgetCache(id);
        const second = await mount(id);
        expect(second.onBars.mock.calls[0][0]).toEqual([]);
    });

    it("ignores a history response after permanent eviction even before unmount", async () => {
        let resolve!: (value: typeof history) => void;
        vi.mocked(fetchHistory).mockReturnValueOnce(new Promise(done => { resolve = done; }));
        const id = "late-response";
        activateWidgetCache(id);
        const mounted = await mount(id);
        removeWidgetCaches(id);
        resolve(history);
        await settle();
        expect(mounted.onBars).toHaveBeenCalledTimes(1);
        activateWidgetCache(id);
        const remounted = await mount(id);
        expect(remounted.onBars.mock.calls[0][0]).toEqual([]);
    });

    it("ignores ticks between cache eviction and component cleanup", async () => {
        const id = "late-tick";
        activateWidgetCache(id);
        const mounted = await mount(id);
        const before = mounted.onBars.mock.calls.length;
        removeWidgetCaches(id);
        for (const listener of harness.ticks) listener({ symbol: "TEST", ts: 125_000, price: 12, source: "test", timestamp_origin: "source" });
        expect(mounted.onBars).toHaveBeenCalledTimes(before);
    });
});

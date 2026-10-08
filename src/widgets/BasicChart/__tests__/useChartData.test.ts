import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveStatus, LiveTick } from "../../../services/livePrices";
import type {
  HistoryResponse,
  Interval,
  MarketContext,
} from "../../../services/types";
import { ApiError } from "../../../services/api";
import { fetchHistory } from "../../../services/history";
import { fetchMarketContext } from "../../../services/marketContext";
import {
  activateWidgetCache,
  clearWidgetCaches,
  removeWidgetCaches,
} from "../../widgetCache";
import { useChartData } from "../hooks/useChartData";

const harness = vi.hoisted(() => ({
  effects: [] as Array<() => (() => void) | undefined>,
  ticks: new Set<(tick: LiveTick) => void>(),
  statuses: new Set<(status: LiveStatus) => void>(),
  visibility: new Set<() => void>(),
  now: 1_791_360_000_000,
  timers: new Map<number, { at: number; callback: () => void }>(),
  timerId: 0,
  snapshot: undefined as unknown,
  setSnapshot: vi.fn(),
}));
vi.mock("preact/hooks", () => ({
  useState: (initial: unknown) => [
    harness.snapshot ?? initial,
    (value: unknown) => {
      harness.snapshot = value;
      harness.setSnapshot(value);
    },
  ],
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: (effect: () => (() => void) | undefined) =>
    harness.effects.push(effect),
}));
vi.mock("../../../services/history", () => ({ fetchHistory: vi.fn() }));
vi.mock("../../../services/marketContext", () => ({
  fetchMarketContext: vi.fn(),
}));
vi.mock("../../../services/livePrices", () => ({
  livePricesClient: {
    now: () => harness.now,
    getClockOffset: () => null,
    ping: vi.fn(),
    onTick: (listener: (tick: LiveTick) => void) => {
      harness.ticks.add(listener);
      return () => harness.ticks.delete(listener);
    },
    onStatus: (listener: (status: LiveStatus) => void) => {
      harness.statuses.add(listener);
      return () => harness.statuses.delete(listener);
    },
  },
}));

const bar = { time: 60, open: 10, high: 10, low: 10, close: 10 };
const history: HistoryResponse = {
  ticker: "TEST",
  interval: "1m" as const,
  candles: [bar],
  source: "test",
  snapshot_time: 90_000,
  stale: false,
  last_updated: "2026-10-07T00:00:00Z",
};
const context = {
  ticker: "TEST",
  exchange: "XIST",
  instrument_type: "EQUITY",
  exchange_timezone: "Europe/Istanbul",
  sessions: [],
  calendar_coverage: null,
  server_time: 0,
};
const cleanups: Array<() => void> = [];

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

async function mount(id: string, interval: Interval = "1m") {
  const onBars = vi.fn();
  const onStatus = vi.fn();
  const onWarning = vi.fn();
  const { refresh } = useChartData(
    id,
    "TEST",
    interval,
    true,
    onBars,
    onStatus,
    onWarning,
  );
  const cleanup = harness.effects.pop()!()!;
  cleanups.push(cleanup);
  await settle();
  return { onBars, onStatus, onWarning, refresh, cleanup };
}

function status(value: LiveStatus) {
  for (const listener of harness.statuses) listener(value);
}

function visibility(value: "visible" | "hidden") {
  Object.assign(document, { visibilityState: value });
  for (const listener of harness.visibility) listener();
}

function nextTimer() {
  expect(harness.timers.size).toBe(1);
  return [...harness.timers.values()][0].at / 1000;
}

async function advanceTo(seconds: number) {
  const target = seconds * 1000;
  expect(target).toBeGreaterThanOrEqual(harness.now);
  for (let fired = 0; ; fired++) {
    const next = [...harness.timers.entries()].sort(
      (a, b) => a[1].at - b[1].at,
    )[0];
    if (!next || next[1].at > target) break;
    if (fired >= 100) throw new Error("Unbounded chart refresh timers");
    harness.now = next[1].at;
    harness.timers.delete(next[0]);
    next[1].callback();
    await settle();
  }
  harness.now = target;
  await settle();
}

function deferredHistory() {
  let resolve!: (value: typeof history) => void;
  const promise = new Promise<typeof history>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const scheduledContext: MarketContext = {
  ...context,
  calendar_coverage: { from: 0, to: 1_000_000 },
  sessions: [
    {
      trading_date: "1970-01-01",
      regular_open: 10_000,
      regular_close: 10_600,
      windows: [{ kind: "regular", start: 10_000, end: 10_600 }],
    },
  ],
};
const scheduledHistory = (updated = 10_000) => ({
  ...history,
  candles: [{ ...bar, time: 10_000 }],
  snapshot_time: updated * 1000,
  last_updated: new Date(updated * 1000).toISOString(),
});

describe("chart data cache lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearWidgetCaches();
    harness.effects.length = 0;
    harness.ticks.clear();
    harness.statuses.clear();
    harness.visibility.clear();
    harness.timers.clear();
    harness.timerId = 0;
    harness.now = 1_791_360_000_000;
    harness.snapshot = undefined;
    vi.stubGlobal("window", {
      setTimeout: vi.fn((callback: () => void, delay: number) => {
        const id = ++harness.timerId;
        harness.timers.set(id, { at: harness.now + delay, callback });
        return id;
      }),
      clearTimeout: vi.fn((id: number) => harness.timers.delete(id)),
    });
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: vi.fn((event: string, listener: () => void) => {
        if (event === "visibilitychange") harness.visibility.add(listener);
      }),
      removeEventListener: vi.fn((event: string, listener: () => void) => {
        if (event === "visibilitychange") harness.visibility.delete(listener);
      }),
    });
    vi.mocked(fetchHistory).mockReset().mockResolvedValue(history);
    vi.mocked(fetchMarketContext).mockReset().mockResolvedValue(context);
  });
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.unstubAllGlobals();
  });

  it("returns an unowned empty snapshot before effects run", () => {
    const snapshot = useChartData(
      "unowned",
      "TEST",
      "1m",
      false,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
    expect(snapshot.dataSymbol).toBeNull();
    expect(snapshot.marketContext).toBeNull();
    expect(snapshot.coverage).toBeNull();
  });

  it("tags empty, loaded and live snapshots with their owning symbol", async () => {
    const id = "snapshot-owner";
    activateWidgetCache(id);
    await mount(id);
    expect(harness.setSnapshot.mock.calls[0][0]).toMatchObject({
      dataSymbol: "TEST",
      marketContext: null,
      coverage: null,
    });
    expect(harness.setSnapshot.mock.lastCall?.[0]).toMatchObject({
      dataSymbol: "TEST",
      marketContext: context,
      source: "test",
    });
    const tick: LiveTick = {
      symbol: "TEST",
      ts: 125_000,
      price: 12,
      source: "test",
      timestamp_origin: "source",
    };
    for (const listener of harness.ticks) listener(tick);
    const snapshot = useChartData(
      id,
      "TEST",
      "1m",
      true,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
    expect(snapshot.dataSymbol).toBe("TEST");
    expect(snapshot.lastTick).toEqual(tick);
  });

  it("preserves the previous owner until a symbol-change effect commits", async () => {
    const id = "changed-owner";
    activateWidgetCache(id);
    const first = await mount(id);
    first.cleanup();
    const beforeEffect = useChartData(
      id,
      "OTHER",
      "1m",
      true,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
    expect(beforeEffect.dataSymbol).toBe("TEST");
    expect(beforeEffect.marketContext).toEqual(context);
    const cleanup = harness.effects.pop()!()!;
    cleanups.push(cleanup);
    expect(harness.setSnapshot.mock.lastCall?.[0]).toMatchObject({
      dataSymbol: "OTHER",
      marketContext: null,
      coverage: null,
    });
    await settle();
    expect(harness.setSnapshot.mock.lastCall?.[0].dataSymbol).toBe("OTHER");
  });

  it("tags a restored cached snapshot with its owning symbol", async () => {
    const id = "cached-owner";
    activateWidgetCache(id);
    const first = await mount(id);
    first.cleanup();
    harness.snapshot = undefined;
    harness.setSnapshot.mockClear();
    await mount(id);
    expect(harness.setSnapshot.mock.calls[0][0]).toMatchObject({
      dataSymbol: "TEST",
      marketContext: context,
      source: "test",
    });
  });

  it("clears the previous ticker warning before committing a new ticker snapshot", async () => {
    const id = "warning-ownership";
    activateWidgetCache(id);
    const onWarning = vi.fn();
    const onBars = vi.fn();
    useChartData(id, "NEW", "1m", true, onBars, vi.fn(), onWarning);
    expect(onWarning).not.toHaveBeenCalled();
    const cleanup = harness.effects.pop()!()!;
    cleanups.push(cleanup);
    // The harness queues effects; starting this effect must clear the warning
    // before dataSymbol allows the new summary to show history notices.
    expect(onWarning.mock.calls[0]).toEqual([""]);
    expect(onWarning.mock.invocationCallOrder[0]).toBeLessThan(
      harness.setSnapshot.mock.invocationCallOrder[0],
    );
    await settle();
  });

  it("restores bars after a temporary unmount", async () => {
    const id = "temporary-remount";
    activateWidgetCache(id);
    const first = await mount(id);
    nextTimer();
    first.cleanup();
    expect(harness.timers.size).toBe(0);
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
    vi.mocked(fetchHistory).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
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
    nextTimer();
    removeWidgetCaches(id);
    for (const listener of harness.ticks)
      listener({
        symbol: "TEST",
        ts: 125_000,
        price: 12,
        source: "test",
        timestamp_origin: "source",
      });
    expect(mounted.onBars).toHaveBeenCalledTimes(before);
    await advanceTo(harness.now / 1000 + 900);
    expect(fetchHistory).toHaveBeenCalledTimes(1);
    expect(harness.timers.size).toBe(0);
  });

  describe("chart-local history scheduling", () => {
    beforeEach(() => {
      harness.now = 10_000_000;
      vi.mocked(fetchMarketContext).mockResolvedValue(scheduledContext);
      vi.mocked(fetchHistory).mockResolvedValue(scheduledHistory());
    });

    it.each([false, true])(
      "allows hidden boot but suspends automatic work (initial failure: %s)",
      async (failure) => {
        visibility("hidden");
        if (failure)
          vi.mocked(fetchHistory).mockRejectedValueOnce(new Error("Offline"));
        activateWidgetCache("hidden-boot");
        const mounted = await mount("hidden-boot");
        expect(fetchHistory).toHaveBeenCalledTimes(1);
        expect(mounted.onStatus.mock.lastCall).toEqual(
          failure ? ["error", "Offline"] : ["ok"],
        );
        expect(harness.timers.size).toBe(0);
        status("open");
        status("reconnecting");
        status("open");
        await advanceTo(10_070);
        expect(fetchHistory).toHaveBeenCalledTimes(1);
        visibility("visible");
        await settle();
        expect(fetchHistory).toHaveBeenCalledTimes(2);
        nextTimer();
      },
    );

    it("advances attempted boundaries with unchanged cached timestamps and settles only once", async () => {
      activateWidgetCache("unchanged-cache");
      await mount("unchanged-cache", "5m");
      expect(nextTimer()).toBe(10_305);
      await advanceTo(10_304);
      expect(fetchHistory).toHaveBeenCalledTimes(1);
      await advanceTo(10_305);
      expect(fetchHistory).toHaveBeenCalledTimes(2);
      expect(nextTimer()).toBe(10_605);
      await advanceTo(10_604);
      expect(fetchHistory).toHaveBeenCalledTimes(2);
      await advanceTo(10_605);
      expect(fetchHistory).toHaveBeenCalledTimes(3);
      expect(nextTimer()).toBe(11_500);
      await advanceTo(11_499);
      expect(fetchHistory).toHaveBeenCalledTimes(3);
      await advanceTo(11_500);
      expect(fetchHistory).toHaveBeenCalledTimes(4);
      await advanceTo(20_000);
      expect(fetchHistory).toHaveBeenCalledTimes(4);
      expect(nextTimer()).toBe(96_400);
    });

    it.each<[Interval, number]>([
      ["1m", 10_141],
      ["1d", 10_681],
    ])(
      "respects returned last_updated plus TTL plus one for %s",
      async (interval, due) => {
        const pending = deferredHistory();
        vi.mocked(fetchHistory).mockReturnValueOnce(pending.promise);
        activateWidgetCache("cache-ttl");
        await mount("cache-ttl", interval);
        await advanceTo(10_080);
        pending.resolve(scheduledHistory(10_080));
        await settle();
        expect(nextTimer()).toBe(due);
        await advanceTo(due - 1);
        expect(fetchHistory).toHaveBeenCalledTimes(1);
        await advanceTo(due);
        expect(fetchHistory).toHaveBeenCalledTimes(2);
      },
    );

    it("keeps recovery bounded across reconnect and visibility events after a failed refresh", async () => {
      activateWidgetCache("recovery-floor");
      const mounted = await mount("recovery-floor");
      vi.mocked(fetchHistory).mockRejectedValueOnce(new Error("Offline"));
      await advanceTo(10_065);
      expect(mounted.onWarning).toHaveBeenCalledWith("Offline");
      expect(nextTimer()).toBe(10_126);
      status("open");
      status("reconnecting");
      status("open");
      visibility("hidden");
      visibility("visible");
      await settle();
      await advanceTo(10_125);
      expect(fetchHistory).toHaveBeenCalledTimes(2);
      expect(nextTimer()).toBe(10_126);
      await advanceTo(10_126);
      expect(fetchHistory).toHaveBeenCalledTimes(3);
      nextTimer();
    });

    it("does not poll known closed sessions and retries calendar-only maintenance after one hour", async () => {
      vi.mocked(fetchMarketContext).mockImplementation(async () => ({
        ...scheduledContext,
        sessions: [],
      }));
      activateWidgetCache("closed-calendar");
      const mounted = await mount("closed-calendar");
      const renders = mounted.onBars.mock.calls.length;
      expect(nextTimer()).toBe(96_400);
      await advanceTo(96_399);
      expect(fetchHistory).toHaveBeenCalledTimes(1);
      expect(fetchMarketContext).toHaveBeenCalledTimes(1);
      vi.mocked(fetchMarketContext).mockRejectedValueOnce(
        new Error("Calendar unavailable"),
      );
      await advanceTo(96_400);
      expect(fetchMarketContext).toHaveBeenCalledTimes(2);
      expect(nextTimer()).toBe(100_000);
      await advanceTo(99_999);
      expect(fetchMarketContext).toHaveBeenCalledTimes(2);
      await advanceTo(100_000);
      expect(fetchMarketContext).toHaveBeenCalledTimes(3);
      expect(fetchHistory).toHaveBeenCalledTimes(1);
      expect(mounted.onBars).toHaveBeenCalledTimes(renders);
      expect(nextTimer()).toBe(186_400);
    });

    it("services horizon maintenance before switching to unknown-calendar fallback", async () => {
      vi.mocked(fetchMarketContext)
        .mockResolvedValueOnce({
          ...scheduledContext,
          calendar_coverage: { from: 0, to: 10_500 },
        })
        .mockResolvedValue(context);
      activateWidgetCache("horizon-maintenance");
      await mount("horizon-maintenance", "5m");
      expect(nextTimer()).toBe(10_305);
      await advanceTo(10_305);
      expect(fetchHistory).toHaveBeenCalledTimes(2);
      expect(nextTimer()).toBe(10_500);
      await advanceTo(10_500);
      expect(fetchMarketContext).toHaveBeenCalledTimes(2);
      expect(fetchHistory).toHaveBeenCalledTimes(2);
      expect(nextTimer()).toBe(10_605);
      await advanceTo(10_605);
      expect(fetchHistory).toHaveBeenCalledTimes(3);
      expect(fetchMarketContext).toHaveBeenCalledTimes(2);
      expect(nextTimer()).toBe(10_905);
    });

    it.each<[Interval, number]>([
      ["1m", 61],
      ["5m", 300],
      ["1d", 900],
    ])(
      "uses bounded unknown-calendar cadence for %s",
      async (interval, delay) => {
        vi.mocked(fetchMarketContext).mockResolvedValue(context);
        vi.mocked(fetchHistory).mockImplementation(async () =>
          scheduledHistory(harness.now / 1000),
        );
        activateWidgetCache("unknown-calendar");
        await mount("unknown-calendar", interval);
        expect(nextTimer()).toBe(10_000 + delay);
        await advanceTo(10_000 + delay - 1);
        expect(fetchHistory).toHaveBeenCalledTimes(1);
        await advanceTo(10_000 + delay);
        expect(fetchHistory).toHaveBeenCalledTimes(2);
        expect(nextTimer()).toBe(10_000 + 2 * delay);
      },
    );

    it.each(["reconnect", "resume"])(
      "ignores initial/repeated open and coalesces in-flight %s catch-up",
      async (trigger) => {
        activateWidgetCache("catch-up");
        await mount("catch-up");
        status("open");
        status("open");
        visibility("visible");
        await settle();
        expect(fetchHistory).toHaveBeenCalledTimes(1);
        await advanceTo(10_020);
        status("reconnecting");
        status("open");
        await settle();
        expect(fetchHistory).toHaveBeenCalledTimes(1);
        nextTimer();
        if (trigger === "resume") {
          visibility("hidden");
          expect(harness.timers.size).toBe(0);
          await advanceTo(10_070);
        } else {
          // The socket event arrives before an overdue timer gets its turn.
          harness.now = 10_070_000;
        }
        const pending = deferredHistory();
        vi.mocked(fetchHistory).mockReturnValueOnce(pending.promise);
        if (trigger === "resume") visibility("visible");
        else {
          status("reconnecting");
          status("open");
        }
        await settle();
        expect(fetchHistory).toHaveBeenCalledTimes(2);
        expect(harness.timers.size).toBe(0);
        visibility("hidden");
        visibility("visible");
        status("closed");
        status("open");
        pending.resolve(scheduledHistory(10_070));
        await settle();
        expect(fetchHistory).toHaveBeenCalledTimes(2);
        nextTimer();
        await advanceTo(10_130);
        expect(fetchHistory).toHaveBeenCalledTimes(2);
      },
    );

    it.each([401, 403])(
      "stops automatic work after auth %s until manual refresh",
      async (code) => {
        vi.mocked(fetchHistory).mockRejectedValueOnce(
          new ApiError(code, "Sign in"),
        );
        activateWidgetCache("auth-stop");
        const mounted = await mount("auth-stop");
        expect(mounted.onStatus).toHaveBeenCalledWith("error", "Sign in");
        expect(harness.timers.size).toBe(0);
        status("open");
        status("closed");
        status("open");
        visibility("hidden");
        visibility("visible");
        await advanceTo(11_000);
        expect(fetchHistory).toHaveBeenCalledTimes(1);
        expect(harness.timers.size).toBe(0);
        vi.mocked(fetchHistory).mockResolvedValue(scheduledHistory(11_000));
        mounted.refresh();
        await settle();
        expect(fetchHistory).toHaveBeenCalledTimes(2);
        expect(mounted.onStatus).toHaveBeenCalledWith("ok");
        nextTimer();
      },
    );

    it.each(["cleanup", "removal"])(
      "stops timers and late history commits on %s",
      async (action) => {
        activateWidgetCache("scheduler-lifetime");
        const mounted = await mount("scheduler-lifetime");
        const pending = deferredHistory();
        vi.mocked(fetchHistory).mockReturnValueOnce(pending.promise);
        await advanceTo(10_065);
        const renders = mounted.onBars.mock.calls.length;
        const commits = harness.setSnapshot.mock.calls.length;
        const signal = vi.mocked(fetchHistory).mock.lastCall?.[4];
        if (action === "cleanup") {
          mounted.cleanup();
          expect(signal?.aborted).toBe(true);
          expect(
            harness.ticks.size +
              harness.statuses.size +
              harness.visibility.size,
          ).toBe(0);
        } else removeWidgetCaches("scheduler-lifetime");
        pending.resolve(scheduledHistory(10_065));
        await settle();
        expect(harness.timers.size).toBe(0);
        status("closed");
        status("open");
        visibility("hidden");
        visibility("visible");
        await advanceTo(20_000);
        expect(fetchHistory).toHaveBeenCalledTimes(2);
        expect(mounted.onBars).toHaveBeenCalledTimes(renders);
        expect(harness.setSnapshot).toHaveBeenCalledTimes(commits);
      },
    );

    it("reports loading/error after remounting a failure-only cache", async () => {
      const closed = { ...scheduledContext, sessions: [] };
      vi.mocked(fetchMarketContext).mockResolvedValue(closed);
      vi.mocked(fetchHistory).mockRejectedValue(new Error("Offline"));
      activateWidgetCache("failed-remount");
      const first = await mount("failed-remount");
      expect(first.onStatus.mock.calls).toEqual([
        ["loading"],
        ["error", "Offline"],
      ]);
      first.cleanup();
      harness.snapshot = undefined;
      const second = await mount("failed-remount");
      expect(fetchHistory).toHaveBeenCalledTimes(2);
      expect(second.onStatus.mock.calls).toEqual([
        ["loading"],
        ["error", "Offline"],
      ]);
      expect(second.onWarning.mock.calls).toEqual([[""]]);
      vi.mocked(fetchMarketContext).mockResolvedValue({
        ...closed,
        instrument_type: "ETF",
      });
      await advanceTo(96_400);
      expect(fetchMarketContext).toHaveBeenCalledTimes(2);
      expect(fetchHistory).toHaveBeenCalledTimes(2);
      expect(second.onBars).toHaveBeenCalledTimes(1);
    });

    it("preserves US hourly bars older than 350 days through calendar-only renewal", async () => {
      const day = 86_400;
      const now = 1_791_360_000;
      harness.now = now * 1000;
      const session = (open: number) => ({
        trading_date: new Date(open * 1000).toISOString().slice(0, 10),
        regular_open: open,
        regular_close: open + 3600,
        windows: [{ kind: "regular" as const, start: open, end: open + 3600 }],
      });
      const older = session(now - 351 * day);
      const atRenewalStart = session(now - 349 * day - 3600);
      const recent = session(now - 7200);
      const candle = { ...bar, time: older.regular_open + 60 };
      const edgeCandle = { ...bar, time: atRenewalStart.regular_open + 60 };
      vi.mocked(fetchHistory).mockResolvedValue({
        ...scheduledHistory(now),
        interval: "1h",
        candles: [candle, edgeCandle],
      });
      vi.mocked(fetchMarketContext).mockImplementation(
        async (_symbol, from, to) => ({
          ...context,
          exchange: "XNAS",
          exchange_timezone: "America/New_York",
          calendar_coverage: { from, to },
          server_time: harness.now / 1000,
          sessions: [
            older,
            atRenewalStart,
            ...(harness.now / 1000 >= now + day ? [recent] : []),
          ].filter((s) => s.regular_open < to && s.regular_close > from),
        }),
      );
      activateWidgetCache("long-hourly-calendar");
      const mounted = await mount("long-hourly-calendar", "1h");
      expect(fetchMarketContext).toHaveBeenCalledTimes(2);
      expect(mounted.onBars.mock.lastCall?.[0]).toEqual([candle, edgeCandle]);
      expect(nextTimer()).toBe(now + day);
      await advanceTo(now + day);
      expect(fetchHistory).toHaveBeenCalledTimes(1);
      expect(fetchMarketContext).toHaveBeenCalledTimes(3);
      expect(vi.mocked(fetchMarketContext).mock.lastCall?.[1]).toBe(
        now - 349 * day,
      );
      expect(mounted.onBars).toHaveBeenCalledTimes(3);
      expect(mounted.onBars.mock.lastCall?.[0]).toEqual([candle, edgeCandle]);
      expect(mounted.onBars.mock.lastCall?.[1]).toBe(false);
      expect(mounted.onBars.mock.lastCall?.[2].sessions).toEqual([
        older,
        atRenewalStart,
        recent,
      ]);
    });

    it("does not retry a failed final settlement", async () => {
      activateWidgetCache("failed-settlement");
      const mounted = await mount("failed-settlement", "5m");
      await advanceTo(10_605);
      expect(fetchHistory).toHaveBeenCalledTimes(3);
      expect(nextTimer()).toBe(11_500);
      vi.mocked(fetchHistory).mockRejectedValueOnce(
        new Error("Settlement unavailable"),
      );
      await advanceTo(11_500);
      expect(fetchHistory).toHaveBeenCalledTimes(4);
      expect(mounted.onWarning).toHaveBeenCalledWith("Settlement unavailable");
      await advanceTo(20_000);
      expect(fetchHistory).toHaveBeenCalledTimes(4);
      expect(nextTimer()).toBe(96_400);
    });

    it("delays one catch-up when in-flight history predates resume/reconnect", async () => {
      activateWidgetCache("older-inflight-response");
      await mount("older-inflight-response", "5m");
      status("open");
      const pending = deferredHistory();
      vi.mocked(fetchHistory).mockReturnValueOnce(pending.promise);
      await advanceTo(10_305);
      await advanceTo(10_310);
      visibility("hidden");
      visibility("visible");
      status("reconnecting");
      status("open");
      expect(fetchHistory).toHaveBeenCalledTimes(2);
      expect(harness.timers.size).toBe(0);
      pending.resolve(scheduledHistory(10_305));
      await settle();
      expect(fetchHistory).toHaveBeenCalledTimes(2);
      expect(nextTimer()).toBe(10_366);
      await advanceTo(10_365);
      expect(fetchHistory).toHaveBeenCalledTimes(2);
      vi.mocked(fetchHistory).mockResolvedValue(scheduledHistory(10_366));
      await advanceTo(10_366);
      expect(fetchHistory).toHaveBeenCalledTimes(3);
      expect(nextTimer()).toBe(10_605);
      await advanceTo(10_604);
      expect(fetchHistory).toHaveBeenCalledTimes(3);
    });

    it("retains history volume through buffered prices and a temporary remount", async () => {
      const pending = deferredHistory();
      vi.mocked(fetchHistory).mockReturnValueOnce(pending.promise);
      activateWidgetCache("buffered-volume");
      const first = await mount("buffered-volume");
      for (const listener of harness.ticks)
        listener({
          symbol: "TEST",
          ts: 10_005_000,
          price: 15,
          source: "test",
          timestamp_origin: "source",
        });
      pending.resolve({
        ...scheduledHistory(),
        candles: [{ ...bar, time: 10_000, volume: 123 }],
      });
      await settle();
      const expected = [
        { ...bar, time: 10_000, high: 15, close: 15, volume: 123 },
      ];
      expect(first.onBars.mock.lastCall?.[0]).toEqual(expected);
      expect(fetchHistory).toHaveBeenCalledTimes(1);
      expect(nextTimer()).toBe(10_065);
      first.cleanup();
      const second = await mount("buffered-volume");
      expect(second.onBars.mock.calls[0][0]).toEqual(expected);
    });

    it("merges scheduled volume without discarding newer live ticks or refitting", async () => {
      activateWidgetCache("scheduled-merge");
      const mounted = await mount("scheduled-merge");
      const pending = deferredHistory();
      vi.mocked(fetchHistory).mockReturnValueOnce(pending.promise);
      await advanceTo(10_065);
      for (const listener of harness.ticks)
        listener({
          symbol: "TEST",
          ts: 10_070_000,
          price: 15,
          source: "test",
          timestamp_origin: "source",
        });
      pending.resolve({
        ...scheduledHistory(10_065),
        candles: [
          { ...bar, time: 10_000, close: 11, high: 11, volume: 100 },
          { ...bar, time: 10_060, close: 12, high: 12, volume: 200 },
        ],
      });
      await settle();
      expect(fetchHistory).toHaveBeenCalledTimes(2);
      expect(vi.mocked(fetchHistory).mock.lastCall?.[3]).toBe(9_880);
      expect(mounted.onBars.mock.lastCall).toEqual([
        [
          { ...bar, time: 10_000, close: 11, high: 11, volume: 100 },
          { ...bar, time: 10_060, close: 15, high: 15, volume: 200 },
        ],
        false,
        scheduledContext,
        false,
      ]);
      nextTimer();
    });
  });
});

import { describe, expect, it } from "vitest";
import { BarStore, exchangeMidnight, tickBucket } from "../barStore";
import type { Bar, MarketContext } from "../../../services/types";

const bar = (time: number, close = 10) => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
});
const tick = (ts: number, price = 12) => ({
  symbol: "TEST",
  ts: ts * 1000,
  price,
  source: "test",
  timestamp_origin: "source" as const,
});
const intradayContext: MarketContext = {
  ticker: "TEST",
  exchange: "XIST",
  instrument_type: "EQUITY",
  exchange_timezone: "Europe/Istanbul",
  sessions: [],
  calendar_coverage: null,
  server_time: 0,
};

describe("history and live reconciliation", () => {
  it("repairs older gaps after a live tick has advanced the chart", () => {
    const store = new BarStore("1m");
    store.mergeHistory([bar(60)], 90_000, "test");
    store.addTick(tick(600), intradayContext);
    expect(store.historySince()).toBe(-60);
    store.mergeHistory([bar(120), bar(180)], 240_000, "test");
    expect(store.bars().map((b) => b.time)).toEqual([60, 120, 180, 600]);
    expect(store.bars().at(-1)?.open).toBe(12);
  });

  it("buffers ticks before history and replays ticks newer than its snapshot", () => {
    const store = new BarStore("1m");
    store.addTick(tick(125, 15), intradayContext);
    store.mergeHistory([bar(120)], 123_000, "test");
    expect(store.bars().at(-1)).toEqual({
      time: 120,
      open: 10,
      high: 15,
      low: 10,
      close: 15,
    });
    store.mergeHistory([bar(120, 14)], 130_000, "test");
    expect(store.bars().at(-1)?.close).toBe(14);
  });

  it("rejects duplicate and out-of-order prices", () => {
    const store = new BarStore("1m");
    expect(store.addTick(tick(125), intradayContext)).toBe(true);
    expect(store.addTick(tick(124, 99), intradayContext)).toBe(false);
    expect(store.addTick(tick(125, 99), intradayContext)).toBe(false);
    expect(store.bars().at(-1)?.close).toBe(12);
  });

  it("isolates sources instead of mixing their candles", () => {
    const store = new BarStore("1m");
    store.mergeHistory([bar(60)], 90_000, "first");
    store.mergeHistory([bar(120, 20)], 130_000, "second");
    expect(store.bars()).toEqual([bar(120, 20)]);
    expect(store.addTick(tick(180), null)).toBe(false);
  });

  it("uses exchange trading dates and leaves extended prices out of daily candles", () => {
    const opened = Date.parse("2026-10-07T07:00:00Z") / 1000;
    const closed = Date.parse("2026-10-07T15:00:00Z") / 1000;
    const context: MarketContext = {
      ticker: "TEST",
      exchange: "XIST",
      instrument_type: "EQUITY",
      exchange_timezone: "Europe/Istanbul",
      server_time: 0,
      calendar_coverage: null,
      sessions: [
        {
          trading_date: "2026-10-07",
          regular_open: opened,
          regular_close: closed,
          windows: [{ kind: "regular", start: opened, end: closed }],
        },
      ],
    };
    expect(tickBucket(opened + 60, "1d", context, null)).toBe(
      Date.parse("2026-10-06T21:00:00Z") / 1000,
    );
    expect(tickBucket(closed + 60, "1d", context, null)).toBeNull();
    expect(tickBucket(opened + 60, "1wk", context, null)).toBe(
      Date.parse("2026-10-04T21:00:00Z") / 1000,
    );
    expect(exchangeMidnight(2026, 3, 9, "America/New_York")).toBe(
      Date.parse("2026-03-09T04:00:00Z") / 1000,
    );
  });
});

describe("historical volume reconciliation", () => {
  const reportedBar = (time: number, volume?: number | null): Bar =>
    volume === undefined ? bar(time) : { ...bar(time), volume };

  it.each([100, 0, null, undefined])(
    "preserves history volume %s through newer price ticks",
    (volume) => {
      const store = new BarStore("1m");
      const historical: Bar = reportedBar(120, volume);
      store.mergeHistory([historical], 123_000, "test");
      expect(store.bars()).toStrictEqual([historical]);
      store.addTick(tick(125, 15), intradayContext);
      store.addTick(tick(126, 5), intradayContext);
      store.addTick(tick(127, 12), intradayContext);
      expect(store.bars()).toStrictEqual([
        { ...historical, high: 15, low: 5, close: 12 },
      ]);
    },
  );

  it("leaves tick-only volume absent rather than inheriting history or inventing zero", () => {
    const store = new BarStore("1m");
    store.mergeHistory([reportedBar(60, 100)], 90_000, "test");
    store.addTick(tick(125), intradayContext);
    expect(store.bars()).toStrictEqual([reportedBar(60, 100), bar(120, 12)]);
    expect(store.bars()[1]).not.toHaveProperty("volume");
  });

  it.each([25, 0, null, undefined])(
    "replaces positive volume with %s while retaining post-snapshot ticks",
    (volume) => {
      const store = new BarStore("1m");
      store.mergeHistory([reportedBar(120, 100)], 123_000, "test");
      store.addTick(tick(124, 99), intradayContext);
      store.addTick(tick(135, 15), intradayContext);
      const refreshed: Bar = reportedBar(120, volume);
      store.mergeHistory([refreshed], 130_000, "test");
      expect(store.bars()).toStrictEqual([
        { ...refreshed, high: 15, close: 15 },
      ]);
      store.mergeHistory([refreshed], 140_000, "test");
      expect(store.bars()).toStrictEqual([refreshed]);
    },
  );

  it("copies volume during older gap repair and clears it on a source change", () => {
    const store = new BarStore("1m");
    store.mergeHistory([reportedBar(60, 100)], 90_000, "test");
    store.addTick(tick(600), intradayContext);
    const repaired: Bar[] = [reportedBar(120, 25), reportedBar(180, 0)];
    store.mergeHistory(repaired, 240_000, "test");
    expect(store.bars()).toStrictEqual([
      reportedBar(60, 100),
      ...repaired,
      bar(600, 12),
    ]);
    const replacement: Bar = bar(60);
    store.mergeHistory([replacement], 90_000, "second");
    store.addTick({ ...tick(65), source: "second" }, intradayContext);
    expect(store.bars()).toStrictEqual([
      { ...replacement, high: 12, close: 12 },
    ]);
    expect(store.bars()[0]).not.toHaveProperty("volume");
  });

  it.each(["1d", "1wk"] as const)(
    "retains reported volume after a %s price tick",
    (interval) => {
      const opened = Date.parse("2026-10-07T07:00:00Z") / 1000;
      const closed = Date.parse("2026-10-07T15:00:00Z") / 1000;
      const context: MarketContext = {
        ...intradayContext,
        sessions: [
          {
            trading_date: "2026-10-07",
            regular_open: opened,
            regular_close: closed,
            windows: [{ kind: "regular", start: opened, end: closed }],
          },
        ],
      };
      const time =
        Date.parse(
          interval === "1d" ? "2026-10-06T21:00:00Z" : "2026-10-04T21:00:00Z",
        ) / 1000;
      const historical: Bar = reportedBar(time, 100);
      const store = new BarStore(interval);
      store.mergeHistory([historical], opened * 1000, "test");
      expect(store.addTick(tick(opened + 60, 15), context)).toBe(true);
      expect(store.bars(context)).toStrictEqual([
        { ...historical, high: 15, close: 15 },
      ]);
    },
  );

  it("keeps the correct volumes when filtering to regular-only sessions", () => {
    const context: MarketContext = {
      ...intradayContext,
      exchange: "XNAS",
      sessions: [
        {
          trading_date: "1970-01-01",
          regular_open: 120,
          regular_close: 240,
          windows: [{ kind: "regular", start: 120, end: 240 }],
        },
      ],
    };
    const history: Bar[] = [
      reportedBar(60, 100),
      reportedBar(120, 0),
      reportedBar(180, null),
      reportedBar(240, 200),
    ];
    const store = new BarStore("1m");
    store.mergeHistory(history, 123_000, "test");
    store.addTick(tick(125, 15), context);
    store.addTick(tick(185), context);
    expect(store.bars(context)).toStrictEqual([
      { ...reportedBar(120, 0), high: 15, close: 15 },
      { ...reportedBar(180, null), high: 12, close: 12 },
    ]);
  });

  it("does not mutate history, refresh, tick, or context inputs", () => {
    const history: Bar[] = [Object.freeze(reportedBar(120, 100))];
    const refresh: Bar[] = [Object.freeze(reportedBar(120, null))];
    const price = Object.freeze(tick(135, 15));
    const context: MarketContext = structuredClone(intradayContext);
    const before = structuredClone({ history, refresh, price, context });
    const store = new BarStore("1m");
    store.mergeHistory(history, 123_000, "test");
    store.addTick(price, context);
    store.bars(context);
    store.mergeHistory(refresh, 130_000, "test");
    expect(store.bars(context)).toStrictEqual([
      { ...refresh[0], high: 15, close: 15 },
    ]);
    expect({ history, refresh, price, context }).toStrictEqual(before);
  });
});

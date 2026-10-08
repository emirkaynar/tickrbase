import { describe, expect, it } from "vitest";
import type {
  DataCoverage,
  Interval,
  MarketContext,
  MarketSession,
  SessionWindow,
} from "../../../services/types";
import {
  HISTORY_GRACE_SECONDS,
  HISTORY_SETTLEMENT_SECONDS,
  historyCacheSeconds,
  planHistoryRefresh,
} from "../historyRefresh.ts";

const window = (
  kind: SessionWindow["kind"],
  start: number,
  end: number,
): SessionWindow => ({ kind, start, end });
const session = (
  windows: SessionWindow[],
  open = 1000,
  close = 10_000,
): MarketSession => ({
  trading_date: "test",
  regular_open: open,
  regular_close: close,
  windows,
});
const context: MarketContext = {
  ticker: "TEST",
  exchange: "XIST",
  instrument_type: "EQUITY",
  exchange_timezone: "Europe/Istanbul",
  server_time: 0,
  calendar_coverage: { from: 0, to: 30_000 },
  sessions: [session([window("regular", 1000, 10_000)])],
};
const coverage: DataCoverage = {
  sessions: ["regular"],
  overnight_history: false,
  delay_seconds: null,
};
type Input = Parameters<typeof planHistoryRefresh>[0];
const input = (overrides: Partial<Input> = {}): Input => ({
  now: 1100,
  interval: "5m",
  context,
  coverage,
  calendarRange: { from: 0, to: 30_000 },
  calendarAt: 20_000,
  lastUpdated: null,
  lastAttempt: 1000,
  notBefore: 0,
  handledThrough: 1000,
  settledThrough: 0,
  anchor: null,
  ...overrides,
});
const plan = (overrides: Partial<Input> = {}) =>
  planHistoryRefresh(input(overrides));
const history = (boundary: number, at = boundary + 5) => ({
  kind: "history",
  at,
  boundary,
});
const settlement = (boundary: number, at = boundary + 900) => ({
  kind: "history",
  at,
  boundary,
  settlement: true,
});
const calendar = (at = 20_000) => ({ kind: "calendar", at });

describe("history refresh policy", () => {
  it("matches the backend cache lifetimes and fixed grace/settlement offsets", () => {
    expect(HISTORY_GRACE_SECONDS).toBe(5);
    expect(HISTORY_SETTLEMENT_SECONDS).toBe(900);
    for (const interval of ["1m", "5m", "15m", "30m", "1h"] as Interval[])
      expect(historyCacheSeconds(interval)).toBe(60);
    for (const interval of ["1d", "1wk", "1mo"] as Interval[])
      expect(historyCacheSeconds(interval)).toBe(600);
  });

  it.each([
    ["5m", 300],
    ["15m", 900],
    ["1h", 3600],
  ] as const)("uses the window-start grid for %s", (interval, step) => {
    expect(plan({ interval })).toEqual(history(1000 + step));
  });

  it.each([
    ["5m", 300],
    ["15m", 900],
    ["1h", 3600],
  ] as const)(
    "uses the observed provider grid for %s in the same window",
    (interval, step) => {
      expect(plan({ interval, anchor: 1100, handledThrough: 1100 })).toEqual(
        history(1100 + step),
      );
    },
  );

  it.each([999, 10_000, 20_000])(
    "ignores an anchor outside the window (%s)",
    (anchor) => {
      expect(plan({ anchor })).toEqual(history(1300));
    },
  );

  it("extends the observed grid arithmetically back to the first pending boundary", () => {
    expect(plan({ anchor: 1700 })).toEqual(history(1100));
  });

  it("requires the grace period even at an exact physical boundary", () => {
    expect(plan({ now: 1300 })).toEqual(history(1300));
    expect(plan({ now: 1305 })).toEqual(history(1300));
    expect(plan({ now: 1305, handledThrough: 1300 })).toEqual(history(1600));
  });

  it("chooses the latest overdue boundary without enumerating candles", () => {
    expect(plan({ now: 2905 })).toEqual(history(2800));
  });

  it("keeps a pending physical boundary when the cache floor delays eligibility", () => {
    expect(plan({ now: 1305, lastUpdated: 1290 })).toEqual(history(1300, 1351));
    expect(plan({ now: 1351, lastUpdated: 1290 })).toEqual(history(1300, 1351));
  });

  it("uses the strict cache expiry plus one second for higher intervals", () => {
    expect(plan({ interval: "1d", now: 10_010, lastUpdated: 9999 })).toEqual(
      history(10_000, 10_600),
    );
  });

  it("does not consume a pending boundary when backoff extends into the next candle", () => {
    expect(plan({ now: 1305, notBefore: 1700 })).toEqual(history(1300, 1700));
    expect(plan({ now: 1700, notBefore: 1700 })).toEqual(history(1600, 1700));
  });

  it("advances past a failed attempted boundary without treating it as settled", () => {
    expect(
      plan({
        now: 1305,
        handledThrough: 1300,
        lastAttempt: 1305,
        notBefore: 1365,
      }),
    ).toEqual(history(1600));
    expect(
      plan({ now: 10_010, handledThrough: 10_000, lastAttempt: 10_010 }),
    ).toEqual(settlement(10_000));
  });

  it("includes an hourly clipped final candle instead of crossing the close", () => {
    expect(plan({ interval: "1h", now: 8300, handledThrough: 8200 })).toEqual(
      history(10_000),
    );
  });

  it("uses a supplied early close for the final partial candle and settlement", () => {
    const early = {
      ...context,
      sessions: [session([window("regular", 1000, 8500)], 1000, 8500)],
    };
    expect(
      plan({ context: early, interval: "1h", handledThrough: 8200, now: 8300 }),
    ).toEqual(history(8500));
    expect(
      plan({ context: early, interval: "1h", handledThrough: 8500, now: 8510 }),
    ).toEqual(settlement(8500));
  });

  it("closes even a window shorter than one candle", () => {
    const short = {
      ...context,
      sessions: [session([window("regular", 1000, 1120)], 1000, 1120)],
    };
    expect(plan({ context: short, interval: "1h" })).toEqual(history(1120));
  });

  it("does not bridge a session pause or reuse the morning anchor after it", () => {
    const paused = {
      ...context,
      sessions: [
        session(
          [window("regular", 1000, 1900), window("regular", 3000, 4100)],
          1000,
          4100,
        ),
      ],
    };
    expect(
      plan({ context: paused, now: 2000, handledThrough: 1900, anchor: 1600 }),
    ).toEqual(history(3300));
    expect(
      plan({ context: paused, now: 3800, handledThrough: 3600, anchor: 1600 }),
    ).toEqual(history(3900));
    expect(plan({ context: paused, now: 4200, handledThrough: 4100 })).toEqual(
      settlement(4100),
    );
  });

  it.each(["1d", "1wk", "1mo"] as const)(
    "refreshes %s only at regular close, even with extended coverage",
    (interval) => {
      const extended = {
        ...context,
        sessions: [
          session([
            window("pre", 100, 1000),
            window("regular", 1000, 10_000),
            window("post", 10_000, 12_000),
          ]),
        ],
      };
      expect(
        plan({
          context: extended,
          coverage: { ...coverage, sessions: ["pre", "regular", "post"] },
          interval,
          now: 2000,
        }),
      ).toEqual(history(10_000));
      expect(
        plan({
          context: extended,
          interval,
          now: 10_010,
          handledThrough: 10_000,
        }),
      ).toEqual(settlement(10_000));
    },
  );

  it("does not settle individual candles or the first side of a pause", () => {
    expect(plan({ now: 2500, handledThrough: 2200 })).toEqual(history(2500));
    const paused = {
      ...context,
      sessions: [
        session(
          [window("regular", 1000, 1900), window("regular", 5000, 6000)],
          1000,
          6000,
        ),
      ],
    };
    expect(plan({ context: paused, now: 3000, handledThrough: 1900 })).toEqual(
      history(5300),
    );
  });

  it("keeps the close and later settlement separate before settlement is due", () => {
    expect(plan({ now: 10_010, handledThrough: 9700 })).toEqual(
      history(10_000),
    );
    expect(plan({ now: 10_010, handledThrough: 10_000 })).toEqual(
      settlement(10_000),
    );
  });

  it("coalesces overdue close and settlement at the same physical boundary", () => {
    expect(plan({ now: 11_000 })).toEqual(settlement(10_000));
  });

  it("coalesces a close and settlement delayed to the same cache floor", () => {
    expect(
      plan({ now: 10_010, handledThrough: 9700, lastUpdated: 10_880 }),
    ).toEqual(settlement(10_000, 10_941));
  });

  it("bounds settlement to one final event and honors its separate watermark", () => {
    expect(
      plan({ now: 11_000, handledThrough: 10_000, settledThrough: 10_000 }),
    ).toEqual(calendar());
    expect(
      plan({ now: 11_000, handledThrough: 10_000, settledThrough: 9999 }),
    ).toEqual(settlement(10_000));
    expect(
      plan({ now: 10_010, handledThrough: 9700, settledThrough: 10_000 }),
    ).toEqual(history(10_000));
  });

  it("schedules the next session's first candle after all closing work is serviced", () => {
    const next = {
      ...context,
      sessions: [
        ...context.sessions,
        session([window("regular", 15_000, 18_000)], 15_000, 18_000),
      ],
    };
    expect(
      plan({
        context: next,
        now: 12_000,
        handledThrough: 10_000,
        settledThrough: 10_000,
      }),
    ).toEqual(history(15_300));
  });

  it("prefers a newer due candle over an older session's due settlement", () => {
    const next = {
      ...context,
      sessions: [
        ...context.sessions,
        session([window("regular", 11_000, 14_000)], 11_000, 14_000),
      ],
    };
    expect(plan({ context: next, now: 11_610 })).toEqual(history(11_600));
  });

  it.each(["XNAS", "XNYS"])(
    "keeps %s equities regular-only despite extended capabilities",
    (exchange) => {
      const us = {
        ...context,
        exchange,
        sessions: [
          session([
            window("pre", 100, 1000),
            window("regular", 1000, 10_000),
            window("post", 10_000, 12_000),
          ]),
        ],
      };
      expect(
        plan({
          context: us,
          coverage: { ...coverage, sessions: ["pre", "regular", "post"] },
          now: 200,
        }),
      ).toEqual(history(1300));
      expect(
        plan({
          context: us,
          coverage: { ...coverage, sessions: ["pre", "regular", "post"] },
          now: 10_010,
          handledThrough: 10_000,
        }),
      ).toEqual(settlement(10_000));
    },
  );

  it("keeps US ETFs regular-only but preserves other instruments' extended requests", () => {
    const us = {
      ...context,
      exchange: "XNAS",
      sessions: [
        session([window("pre", 100, 1000), ...context.sessions[0].windows]),
      ],
    };
    const caps = { ...coverage, sessions: ["pre", "regular"] };
    expect(
      plan({
        context: { ...us, instrument_type: "ETF" },
        coverage: caps,
        now: 200,
        handledThrough: 100,
      }),
    ).toEqual(history(1300));
    expect(
      plan({
        context: { ...us, instrument_type: "INDEX" },
        coverage: caps,
        now: 200,
        handledThrough: 100,
      }),
    ).toEqual(history(400));
  });

  it("defaults missing capabilities to regular windows without inventing extended history", () => {
    const extended = {
      ...context,
      sessions: [
        session([
          window("pre", 100, 1000),
          ...context.sessions[0].windows,
          window("post", 10_000, 12_000),
        ]),
      ],
    };
    expect(plan({ context: extended, coverage: null, now: 200 })).toEqual(
      history(1300),
    );
    expect(
      plan({ context: extended, coverage: { ...coverage, sessions: [] } }),
    ).toEqual(calendar());
    expect(
      plan({ context, coverage: { ...coverage, sessions: ["pre", "post"] } }),
    ).toEqual(calendar());
  });

  it("settles at the last advertised window rather than regular close for extended history", () => {
    const extended = {
      ...context,
      sessions: [
        session([
          ...context.sessions[0].windows,
          window("post", 10_000, 12_000),
        ]),
      ],
    };
    expect(
      plan({
        context: extended,
        coverage: { ...coverage, sessions: ["regular", "post"] },
        now: 10_010,
        handledThrough: 10_000,
      }),
    ).toEqual(history(10_300));
    expect(
      plan({
        context: extended,
        coverage: { ...coverage, sessions: ["regular", "post"] },
        now: 12_010,
        handledThrough: 12_000,
      }),
    ).toEqual(settlement(12_000));
  });

  it.each<{ sessions: string[]; overnight_history: boolean | null }>([
    { sessions: ["regular", "overnight"], overnight_history: false },
    { sessions: ["regular", "overnight"], overnight_history: null },
    { sessions: ["regular"], overnight_history: true },
  ])(
    "requires both overnight capabilities ($sessions, $overnight_history)",
    (caps) => {
      const overnight = {
        ...context,
        sessions: [
          session([
            ...context.sessions[0].windows,
            window("overnight", 12_000, 15_000),
          ]),
        ],
      };
      expect(
        plan({
          context: overnight,
          coverage: { ...coverage, ...caps },
          now: 12_100,
          handledThrough: 10_000,
          settledThrough: 10_000,
        }),
      ).toEqual(calendar());
    },
  );

  it("allows supplied overnight windows only when both capabilities advertise them", () => {
    const overnight = {
      ...context,
      sessions: [
        session([
          ...context.sessions[0].windows,
          window("overnight", 12_000, 15_000),
        ]),
      ],
    };
    const caps = {
      ...coverage,
      sessions: ["regular", "overnight"],
      overnight_history: true,
    };
    expect(
      plan({
        context: overnight,
        coverage: caps,
        now: 12_100,
        handledThrough: 10_000,
        settledThrough: 10_000,
      }),
    ).toEqual(history(12_300));
    expect(
      plan({
        context: overnight,
        coverage: caps,
        now: 15_010,
        handledThrough: 15_000,
      }),
    ).toEqual(settlement(15_000));
    expect(
      plan({
        context,
        coverage: caps,
        now: 12_100,
        handledThrough: 10_000,
        settledThrough: 10_000,
      }),
    ).toEqual(calendar());
  });

  it("selects the earliest future event even if sessions and windows are unsorted", () => {
    const unsorted = {
      ...context,
      sessions: [
        session([window("regular", 15_000, 18_000)], 15_000, 18_000),
        session([
          window("post", 10_000, 12_000),
          window("regular", 1000, 10_000),
        ]),
      ],
    };
    expect(
      plan({
        context: unsorted,
        coverage: { ...coverage, sessions: ["regular", "post"] },
      }),
    ).toEqual(history(1300));
    expect(
      plan({
        context: unsorted,
        coverage: { ...coverage, sessions: ["regular", "post"] },
        now: 12_100,
        handledThrough: 12_000,
      }),
    ).toEqual(settlement(12_000));
  });

  it("calculates the latest boundary across a large window without candle arrays", () => {
    const long = {
      ...context,
      calendar_coverage: { from: 0, to: 1_000_000_000 },
      sessions: [
        session([window("regular", 1000, 900_000_000)], 1000, 900_000_000),
      ],
    };
    expect(
      plan({
        context: long,
        interval: "1m",
        now: 500_000_000,
        calendarRange: long.calendar_coverage,
        calendarAt: 800_000_000,
      }),
    ).toEqual(history(499_999_960));
  });

  it("uses bounded fallback for missing context, reviewed coverage or fetched range", () => {
    for (const overrides of [
      { context: null },
      { context: { ...context, calendar_coverage: null } },
      { calendarRange: null },
      {
        context: { ...context, calendar_coverage: { from: 1200, to: 30_000 } },
      },
      { calendarRange: { from: 1200, to: 30_000 } },
      { calendarRange: { from: 0, to: 1100 } },
      { context: { ...context, calendar_coverage: { from: 0, to: 1100 } } },
    ])
      expect(plan(overrides)).toEqual({ kind: "history", at: 1300 });
  });

  it.each([
    ["1m", 60],
    ["5m", 300],
    ["15m", 900],
    ["1h", 3600],
    ["1d", 900],
    ["1wk", 900],
    ["1mo", 900],
  ] as const)(
    "bases %s fallback cadence on the actual last attempt",
    (interval, step) => {
      expect(plan({ context: null, interval, lastAttempt: 1100 })).toEqual({
        kind: "history",
        at: 1100 + step,
      });
    },
  );

  it("applies both cache and backoff floors to fallback without attaching a fabricated boundary", () => {
    expect(plan({ context: null, lastUpdated: 1500, notBefore: 1600 })).toEqual(
      { kind: "history", at: 1600 },
    );
    expect(plan({ context: null, lastUpdated: 1500 })).toEqual({
      kind: "history",
      at: 1561,
    });
  });

  it("does not mistake an exhausted fetched calendar for reviewed closed time", () => {
    const ts = (date: string) => Date.parse(date) / 1000;
    const now = ts("2026-10-08T12:00:00Z");
    const reviewed = {
      ...context,
      calendar_coverage: { from: ts("2000-01-01"), to: ts("2027-01-01") },
      sessions: [],
    };
    expect(
      plan({
        context: reviewed,
        now,
        lastAttempt: now - 60,
        calendarAt: now + 3600,
        calendarRange: { from: now - 86400, to: now },
      }),
    ).toEqual({ kind: "history", at: now + 240 });
  });

  it("does not poll history in a trusted holiday or invent events outside either calendar horizon", () => {
    expect(plan({ context: { ...context, sessions: [] } })).toEqual(calendar());
    expect(plan({ calendarRange: { from: 0, to: 1200 } })).toEqual(
      calendar(1200),
    );
    expect(
      plan({
        context: { ...context, calendar_coverage: { from: 0, to: 1200 } },
      }),
    ).toEqual(calendar(1200));
  });

  it("keeps in-horizon candle boundaries when a window extends past coverage", () => {
    expect(plan({ calendarRange: { from: 0, to: 1400 } })).toEqual(
      history(1300),
    );
    expect(
      plan({
        context: { ...context, calendar_coverage: { from: 0, to: 1400 } },
      }),
    ).toEqual(history(1300));
    expect(
      plan({
        calendarRange: { from: 0, to: 1400 },
        now: 1305,
        handledThrough: 1300,
      }),
    ).toEqual(calendar(1400));
    expect(plan({ calendarRange: { from: 1050, to: 30_000 } })).toEqual(
      history(1300),
    );
  });

  it("lets calendar maintenance preempt history and clamps only overdue maintenance", () => {
    expect(plan({ calendarAt: 1200 })).toEqual(calendar(1200));
    expect(plan({ calendarAt: 900, now: 1100.9 })).toEqual(calendar(1100));
    expect(plan({ calendarAt: 1305 })).toEqual(calendar(1305));
    expect(plan({ context: null, calendarAt: 1200 })).toEqual(calendar(1200));
    expect(plan({ now: 2905, calendarAt: 1200 })).toEqual(calendar(2905));
    expect(plan({ now: 2905, context: null, calendarAt: 1200 })).toEqual(
      calendar(2905),
    );
  });

  it("uses supplied UTC session times on both sides of DST rather than a fixed offset", () => {
    const ts = (date: string) => Date.parse(date) / 1000;
    const before = ts("2026-10-30T13:30:00Z"),
      after = ts("2026-11-02T14:30:00Z");
    const dst = {
      ...context,
      exchange: "XNAS",
      exchange_timezone: "America/New_York",
      calendar_coverage: { from: before - 86400, to: after + 86400 },
      sessions: [before, after].map((open) =>
        session([window("regular", open, open + 23_400)], open, open + 23_400),
      ),
    };
    for (const open of [before, after]) {
      expect(
        plan({
          context: dst,
          interval: "1h",
          now: open + 60,
          anchor: before,
          handledThrough: open,
          settledThrough: open,
          calendarRange: dst.calendar_coverage,
          calendarAt: after + 86400,
        }),
      ).toEqual(history(open + 3600));
    }
  });

  it("is deterministic and leaves all supplied state untouched", () => {
    const state = input();
    const before = JSON.stringify(state);
    expect(planHistoryRefresh(state)).toEqual(planHistoryRefresh(state));
    expect(JSON.stringify(state)).toBe(before);
  });
});

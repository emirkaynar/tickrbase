import type {
  DataCoverage,
  Interval,
  MarketContext,
} from "../../services/types";
import { intervalSeconds } from "./barStore";
import { historySessions } from "./sessionPolicy";

export const HISTORY_GRACE_SECONDS = 5;
export const HISTORY_SETTLEMENT_SECONDS = 900;

export function historyCacheSeconds(interval: Interval): number {
  return intervalSeconds(interval) === null ? 600 : 60;
}

export type CalendarRange = { from: number; to: number };
export type HistoryRefreshAction =
  | { kind: "calendar"; at: number }
  | { kind: "history"; at: number; boundary?: number; settlement?: boolean };

type HistoryRefreshInput = {
  now: number;
  interval: Interval;
  context: MarketContext | null;
  coverage: DataCoverage | null;
  calendarRange: CalendarRange | null;
  calendarAt: number;
  lastUpdated: number | null;
  lastAttempt: number;
  notBefore: number;
  handledThrough: number;
  settledThrough: number;
  anchor: number | null;
};
type BoundaryAction = {
  kind: "history";
  at: number;
  boundary: number;
  settlement?: boolean;
};

function preferHistory(
  left: BoundaryAction,
  right: BoundaryAction,
  now: number,
): BoundaryAction {
  const leftDue = left.at <= now,
    rightDue = right.at <= now;
  if (leftDue !== rightDue) return leftDue ? left : right;
  if (leftDue && left.boundary !== right.boundary)
    return left.boundary > right.boundary ? left : right;
  if (!leftDue && left.at !== right.at)
    return left.at < right.at ? left : right;
  if (left.boundary === right.boundary) return right.settlement ? right : left;
  return left.boundary < right.boundary ? left : right;
}

/** Pure scheduling: acknowledgements and retry delays belong to the caller. */
export function planHistoryRefresh(
  input: HistoryRefreshInput,
): HistoryRefreshAction {
  const {
    now,
    interval,
    context,
    coverage,
    calendarRange,
    calendarAt,
    lastUpdated,
    lastAttempt,
    notBefore,
    handledThrough,
    settledThrough,
    anchor,
  } = input;
  const calendar: HistoryRefreshAction = {
    kind: "calendar",
    at: Math.max(calendarAt, Math.floor(now)),
  };
  const step = intervalSeconds(interval);
  const floor = Math.max(
    notBefore,
    lastUpdated === null
      ? -Infinity
      : lastUpdated + historyCacheSeconds(interval) + 1,
  );
  const reviewed = context?.calendar_coverage;
  if (
    !context ||
    !reviewed ||
    !calendarRange ||
    now < reviewed.from ||
    now >= reviewed.to ||
    now < calendarRange.from ||
    now >= calendarRange.to
  ) {
    const at = Math.max(lastAttempt + Math.max(step ?? 900, 60), floor);
    return calendarAt <= at ? calendar : { kind: "history", at };
  }

  const from = Math.max(reviewed.from, calendarRange.from),
    to = Math.min(reviewed.to, calendarRange.to);
  const maintenanceAt = Math.min(calendarAt, to);
  const maintenance: HistoryRefreshAction = {
    kind: "calendar",
    at: Math.max(maintenanceAt, Math.floor(now)),
  };
  const supported = coverage?.sessions ?? ["regular"];
  const extended = historySessions(context, step !== null) === "extended";
  const candidates: BoundaryAction[] = [];
  const add = (boundary: number, settlement = false) => {
    candidates.push({
      kind: "history",
      boundary,
      at: Math.max(
        boundary +
          (settlement ? HISTORY_SETTLEMENT_SECONDS : HISTORY_GRACE_SECONDS),
        floor,
      ),
      ...(settlement ? { settlement: true } : {}),
    });
  };

  for (const session of context.sessions) {
    if (step === null) {
      if (
        !supported.includes("regular") ||
        session.regular_close <= from ||
        session.regular_close > to ||
        session.regular_close <= session.regular_open
      )
        continue;
      if (session.regular_close > handledThrough) add(session.regular_close);
      if (session.regular_close > settledThrough)
        add(session.regular_close, true);
      continue;
    }

    const windows = session.windows.filter(
      (window) =>
        window.end > window.start &&
        supported.includes(window.kind) &&
        (window.kind === "regular" || extended) &&
        (window.kind !== "overnight" || coverage?.overnight_history === true),
    );
    let finalEnd = -Infinity;
    for (const window of windows) {
      finalEnd = Math.max(finalEnd, window.end);
      if (window.end <= Math.max(from, handledThrough) || window.start >= to)
        continue;
      const origin =
        anchor !== null && anchor >= window.start && anchor < window.end
          ? anchor
          : window.start;
      // Preserve the next pending boundary when cache/backoff gates are still in the future.
      let boundary = Math.min(
        window.end,
        origin +
          (Math.floor(
            (Math.max(window.start, from, handledThrough) - origin) / step,
          ) +
            1) *
            step,
      );
      if (floor <= now) {
        const cutoff = Math.min(now - HISTORY_GRACE_SECONDS, to);
        const latest =
          window.end <= cutoff
            ? window.end
            : origin + Math.floor((cutoff - origin) / step) * step;
        if (latest > Math.max(from, handledThrough) && latest > window.start)
          boundary = latest;
      }
      // The horizon is not a session close; never invent a partial candle there.
      if (boundary <= to) add(boundary);
    }
    // A session settles only at its final eligible end, never at a candle or pause boundary.
    if (
      finalEnd > settledThrough &&
      finalEnd > from &&
      finalEnd <= to &&
      windows.some((window) => window.end === finalEnd && window.start < to)
    )
      add(finalEnd, true);
  }

  const history = candidates.reduce<BoundaryAction | null>(
    (best, action) =>
      best === null ? action : preferHistory(best, action, now),
    null,
  );
  return history === null || maintenanceAt <= history.at
    ? maintenance
    : history;
}

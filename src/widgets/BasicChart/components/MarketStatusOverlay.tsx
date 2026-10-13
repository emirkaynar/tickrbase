import type { ComponentChildren } from "preact";
import { Clock3, TriangleAlert } from "lucide-react";
import { Tooltip } from "../../../ui";
import { MarketPillTooltip } from "./MarketPillTooltip";
import { formatCurrency, formatPercentChange } from "../../../utils";
import type { ChartQuote } from "../hooks/useChartQuote";
import { formatDelay } from "../marketStatus";
import type { MarketCountdown, MarketTooltip } from "../marketStatus";
import styles from "./ChartOverlay.module.css";

type Props = {
  tooltipIdPrefix?: string;
  symbol: string;
  name: string;
  exchange: string | null;
  quote: ChartQuote;
  tooltip: MarketTooltip;
  delayed: boolean;
  delaySeconds?: number | null;
  countdown?: MarketCountdown | null;
  notices: string[];
  compactRef?: { current: HTMLDivElement | null };
  strip?: boolean;
  barInfo?: ComponentChildren;
  changeInfo?: ComponentChildren;
  priceDecimals?: number;
  change?: {
    percent: number | null;
    qualifier: string | null;
    tooltip: string;
  };
};

export function MarketStatusOverlay({
  tooltipIdPrefix,
  symbol,
  name,
  exchange,
  quote,
  tooltip,
  delayed,
  delaySeconds = null,
  countdown = null,
  notices,
  strip = false,
  barInfo,
  changeInfo,
  priceDecimals,
  change,
  compactRef,
}: Props) {
  if (!quote.ready && !strip) return null;
  const changePercent = change ? change.percent : quote.changePercent;
  const changeClass =
    changePercent === null || changePercent === 0
      ? styles.changeNeutral
      : changePercent > 0
        ? styles.changePositive
        : styles.changeNegative;
  const warningLabel = notices.length
    ? `Data warnings: ${notices.join("; ")}`
    : "";
  const pillLabel = [
    tooltip.session ? tooltip.title : "",
    countdown?.label,
    warningLabel,
  ]
    .filter(Boolean)
    .join("; ");

  const sessionNames = {
    regular: "Market open",
    pre: "Pre-market",
    post: "Post-market",
    overnight: "Overnight session",
    closed: "Market closed",
  };
  const upcomingSession =
    countdown &&
    countdown.nextSession !== "closed" &&
    countdown.nextSession !== "regular" &&
    countdown.nextSession !== tooltip.session
      ? countdown.nextSession
      : null;
  const sessionTiming = !countdown
    ? tooltip.timing
    : tooltip.session === "closed"
      ? upcomingSession
        ? null
        : `Opens in ${countdown.duration}`
      : tooltip.session === "pre" && countdown.nextSession === "regular"
        ? `Market opens in ${countdown.duration}`
        : `${tooltip.session === "regular" ? "Closes" : "Ends"} in ${countdown.duration}`;
  const warningTitle = (notice: string) =>
    ["Connection error", "Reconnecting", "Disconnected"].includes(notice)
      ? "Connection issue"
      : notice === "Connecting"
        ? "Connection"
        : /^history/i.test(notice)
          ? "History unavailable"
          : "Data warning";
  const pillTooltip = (
    <div class={styles.sessionTooltip}>
      {tooltip.session && (
        <div
          class={`${styles.tooltipRow} ${styles.tooltipSessionRow}`}
          data-session={tooltip.session}
        >
          <span class={styles.tooltipMarker} aria-hidden="true">
            <span class={styles.sessionDot} />
          </span>
          <div class={styles.tooltipRowText}>
            <strong>{sessionNames[tooltip.session]}</strong>
            {sessionTiming && (
              <span class={styles.tooltipSubtitle}>{sessionTiming}</span>
            )}
          </div>
        </div>
      )}
      {tooltip.session &&
        tooltip.session !== "closed" &&
        (delayed || delaySeconds === null) && (
          <div
            class={`${styles.tooltipRow} ${styles.tooltipDelayRow}`}
            data-unknown={delaySeconds === null}
          >
            <span class={styles.tooltipMarker} aria-hidden="true">
              {delayed ? <span class={styles.tooltipDelayGlyph}>D</span> : "?"}
            </span>
            <div class={styles.tooltipRowText}>
              <strong>
                {delayed && delaySeconds !== null
                  ? formatDelay(delaySeconds)
                  : "Delay unknown"}
              </strong>
            </div>
          </div>
        )}
      {tooltip.session && countdown && upcomingSession && (
        <div
          class={`${styles.tooltipRow} ${styles.tooltipCountdownRow}`}
          data-next-session={upcomingSession}
        >
          <span class={styles.tooltipMarker} aria-hidden="true">
            <Clock3 size={12} />
          </span>
          <div class={styles.tooltipRowText}>
            <strong>{sessionNames[upcomingSession]}</strong>
            <span
              class={styles.tooltipSubtitle}
            >{`Starts in ${countdown.duration}`}</span>
          </div>
        </div>
      )}
      {notices.map((notice) => (
        <div
          key={notice}
          class={`${styles.tooltipRow} ${styles.tooltipWarningRow}`}
        >
          <span class={styles.tooltipMarker} aria-hidden="true">
            <TriangleAlert size={12} />
          </span>
          <div class={styles.tooltipRowText}>
            <strong>{warningTitle(notice)}</strong>
            {notice !== warningTitle(notice) && (
              <span class={styles.tooltipSubtitle}>{notice}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  const statusPill = (tooltip.session || notices.length > 0) && (
    <MarketPillTooltip
      id={tooltipIdPrefix ? `${tooltipIdPrefix}-session` : undefined}
      placement={strip ? "bottom-end" : undefined}
      content={pillTooltip}
    >
      <button
        type="button"
        class={styles.statusPill}
        data-session={tooltip.session ?? undefined}
        data-dot-only={Boolean(
          tooltip.session && !countdown && !delayed && notices.length === 0,
        )}
        data-segmented={Boolean(countdown || delayed || notices.length > 0)}
        data-delayed={Boolean(tooltip.session && delayed)}
        aria-label={pillLabel}

        onPointerDown={(event) => event.stopPropagation()}
      >
        {tooltip.session && (
          <span class={styles.sessionSegment} aria-hidden="true">
            <span class={styles.sessionDot} />
          </span>
        )}
        {tooltip.session && delayed && (
          <span class={styles.delayMarker} aria-hidden="true">
            D
          </span>
        )}
        {tooltip.session && countdown && (
          <span
            class={styles.countdownSegment}
            data-next-session={countdown.nextSession}
            aria-hidden="true"
          >
            {countdown.text}
          </span>
        )}
        {notices.length > 0 && (
          <span class={styles.warningSegment} aria-hidden="true">
            <TriangleAlert class={styles.pillWarning} size={12} />
          </span>
        )}
      </button>
    </MarketPillTooltip>
  );
  const identity = (
    <div class={styles.identityRow}>
      <Tooltip
        id={tooltipIdPrefix ? `${tooltipIdPrefix}-instrument` : undefined}
        content={name}
      >
        <span class={styles.instrumentName} tabIndex={0}>
          {name}
        </span>
      </Tooltip>
      {exchange && <span class={styles.exchange}>· {exchange}</span>}
      {!strip && statusPill}
    </div>
  );
  const changeValue = (
    <span
      class={`${changeClass} ${strip ? styles.changeSlot : ""}`}
      tabIndex={strip ? 0 : undefined}
    >
      {changePercent !== null ? formatPercentChange(changePercent) : "—"}
      {strip && change?.qualifier && (
        <span class={styles.changeQualifier}>{change.qualifier}</span>
      )}
    </span>
  );
  const price = (
    <div class={styles.priceRow}>
      {quote.price !== null && Number.isFinite(quote.price) ? (
        <span class={styles.priceValue}>
          {formatCurrency(quote.price, symbol, {
            currency: quote.currency,
            compact: false,
            decimals: priceDecimals,
          })}
        </span>
      ) : (
        <span class={styles.unavailablePrice} title="Quote unavailable">
          {strip ? "—" : "Quote unavailable"}
        </span>
      )}
      {changeInfo ??
        (strip && change ? (
          <Tooltip
            id={tooltipIdPrefix ? `${tooltipIdPrefix}-change` : undefined}
            content={change.tooltip}
          >
            {changeValue}
          </Tooltip>
        ) : (
          changePercent !== null && changeValue
        ))}
    </div>
  );
  return strip ? (
    <div
      class={styles.legendStrip}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div class={styles.stripMain}>
        <div class={styles.stripHeadline}>
          {identity}
          {price}
        </div>
        {barInfo}
      </div>
      <div class={styles.stripStatus}>{statusPill}</div>
    </div>
  ) : (
    <div class={styles.marketOverlay} key={symbol} ref={compactRef}>
      {identity}
      {price}
    </div>
  );
}

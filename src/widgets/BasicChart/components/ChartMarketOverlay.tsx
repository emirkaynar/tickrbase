import { useEffect, useState } from "preact/hooks";
import { livePricesClient } from "../../../services/livePrices";
import type { useChartData } from "../hooks/useChartData";
import type { ChartQuote } from "../hooks/useChartQuote";
import type { InstrumentIdentity } from "../hooks/useInstrumentIdentity";
import { marketCountdown, marketStatus, marketTooltip } from "../marketStatus";
import { MarketStatusOverlay } from "./MarketStatusOverlay";

type Props = {
    symbol: string;
    identity: InstrumentIdentity;
    data: ReturnType<typeof useChartData>;
    quote: ChartQuote;
    warning: string;
};

export function ChartMarketOverlay({ symbol, identity, data, quote, warning }: Props) {
    const [now, setNow] = useState(() => livePricesClient.now());
    const [connection, setConnection] = useState(livePricesClient.getStatus());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(livePricesClient.now()), 1000);
        const unsubscribe = livePricesClient.onStatus(setConnection);
        return () => { window.clearInterval(timer); unsubscribe(); };
    }, []);
    const ownData = data.dataSymbol === symbol;
    const context = ownData ? data.marketContext : null;
    const tick = data.lastTick?.symbol === symbol ? data.lastTick : null;
    const coverage = ownData ? data.coverage : null;
    const status = marketStatus(context, tick, coverage, now);
    const notices = [
        connection !== "open" ? connection === "error" ? "Connection error" : connection === "reconnecting" ? "Reconnecting"
            : connection === "connecting" ? "Connecting" : "Disconnected" : null,
        ownData ? warning || null : null,
    ].filter((notice): notice is string => Boolean(notice));

    return <MarketStatusOverlay
        key={symbol} symbol={symbol} name={identity.name} exchange={identity.exchange ?? context?.exchange ?? null} quote={quote}
        tooltip={marketTooltip(context, tick, coverage, now)} delayed={status.delayed} delaySeconds={status.delaySeconds}
        countdown={marketCountdown(context, status, now)} notices={notices}
    />;
}

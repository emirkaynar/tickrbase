import { Skeleton, Tabs, TickerSelector } from "../../ui";
import type { TabItem } from "../../ui";
import { Shell } from "../Shell";
import { registerWidget } from "../registry";
import { useOverviewState } from "./useOverviewState";
import { SummaryTab } from "./tabs/SummaryTab";
import { FinancialsTab } from "./tabs/FinancialsTab";
import { TechnicalTab } from "./tabs/TechnicalTab";
import { formatCurrency, formatPercentChange } from "../../utils";
import styles from "./SymbolOverview.module.css";

type Props = { id: string; onRemove: () => void };

const TABS: TabItem[] = [
    { value: "summary", label: "Summary" },
    { value: "financials", label: "Financials" },
    { value: "technical", label: "Technical" },
];

function SymbolOverviewWidget({ id, onRemove }: Props) {
    const {
        symbol,
        setSymbol,
        activeTab,
        selectTab,
        activeInterval,
        selectInterval,
        quote,
        overview,
        bars,
        dailyBars,
        loading,
        stateReady,
        isIntraday,
    } = useOverviewState(id);

    const price = quote?.current_price;
    const changePct = quote?.change_percent;
    const isPos = changePct != null && changePct > 0;
    const isNeg = changePct != null && changePct < 0;

    const tickerTrigger = (
        <button type="button" className={styles.tickerTrigger}>
            <span className={styles.triggerSymbol}>{symbol}</span>
            {price != null && (
                <span className={styles.priceValue}>
                    {formatCurrency(price, symbol, {
                        currency: quote?.currency,
                        compact: false,
                    })}
                </span>
            )}
            {changePct != null && (
                <span
                    className={
                        isPos
                            ? styles.changePositive
                            : isNeg
                              ? styles.changeNegative
                              : styles.changeNeutral
                    }
                >
                    {formatPercentChange(changePct)}
                </span>
            )}
        </button>
    );

    return (
        <Shell
            id={id}
            onRemove={onRemove}
            headerLeft={
                <TickerSelector
                    value={symbol}
                    placeholder="Ticker..."
                    onChange={setSymbol}
                    trigger={tickerTrigger}
                />
            }
        >
            <div className={styles.root}>
                {loading || !stateReady ? (
                    <Skeleton variant="rect" width="100%" height="100%" />
                ) : (
                    <>
                        {/* Tabs bar */}
                        <div className={styles.tabsContainer}>
                            <Tabs
                                items={TABS}
                                value={activeTab}
                                className={styles.tabs}
                                onChange={selectTab}
                            />
                        </div>

                        {/* Tab content area */}
                        <div className={styles.bodyContainer}>
                            {activeTab === "summary" && (
                                <SummaryTab
                                    quote={quote}
                                    overview={overview}
                                    bars={bars}
                                    dailyBars={dailyBars}
                                    activeInterval={activeInterval}
                                    selectInterval={selectInterval}
                                    isIntraday={isIntraday}
                                />
                            )}

                            {activeTab === "financials" && (
                                <FinancialsTab overview={overview} />
                            )}

                            {activeTab === "technical" && (
                                <TechnicalTab
                                    quote={quote}
                                    overview={overview}
                                />
                            )}
                        </div>
                    </>
                )}
            </div>
        </Shell>
    );
}

// Self-register with widget system
registerWidget({
    type: "symbol-overview",
    label: "Symbol Overview",
    defaultSize: { w: 4, h: 8 },
    minSize: { w: 4, h: 5 },
    component: SymbolOverviewWidget,
});

export default SymbolOverviewWidget;

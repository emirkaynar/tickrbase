import { useMemo } from "preact/hooks";
import type { PositionResponse } from "../../../../services/types";
import { Skeleton } from "../../../../ui";
import { formatCurrency, formatPercent } from "../../../../utils";
import styles from "./overview.module.css";

interface Props {
    positions: PositionResponse[];
    loading: boolean;
    baseCurrency: string;
}

export function PortfolioAnalysis({ positions, loading, baseCurrency }: Props) {
    const { topGainers, topLosers } = useMemo(() => {
        if (!positions.length) return { topGainers: [], topLosers: [] };
        const sorted = [...positions].sort((a, b) => b.pnl_percent - a.pnl_percent);
        const gainers = sorted.filter((p) => p.pnl_percent > 0).slice(0, 3);
        const losers = sorted.filter((p) => p.pnl_percent < 0).reverse().slice(0, 3);
        return { topGainers: gainers, topLosers: losers };
    }, [positions]);

    return (
        <div className={styles.card}>
            <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>Portfolio Analysis</h3>
            </div>

            {loading ? (
                <div className={styles.analysisBody}>
                    <Skeleton height={40} width="100%" />
                    <Skeleton height={40} width="100%" />
                    <Skeleton height={40} width="100%" />
                </div>
            ) : !positions.length ? (
                <div className={styles.xrayPlaceholder}>
                    No active positions to analyze yet.
                </div>
            ) : (
                <div className={styles.analysisBody}>
                    {topGainers.length > 0 && (
                        <div>
                            <div className={styles.sectionHeader}>Top Gainers</div>
                            <div className={styles.performersList}>
                                {topGainers.map((pos) => (
                                    <div key={pos.id} className={styles.performerItem}>
                                        <span className={styles.performerSymbol}>{pos.ticker}</span>
                                        <div className={styles.performerValues}>
                                            <span>
                                                {formatCurrency(pos.market_value, baseCurrency, {
                                                    compact: true,
                                                })}
                                            </span>
                                            <span className={styles.positiveText}>
                                                {formatPercent(pos.pnl_percent)}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {topLosers.length > 0 && (
                        <div>
                            <div className={styles.sectionHeader}>Top Losers</div>
                            <div className={styles.performersList}>
                                {topLosers.map((pos) => (
                                    <div key={pos.id} className={styles.performerItem}>
                                        <span className={styles.performerSymbol}>{pos.ticker}</span>
                                        <div className={styles.performerValues}>
                                            <span>
                                                {formatCurrency(pos.market_value, baseCurrency, {
                                                    compact: true,
                                                })}
                                            </span>
                                            <span className={styles.negativeText}>
                                                {formatPercent(pos.pnl_percent)}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className={styles.xrayPlaceholder}>
                        ⚡ Portfolio X-Ray & Risk Factor Insights coming soon
                    </div>
                </div>
            )}
        </div>
    );
}

import { useMemo, useState } from "preact/hooks";
import type { PortfolioHistoryPoint } from "../../../../services/types";
import { Skeleton, ValueChart } from "../../../../ui";
import {
    decimatePoints,
    getEffectiveInterval,
    type ChartInterval,
} from "../../../../utils/chartHelpers";
import styles from "./overview.module.css";

interface Props {
    points: PortfolioHistoryPoint[];
    loading: boolean;
    baseCurrency: string;
}

export function ValueChartCard({ points, loading, baseCurrency }: Props) {
    const [requestedInterval, setRequestedInterval] = useState<ChartInterval>("1d");

    const effectiveInterval = useMemo(
        () => getEffectiveInterval(points, requestedInterval),
        [points, requestedInterval],
    );

    const displayPoints = useMemo(
        () => decimatePoints(points, effectiveInterval),
        [points, effectiveInterval],
    );

    return (
        <div className={styles.card}>
            <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>Portfolio Value</h3>
                <div className={styles.controlsGroup}>
                    <div className={styles.btnGroup}>
                        {(
                            [
                                { key: "1d", label: "Day" },
                                { key: "1wk", label: "Week" },
                                { key: "1mo", label: "Month" },
                                { key: "1y", label: "Year" },
                            ] as const
                        ).map((item) => (
                            <button
                                key={item.key}
                                type="button"
                                className={[
                                    styles.controlBtn,
                                    effectiveInterval === item.key ? styles.controlBtnActive : "",
                                ].join(" ")}
                                onClick={() => setRequestedInterval(item.key)}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className={styles.chartHeight}>
                {loading ? (
                    <Skeleton height="100%" width="100%" />
                ) : displayPoints.length === 0 ? (
                    <div className={styles.xrayPlaceholder}>
                        Building your portfolio value history…
                    </div>
                ) : (
                    <ValueChart
                        points={displayPoints}
                        baseCurrency={baseCurrency}
                        interval={effectiveInterval}
                    />
                )}
            </div>
        </div>
    );
}

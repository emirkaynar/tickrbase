import type { PortfolioHistoryPoint, PositionResponse } from "../../../../services/types";
import { PortfolioAnalysis } from "./PortfolioAnalysis";
import { ValueChartCard } from "./ValueChartCard";
import styles from "./overview.module.css";

interface Props {
    points: PortfolioHistoryPoint[];
    positions: PositionResponse[];
    histLoading: boolean;
    posLoading: boolean;
    baseCurrency: string;
}

export function Row1({ points, positions, histLoading, posLoading, baseCurrency }: Props) {
    return (
        <div className={styles.row1}>
            <ValueChartCard
                points={points}
                loading={histLoading}
                baseCurrency={baseCurrency}
            />
            <PortfolioAnalysis
                positions={positions}
                loading={posLoading}
                baseCurrency={baseCurrency}
            />
        </div>
    );
}

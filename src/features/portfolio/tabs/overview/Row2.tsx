import type { PositionResponse } from "../../../../services/types";
import { AllocationDonut } from "./AllocationDonut";
import { HoldingsTreemap } from "./HoldingsTreemap";
import styles from "./overview.module.css";

interface Props {
    positions: PositionResponse[];
    loading: boolean;
    baseCurrency: string;
}

export function Row2({ positions, loading, baseCurrency }: Props) {
    return (
        <div className={styles.row2}>
            <AllocationDonut
                positions={positions}
                loading={loading}
                baseCurrency={baseCurrency}
            />
            <HoldingsTreemap
                positions={positions}
                loading={loading}
                baseCurrency={baseCurrency}
            />
        </div>
    );
}

import { Layers2 } from "lucide-react";
import type { ReturnBreakdownData } from "../../../utils/pnlBreakdown";
import { formatSignedPercent } from "../../../utils/pnlBreakdown";
import { formatCurrency } from "../../../utils";
import { Tooltip } from "../../Tooltip/Tooltip";
import styles from "./ReturnBreakdownBadge.module.css";

export interface ReturnBreakdownBadgeProps {
    data: ReturnBreakdownData;
    mode: "abs" | "pct" | "historic";
}

export function ReturnBreakdownBadge({
    data,
    mode,
}: ReturnBreakdownBadgeProps) {
    const isPos = data.totalReturnBase >= 0;
    const valueClass = isPos ? styles.positive : styles.negative;

    // Formatting for ABS / Historic mode
    const stockNativeFormatted = formatCurrency(
        data.stockReturnNative,
        data.nativeCurrency,
        {
            currency: data.nativeCurrency,
        },
    );
    const stockNativeText =
        data.stockReturnNative > 0
            ? `+${stockNativeFormatted}`
            : stockNativeFormatted;

    const stockBaseFormatted = formatCurrency(
        data.stockReturnBase,
        data.baseCurrency,
        {
            currency: data.baseCurrency,
        },
    );
    const stockBaseText =
        data.stockReturnBase > 0
            ? `+${stockBaseFormatted}`
            : stockBaseFormatted;

    const fxBaseFormatted = formatCurrency(
        data.fxReturnBase,
        data.baseCurrency,
        {
            currency: data.baseCurrency,
        },
    );
    const fxBaseText =
        data.fxReturnBase > 0 ? `+${fxBaseFormatted}` : fxBaseFormatted;

    const totalNativeFormatted = formatCurrency(
        data.totalReturnNative,
        data.nativeCurrency,
        {
            currency: data.nativeCurrency,
        },
    );
    const totalNativeText =
        data.totalReturnNative > 0
            ? `+${totalNativeFormatted}`
            : totalNativeFormatted;

    const totalBaseFormatted = formatCurrency(
        data.totalReturnBase,
        data.baseCurrency,
        {
            currency: data.baseCurrency,
        },
    );
    const totalBaseText =
        data.totalReturnBase > 0 ? `+${totalBaseFormatted}` : totalBaseFormatted;

    // Mode "abs": Monetary amounts popover content (Holdings)
    const absPopoverContent = (
        <div className={styles.popoverContainer}>
            <div className={styles.header}>
                <div className={styles.titleContainer}>
                    <Layers2 size={16} strokeWidth={2.5} />
                    <span className={styles.title}>
                        P/L Breakdown · {data.symbol}
                    </span>
                </div>
                {data.isCrossCurrency && (
                    <div className={styles.fxRateInfo}>
                        FX: {data.entryFxRate.toFixed(4)} →{" "}
                        {data.currentFxRate.toFixed(4)} ({data.nativeCurrency}/
                        {data.baseCurrency})
                    </div>
                )}
            </div>
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th>Type</th>
                        <th>{data.nativeCurrency}</th>
                        <th>{data.baseCurrency} (base)</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Stock Return</td>
                        <td>{stockNativeText}</td>
                        <td>{stockBaseText}</td>
                    </tr>
                    {data.isCrossCurrency && (
                        <tr>
                            <td>FX Return</td>
                            <td>—</td>
                            <td>{fxBaseText}</td>
                        </tr>
                    )}
                    <tr className={styles.totalRow}>
                        <td>Total</td>
                        <td>{totalNativeText}</td>
                        <td className={valueClass}>{totalBaseText}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    );

    // Mode "pct": Percentage return popover content (Holdings)
    const pctPopoverContent = (
        <div className={styles.popoverContainer}>
            <div className={styles.header}>
                <div className={styles.titleContainer}>
                    <Layers2 size={16} strokeWidth={2.5} />
                    <span className={styles.title}>P/L% Breakdown · {data.symbol}</span>
                </div>
                {data.isCrossCurrency && (
                    <div className={styles.fxRateInfo}>
                        FX: {data.entryFxRate.toFixed(4)} →{" "}
                        {data.currentFxRate.toFixed(4)} ({data.nativeCurrency}/
                        {data.baseCurrency})
                    </div>
                )}
            </div>
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th>Type</th>
                        <th>Return %</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Stock Return</td>
                        <td>{formatSignedPercent(data.stockReturnPct)}</td>
                    </tr>
                    {data.isCrossCurrency && (
                        <tr>
                            <td>FX Return</td>
                            <td>{formatSignedPercent(data.fxReturnPct)}</td>
                        </tr>
                    )}
                    <tr className={styles.totalRow}>
                        <td>Total (Compounded)</td>
                        <td className={valueClass}>
                            {formatSignedPercent(data.totalReturnPct)}
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    );

    // Mode "historic": Realized P/L popover content (Transactions)
    const historicPopoverContent = (
        <div className={styles.popoverContainer}>
            <div className={styles.header}>
                <div className={styles.titleContainer}>
                    <Layers2 size={16} strokeWidth={2.5} />
                    <span className={styles.title}>Realized P/L Breakdown · {data.symbol}</span>
                </div>
                {data.isCrossCurrency && (
                    <div className={styles.fxRateInfo}>
                        FX: {data.entryFxRate.toFixed(4)} →{" "}
                        {data.currentFxRate.toFixed(4)} ({data.nativeCurrency}/
                        {data.baseCurrency})
                    </div>
                )}
            </div>
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th>Type</th>
                        <th>{data.nativeCurrency}</th>
                        <th>{data.baseCurrency} (base)</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Stock Return</td>
                        <td>{stockNativeText}</td>
                        <td>{stockBaseText}</td>
                    </tr>
                    {data.isCrossCurrency && (
                        <tr>
                            <td>FX Return</td>
                            <td>—</td>
                            <td>{fxBaseText}</td>
                        </tr>
                    )}
                    <tr className={styles.totalRow}>
                        <td>Total Realized</td>
                        <td>{totalNativeText}</td>
                        <td className={valueClass}>{totalBaseText}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    );

    const popoverContent =
        mode === "abs"
            ? absPopoverContent
            : mode === "pct"
            ? pctPopoverContent
            : historicPopoverContent;

    return (
        <Tooltip content={popoverContent} variant="popover">
            <button
                type="button"
                className={styles.badge}
                aria-label="View return breakdown"
            >
                <Layers2
                    size={14}
                    strokeWidth={2}
                    className={isPos ? styles.positive : styles.negative}
                />
            </button>
        </Tooltip>
    );
}

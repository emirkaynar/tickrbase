import { ArrowLeftRight } from "lucide-react";
import { isCrossCurrency } from "../../../utils";
import { Tooltip } from "../../Tooltip/Tooltip";
import styles from "./FxBadge.module.css";

export interface FxBadgeProps {
    currency?: string;
    baseCurrency?: string;
    fxRate?: number;
    isHistoric?: boolean;
}

export function FxBadge({
    currency,
    baseCurrency,
    fxRate,
    isHistoric = false,
}: FxBadgeProps) {
    if (!currency || !baseCurrency || !isCrossCurrency(currency, baseCurrency)) {
        return null;
    }

    const rateText = typeof fxRate === "number" ? fxRate.toFixed(4) : "-";
    const historicLabel = isHistoric ? "historical rate " : "";
    const tooltipContent = `Converted from ${currency} at ${historicLabel}${rateText} → ${baseCurrency}`;

    return (
        <Tooltip content={tooltipContent}>
            <button
                type="button"
                className={styles.fxBadge}
                aria-label={`FX rate info: ${currency} to ${baseCurrency}`}
            >
                <ArrowLeftRight size={13} strokeWidth={2} />
            </button>
        </Tooltip>
    );
}
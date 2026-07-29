const NUMBER_FORMATTER_2 = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

const INTEGER_FORMATTER = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
});

const PERCENT_FORMATTER_ALWAYS = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "always",
});

const PERCENT_FORMATTER_AUTO = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "auto",
});

/**
 * Standard number formatter (e.g. 1,234.56).
 */
export function formatNumber(
    val: number | null | undefined,
    decimals = 2,
): string {
    if (val == null || isNaN(val)) return "-";
    if (decimals === 2) return NUMBER_FORMATTER_2.format(val);
    return new Intl.NumberFormat("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    }).format(val);
}

/**
 * Integer / whole number formatter with digit grouping (e.g. 1,234,567).
 */
export function formatInteger(val: number | null | undefined): string {
    if (val == null || isNaN(val)) return "-";
    return INTEGER_FORMATTER.format(val);
}

export interface FormatPercentOptions {
    decimals?: number;
    signDisplay?: "always" | "auto" | "exceptZero";
    prefixSign?: boolean; // e.g. "+1.55%" vs "1.55%"
}

/**
 * Formats a percentage value (e.g. "+1.55%", "-0.82%").
 */
export function formatPercent(
    val: number | null | undefined,
    options?: FormatPercentOptions,
): string {
    if (val == null || isNaN(val)) return "-";
    const signDisplay = options?.signDisplay ?? "always";
    const decimals = options?.decimals ?? 2;

    if (decimals === 2 && signDisplay === "always") {
        return `${PERCENT_FORMATTER_ALWAYS.format(val)}%`;
    }
    if (decimals === 2 && signDisplay === "auto") {
        return `${PERCENT_FORMATTER_AUTO.format(val)}%`;
    }

    const formatted = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        signDisplay,
    }).format(val);

    return `${formatted}%`;
}

export interface FormatPercentChangeOptions {
    decimals?: number;
    showArrow?: boolean; // e.g. "▲ 1.55%" vs "1.55%"
}

/**
 * Formats a percentage change value with optional direction arrows (▲ / ▼).
 * Examples:
 * formatPercentChange(1.55) -> "▲ 1.55%"
 * formatPercentChange(-0.82) -> "▼ 0.82%"
 * formatPercentChange(0) -> "0.00%"
 */
export function formatPercentChange(
    val: number | null | undefined,
    options?: FormatPercentChangeOptions,
): string {
    if (val == null || isNaN(val)) return "-";
    const decimals = options?.decimals ?? 2;
    const showArrow = options?.showArrow ?? true;
    const absValStr = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    }).format(Math.abs(val));

    if (val > 0) {
        return `${showArrow ? "▲ " : ""}${absValStr}%`;
    }
    if (val < 0) {
        return `${showArrow ? "▼ " : ""}${absValStr}%`;
    }
    return `${absValStr}%`;
}

/**
 * Compact volume / scalar number formatter (e.g. 1.25B, 450.20M, 12.5K).
 */
export function formatVolume(val: number | null | undefined): string {
    if (val == null || isNaN(val) || val === 0) return "-";
    const abs = Math.abs(val);
    if (abs >= 1_000_000_000_000) return `${(val / 1_000_000_000_000).toFixed(2)}T`;
    if (abs >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
    return val.toFixed(0);
}

/**
 * Formats a quantity with compact scale and optional unit suffix (e.g. "1.25B Shares").
 */
export function formatQuantity(
    val: number | null | undefined,
    unit = "Shares",
): string {
    const volStr = formatVolume(val);
    if (volStr === "-") return "-";
    return unit ? `${volStr} ${unit}` : volStr;
}

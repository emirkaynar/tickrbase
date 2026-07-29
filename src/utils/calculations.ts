/**
 * Calculates absolute price change: current - previous
 */
export function calcChange(
    current: number | null | undefined,
    previous: number | null | undefined,
): number | null {
    if (current == null || previous == null) return null;
    return current - previous;
}

/**
 * Calculates percentage change: ((current - previous) / previous) * 100
 */
export function calcChangePercent(
    current: number | null | undefined,
    previous: number | null | undefined,
): number | null {
    if (current == null || previous == null || previous === 0) return null;
    return ((current - previous) / previous) * 100;
}

/**
 * Calculates range progress percentage (0-100) between low and high.
 */
export function calcRangeProgress(
    current: number | null | undefined,
    low: number | null | undefined,
    high: number | null | undefined,
): number {
    if (current == null || low == null || high == null || high <= low) return 50;
    const clamped = Math.max(low, Math.min(current, high));
    return ((clamped - low) / (high - low)) * 100;
}

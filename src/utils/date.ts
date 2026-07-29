/**
 * Converts a Unix timestamp in seconds to local date string YYYY-MM-DD.
 */
export function toLocalDateStr(unixSec: number): string {
    const d = new Date(unixSec * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Formats a Unix timestamp in specified timezone (default: Europe/Istanbul).
 */
export function formatTimestamp(
    unixSec: number,
    opts: Intl.DateTimeFormatOptions,
    timezone = "Europe/Istanbul",
): string {
    return new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        ...opts,
    }).format(new Date(unixSec * 1000));
}

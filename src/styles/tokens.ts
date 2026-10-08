/**
 * JS mirror of design tokens — used where CSS variables are inaccessible,
 * primarily inside lightweight-charts canvas configuration.
 *
 * Reads live computed values from the document root so they automatically
 * reflect the active theme (light or dark).
 *
 * NOTE: lightweight-charts does not accept hsl() strings; all colors are
 * converted to hex before being returned.
 */

function token(name: string): string {
    if (typeof document === "undefined") return "";
    return getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();
}

/** Convert `hsl(h, s%, l%)` / `hsla(...)` to `#rrggbb`. Passes hex through. */
function hslToHex(value: string): string {
    const m = value.match(
        /hsla?\(\s*([\d.]+)[,\s]+\s*([\d.]+)%[,\s]+\s*([\d.]+)%/,
    );
    if (!m) return value; // already hex or named color

    const h = parseFloat(m[1]);
    const s = parseFloat(m[2]) / 100;
    const l = parseFloat(m[3]) / 100;

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const mv = l - c / 2;

    let r: number, g: number, b: number;
    if (h < 60) {
        r = c;
        g = x;
        b = 0;
    } else if (h < 120) {
        r = x;
        g = c;
        b = 0;
    } else if (h < 180) {
        r = 0;
        g = c;
        b = x;
    } else if (h < 240) {
        r = 0;
        g = x;
        b = c;
    } else if (h < 300) {
        r = x;
        g = 0;
        b = c;
    } else {
        r = c;
        g = 0;
        b = x;
    }

    const toHex = (v: number) =>
        Math.round((v + mv) * 255)
            .toString(16)
            .padStart(2, "0");

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function colorToken(name: string): string {
    return hslToHex(token(name));
}

export function getChartColors() {
  return {
        transparent: "transparent",
        bg: colorToken("--color-bg"),
        bgElevated: colorToken("--color-bg-elevated"),
        bgSurface: colorToken("--color-bg-surface"),
        border: colorToken("--color-border"),
        text: colorToken("--color-text"),
        textMuted: colorToken("--color-text-muted"),
        textSubtle: colorToken("--color-text-subtle"),
        bull: colorToken("--color-bull"),
        bear: colorToken("--color-bear"),
        warning: colorToken("--color-warning"),
        success: colorToken("--color-success"),
        blue: colorToken("--color-blue"),
        amber: colorToken("--color-amber"),
        primary: colorToken("--color-primary"),
        accent: colorToken("--color-accent"),
    };
}

export function getFonts() {
    return {
        base: token("--font-base"),
        mono: token("--font-mono"),
    };
}


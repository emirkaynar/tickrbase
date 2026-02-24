// JS-side mirror of src/styles/tokens.css
// Used wherever CSS variables can't be read (e.g. Lightweight Charts canvas config).
// Keep in sync with tokens.css.

export const colors = {
    bg: "#000",
    bgElevated: "#1a1a1a",
    bgSurface: "#222",
    border: "hsl(0, 0%, 14%)",
    text: "#ccc",
    textMuted: "#888",
    textSubtle: "#666",
    error: "#c44",
    bull: "#26a69a",
    bear: "#ef5350",
} as const;

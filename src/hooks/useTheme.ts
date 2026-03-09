import { useEffect, useState } from "preact/hooks";

export type Theme = "light" | "dark";

const STORAGE_KEY = "lima:theme";

function resolveInitialTheme(): Theme {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === "light" || stored === "dark") return stored;
    } catch {
        /* ignore */
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
}

export function useTheme(): {
    theme: Theme;
    toggleTheme: () => void;
    setTheme: (t: Theme) => void;
} {
    const [theme, setThemeState] = useState<Theme>(resolveInitialTheme);

    useEffect(() => {
        document.documentElement.setAttribute("data-theme", theme);
        try {
            localStorage.setItem(STORAGE_KEY, theme);
        } catch {
            /* ignore */
        }
    }, [theme]);

    // Sync with OS changes when user hasn't overridden
    useEffect(() => {
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const handler = (e: MediaQueryListEvent) => {
            try {
                if (!localStorage.getItem(STORAGE_KEY)) {
                    setThemeState(e.matches ? "dark" : "light");
                }
            } catch {
                /* ignore */
            }
        };
        mq.addEventListener("change", handler);
        return () => mq.removeEventListener("change", handler);
    }, []);

    const setTheme = (t: Theme) => setThemeState(t);
    const toggleTheme = () =>
        setThemeState((prev) => (prev === "dark" ? "light" : "dark"));

    return { theme, toggleTheme, setTheme };
}

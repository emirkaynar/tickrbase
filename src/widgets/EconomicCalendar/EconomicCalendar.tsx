import { useEffect, useRef, useState } from "preact/hooks";
import { Skeleton, WidgetRemoveButton } from "../../ui";
import { registerWidget } from "../registry";
import styles from "./EconomicCalendar.module.css";

type Props = { id: string; onRemove: () => void };
type ThemeMode = "dark" | "light";

const TV_EMBED_URL =
    "https://s3.tradingview.com/external-embedding/embed-widget-events.js";
const SKELETON_MS = 1200;

function getThemeMode(): ThemeMode {
    const current = document.documentElement.getAttribute("data-theme");
    return current === "light" ? "light" : "dark";
}

function EconomicCalendar({ onRemove }: Props) {
    const hostRef = useRef<HTMLDivElement>(null);
    const [themeMode, setThemeMode] = useState<ThemeMode>(getThemeMode);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const observer = new MutationObserver(() => {
            setThemeMode(getThemeMode());
            setLoading(true);
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-theme"],
        });

        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        host.innerHTML = "";

        const widgetRoot = document.createElement("div");
        widgetRoot.className = "tradingview-widget-container__widget";
        widgetRoot.style.height = "100%";
        widgetRoot.style.width = "100%";
        host.appendChild(widgetRoot);

        const script = document.createElement("script");
        script.src = TV_EMBED_URL;
        script.type = "text/javascript";
        script.async = true;
        script.innerHTML = JSON.stringify({
            colorTheme: themeMode,
            isTransparent: true,
            locale: "en",
            countryFilter:
                "ar,au,br,ca,cn,fr,de,in,id,it,jp,kr,mx,ru,sa,za,tr,gb,us,eu",
            importanceFilter: "-1,0,1",
            width: "100%",
            height: "100%",
        });

        host.appendChild(script);

        const loadingTimeout = window.setTimeout(() => {
            setLoading(false);
        }, SKELETON_MS);

        return () => {
            host.innerHTML = "";
            window.clearTimeout(loadingTimeout);
        };
    }, [themeMode]);

    return (
        <div class={styles.root}>
            <div class={`${styles.handle} widget-handle`}>
                <div class={`${styles.dragGrip} sc-drag-grip`}>
                    <div class={styles.heading}>Economic Calendar</div>
                </div>
                <div class={styles.controls}>
                    <WidgetRemoveButton
                        class={styles.removeBtn}
                        onClick={onRemove}
                    />
                </div>
            </div>

            <div class={styles.content}>
                <div
                    class={`tradingview-widget-container ${styles.widgetHost}`}
                    ref={hostRef}
                />
                {loading && <Skeleton variant="rect" />}
            </div>
        </div>
    );
}

registerWidget({
    type: "economic-calendar",
    label: "Economic Calendar",
    defaultSize: { w: 7, h: 29 },
    minSize: { w: 6, h: 9 },
    component: EconomicCalendar,
    settings: [
        {
            id: "economicCalendar.defaultCountryFilter",
            categoryId: "Widgets",
            subcategoryLabel: "Economic Calendar",
            type: "string",
            label: "Default Country #todo",
            description:
                "Comma-separated list of country codes to show in the calendar by default. See TradingView documentation for valid codes.",
            defaultValue:
                "ar,au,br,ca,cn,fr,de,in,id,it,jp,kr,mx,ru,sa,za,tr,gb,us,eu",
        },
        {
            id: "economicCalendar.defaultImportanceFilter",
            categoryId: "Widgets",
            subcategoryLabel: "Economic Calendar",
            type: "boolean",
            label: "Default Importance #todo",
            description:
                "Show only economic events with the selected importance level by default.",
            defaultValue: false,
        }
    ],
});

export { EconomicCalendar };

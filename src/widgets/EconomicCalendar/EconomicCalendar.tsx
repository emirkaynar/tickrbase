import { useEffect, useRef, useState } from "preact/hooks";
import { getSettingValue } from "../../services/settings";
import { registerWidget } from "../registry";
import { Shell } from "../Shell";
import styles from "./EconomicCalendar.module.css";

type Props = { id: string; onRemove: () => void };
type ThemeMode = "dark" | "light";

const TV_EMBED_URL =
  "https://s3.tradingview.com/external-embedding/embed-widget-events.js";
const SKELETON_MS = 1200;
const DEFAULT_COUNTRY_FILTER =
  "ar,au,br,ca,cn,fr,de,in,id,it,jp,kr,mx,ru,sa,za,tr,gb,us,eu";
const ALL_IMPORTANCE_FILTER = "-1,0,1";
const HIGH_IMPORTANCE_FILTER = "0,1";

function getThemeMode(): ThemeMode {
  const current = document.documentElement.getAttribute("data-theme");
  return current === "light" ? "light" : "dark";
}

function EconomicCalendar({ id, onRemove }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(getThemeMode);
  const [defaultCountryFilter, setDefaultCountryFilter] = useState(
    DEFAULT_COUNTRY_FILTER,
  );
  const [defaultImportanceOnly, setDefaultImportanceOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [countryFilter, importanceOnly] = await Promise.all([
        getSettingValue<string>("economicCalendar.defaultCountryFilter"),
        getSettingValue<boolean>("economicCalendar.defaultImportanceFilter"),
      ]);
      if (!cancelled) {
        setDefaultCountryFilter(countryFilter);
        setDefaultImportanceOnly(importanceOnly);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

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
    setLoading(true);

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
      countryFilter: defaultCountryFilter,
      importanceFilter: defaultImportanceOnly
        ? HIGH_IMPORTANCE_FILTER
        : ALL_IMPORTANCE_FILTER,
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
  }, [themeMode, defaultCountryFilter, defaultImportanceOnly]);

  return (
    <Shell
      id={id}
      className={styles.root}
      headerLeft={<div class={styles.heading}>Economic Calendar</div>}
      draggableHeaderLeft={true}
      loading={loading}
      onRemove={onRemove}
    >
      <div class={styles.content}>
        <div
          class={`tradingview-widget-container ${styles.widgetHost}`}
          ref={hostRef}
        />
      </div>
    </Shell>
  );
}

registerWidget({
  type: "economic-calendar",
  label: "Economic Calendar",
  defaultSize: { w: 5, h: 24 },
  minSize: { w: 4, h: 6 },
  component: EconomicCalendar,
  settingSections: [
    {
      category: "Widgets",
      subcategoryId: "economic-calendar",
      subcategoryLabel: "Economic Calendar",
      subcategoryIcon: "Calendar",
      settings: [
        {
          id: "economicCalendar.defaultCountryFilter",
          type: "string",
          label: "Default Country",
          description:
            "Comma-separated list of country codes to show in the calendar by default. See TradingView documentation for valid codes.",
          defaultValue: DEFAULT_COUNTRY_FILTER,
        },
        {
          id: "economicCalendar.defaultImportanceFilter",
          type: "boolean",
          label: "Default Importance",
          description:
            "Show only economic events with the selected importance level by default.",
          defaultValue: false,
        },
      ],
    },
  ],
});

export { EconomicCalendar };

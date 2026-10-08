export type SettingType = "boolean" | "integer" | "string" | "select";

export type SettingValue = boolean | number | string;

export type SettingOption = { label: string; value: string };
export type SettingOptions =
  | readonly SettingOption[]
  | (() => readonly SettingOption[]);

export type SettingItemDefinition = {
  id: string; // Global unique ID, e.g. 'watchlist.disablePulse'
  label: string;
  description: string;
} & (
  | { type: "boolean"; defaultValue: boolean }
  | { type: "integer"; defaultValue: number }
  | { type: "string"; defaultValue: string }
  | {
      type: "select";
      defaultValue: string;
      options: SettingOptions;
      placeholder?: string;
      // Overrides membership validation for valid values outside the option list.
      validate?: (value: string) => string | null;
    }
);

export type SettingDefinition = SettingItemDefinition & {
  category: string; // Top-level grouping key, e.g. 'general'
  subcategoryId: string; // Stable nested grouping key, e.g. 'lists'
  subcategoryLabel: string; // Nested tab label, e.g. 'Lists'
  subcategoryIcon?: string; // Optional Lucide icon name, e.g. 'List'
}

export interface SettingSectionDefinition {
  category: string;
  subcategoryId: string;
  subcategoryLabel: string;
  subcategoryIcon?: string;
  settings: SettingItemDefinition[];
}

export function getSettingOptions(
  def: Extract<SettingDefinition, { type: "select" }>,
): readonly SettingOption[] {
  return typeof def.options === "function" ? def.options() : def.options;
}

export function isValidTimezone(value: string): boolean {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

let timezoneOptions: readonly SettingOption[] | undefined;

function getTimezoneOptions(): readonly SettingOption[] {
  if (timezoneOptions) return timezoneOptions;

  let zones: string[];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [Intl.DateTimeFormat().resolvedOptions().timeZone];
  }
  timezoneOptions = [...new Set(["UTC", ...zones])].map(value => ({
    value,
    label: value.replaceAll("_", " "),
  }));
  return timezoneOptions;
}

const settingsMap = new Map<string, SettingDefinition>();
const sectionMetadataMap = new Map<
  string,
  Pick<SettingDefinition, "subcategoryLabel" | "subcategoryIcon">
>();

function getSectionKey(category: string, subcategoryId: string): string {
  return `${category}::${subcategoryId}`;
}

function assertSectionMetadataConsistency(
  def: Pick<
    SettingDefinition,
    "category" | "subcategoryId" | "subcategoryLabel" | "subcategoryIcon"
  >,
): void {
  const key = getSectionKey(def.category, def.subcategoryId);
  const existing = sectionMetadataMap.get(key);
  if (!existing) {
    sectionMetadataMap.set(key, {
      subcategoryLabel: def.subcategoryLabel,
      subcategoryIcon: def.subcategoryIcon,
    });
    return;
  }

  if (
    existing.subcategoryLabel !== def.subcategoryLabel ||
    existing.subcategoryIcon !== def.subcategoryIcon
  ) {
    throw new Error(
      `Conflicting section metadata for "${key}". Existing label/icon: "${existing.subcategoryLabel}" / "${existing.subcategoryIcon ?? ""}", incoming label/icon: "${def.subcategoryLabel}" / "${def.subcategoryIcon ?? ""}".`,
    );
  }
}

export function normalizeSettingSections(
  sections: SettingSectionDefinition[],
): SettingDefinition[] {
  const sectionMap = new Map<
    string,
    Pick<SettingDefinition, "subcategoryLabel" | "subcategoryIcon">
  >();
  const normalized: SettingDefinition[] = [];

  for (const section of sections) {
    const key = getSectionKey(section.category, section.subcategoryId);
    const existing = sectionMap.get(key);
    if (!existing) {
      sectionMap.set(key, {
        subcategoryLabel: section.subcategoryLabel,
        subcategoryIcon: section.subcategoryIcon,
      });
    } else if (
      existing.subcategoryLabel !== section.subcategoryLabel ||
      existing.subcategoryIcon !== section.subcategoryIcon
    ) {
      throw new Error(
        `Conflicting section metadata in declaration for "${key}".`,
      );
    }

    for (const setting of section.settings) {
      normalized.push({
        ...setting,
        category: section.category,
        subcategoryId: section.subcategoryId,
        subcategoryLabel: section.subcategoryLabel,
        subcategoryIcon: section.subcategoryIcon,
      });
    }
  }

  return normalized;
}

/**
 * Registers a new setting definition.
 */
export function registerSetting(def: SettingDefinition): void {
  assertSectionMetadataConsistency(def);
  settingsMap.set(def.id, def);
}

export function registerSettingSections(
  sections: SettingSectionDefinition[],
): void {
  const settings = normalizeSettingSections(sections);
  for (const setting of settings) {
    registerSetting(setting);
  }
}

/**
 * Retrieves a setting definition by its ID.
 */
export function getSettingDefinition(
  id: string,
): SettingDefinition | undefined {
  return settingsMap.get(id);
}

/**
 * Returns all registered settings.
 */
export function getAllSettings(): SettingDefinition[] {
  return Array.from(settingsMap.values());
}

registerSettingSections([
  {
    category: "general",
    subcategoryId: "portfolio",
    subcategoryLabel: "Portfolio",
    subcategoryIcon: "Briefcase",
    settings: [
      {
        id: "portfolio.defaultCurrency",
        type: "string",
        label: "Default Base Currency for All Portfolios",
        description: "Currency used when viewing 'All Portfolios' or as general fallback.",
        defaultValue: "TRY",
      },
      {
        id: "portfolio.showNativeSubtitles",
        type: "boolean",
        label: "Show Native Currency Subtitles",
        description: "Display the asset's native trading currency as a muted subtitle under converted values in Holdings and Transactions.",
        defaultValue: true,
      },
    ],
  },
  {
    category: "general",
    subcategoryId: "language",
    subcategoryLabel: "Language",
    subcategoryIcon: "Languages",
    settings: [
      {
        id: "general.language",
        type: "string",
        label: "Language #todo",
        description: "Select your preferred language.",
        defaultValue: "en",
      },
    ],
  },
  {
    category: "general",
    subcategoryId: "timezone",
    subcategoryLabel: "Timezone",
    subcategoryIcon: "Clock",
    settings: [
      {
        id: "general.timezone",
        type: "select",
        label: "Display timezone",
        description: "Timezone used for chart times and market status. Exchange schedules remain in their native timezone.",
        defaultValue: "UTC",
        options: getTimezoneOptions,
        placeholder: "Search timezones…",
        validate: value => isValidTimezone(value) ? null : "Invalid IANA timezone",
      },
    ],
  },
  {
    category: "general",
    subcategoryId: "storage",
    subcategoryLabel: "Storage",
    subcategoryIcon: "HardDrive",
    settings: [
      {
        id: "general.storage",
        type: "string",
        label: "Storage #todo",
        description: "Manage your storage settings.",
        defaultValue: "UTC",
      },
    ],
  },
  {
    category: "integrations",
    subcategoryId: "tickrbase-bridge",
    subcategoryLabel: "TICKRBASE Bridge",
    subcategoryIcon: "GitCompare",
    settings: [
      {
        id: "integrations.tickrbaseBridge.url",
        type: "string",
        label: "Server URL #todo",
        description: "Configure the URL for connecting to your TICKRBASE Bridge server.",
        defaultValue: "http://localhost:8001",
      },
    ],
  },
  {
    category: "integrations",
    subcategoryId: "tradingview",
    subcategoryLabel: "TradingView",
    subcategoryIcon: "GitCompare",
    settings: [
      {
        id: "inregrations.tradingView.embedUrl",
        type: "string",
        label: "Embed URL #todo",
        description: "Configure the base URL for embedding TradingView widgets. This is used to work around CORS issues when loading widgets from the official TradingView domain.",
        defaultValue: "https://s3.tradingview.com/external-embedding",
      },
    ],
  },
  {
    category: "Widgets",
    subcategoryId: "basic-chart",
    subcategoryLabel: "Basic Chart",
    subcategoryIcon: "ChartLine",
    settings: [
      {
        id: "basicChart.defaultInterval",
        type: "string",
        label: "Default Interval #todo",
        description: "Default time interval for new charts. Can be overridden per chart using the interval selector in the widget header.",
        defaultValue: "1d",
      },
      {
        id: "defaultChartSymbol",
        type: "string",
        label: "Default Symbol #todo",
        description: "Default ticker symbol for new charts. Can be overridden per chart using the ticker selector in the widget header.",
        defaultValue: "XU100.IS",
      },
      {
        id: "crosshairMode",
        type: "integer",
        label: "Crosshair Mode #todo",
        description: "Determines how the crosshair behaves on the chart. 0 = normal, 1 = magnet (snaps to nearest data point), 2 = free (does not snap).",
        defaultValue: 1,
      },
    ],
  },
  {
    category: "Widgets",
    subcategoryId: "advanced-chart",
    subcategoryLabel: "Advanced Chart",
    subcategoryIcon: "ChartCandlestick",
    settings: [
      {
        id: "advancedChart.defaultSymbol",
        type: "string",
        label: "Default Symbol",
        description: "The default symbol to show when no symbol is set.",
        defaultValue: "NVDA",
      },
    ],
  },
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
        description: "Comma-separated list of country codes to show in the calendar by default. See TradingView documentation for valid codes.",
        defaultValue: "ar,au,br,ca,cn,fr,de,in,id,it,jp,kr,mx,ru,sa,za,tr,gb,us,eu",
      },
      {
        id: "economicCalendar.defaultImportanceFilter",
        type: "boolean",
        label: "Default Importance",
        description: "Show only economic events with the selected importance level by default.",
        defaultValue: false,
      },
    ],
  },
  {
    category: "Widgets",
    subcategoryId: "lists",
    subcategoryLabel: "Lists",
    subcategoryIcon: "List",
    settings: [
      {
        id: "watchlist.disablePulse",
        type: "boolean",
        label: "Disable Pulse Animations",
        description: "Disable real-time price change pulse animations and related calculations for better performance.",
        defaultValue: false,
      },
    ],
  },
]);

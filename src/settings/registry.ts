export type SettingType = "boolean" | "integer" | "string";

export type SettingValue = boolean | number | string;

export interface SettingItemDefinition {
  id: string; // Global unique ID, e.g. 'watchlist.disablePulse'
  type: SettingType;
  label: string;
  description: string;
  defaultValue: SettingValue;
}

export interface SettingDefinition extends SettingItemDefinition {
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
        type: "string",
        label: "Timezone #todo",
        description: "Select your preferred timezone.",
        defaultValue: "UTC",
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
    
  }
]);

export type SettingType = "boolean" | "integer" | "string";

export type SettingValue = boolean | number | string;

export interface SettingDefinition {
    id: string; // Global unique ID, e.g. 'watchlist.disablePulse'
    categoryId: string; // Top-level grouping key, e.g. 'general'
    subcategoryLabel: string; // Nested tab label, e.g. 'Lists'
    type: SettingType;
    label: string;
    description: string;
    defaultValue: SettingValue;
}

const settingsMap = new Map<string, SettingDefinition>();

/**
 * Registers a new setting definition.
 */
export function registerSetting(def: SettingDefinition): void {
    if (settingsMap.has(def.id)) {
        console.warn(
            `Setting with id "${def.id}" is already registered. Overwriting.`,
        );
    }
    settingsMap.set(def.id, def);
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

registerSetting({
    id: "general.language",
    categoryId: "general",
    subcategoryLabel: "Language",
    type: "string",
    label: "Language #todo",
    description: "Select your preferred language.",
    defaultValue: "en",
});

registerSetting({
    id: "general.timezone",
    categoryId: "general",
    subcategoryLabel: "Timezone",
    type: "string",
    label: "Timezone #todo",
    description: "Select your preferred timezone.",
    defaultValue: "UTC",
});

registerSetting({
    id: "general.storage",
    categoryId: "general",
    subcategoryLabel: "Storage",
    type: "string",
    label: "Storage #todo",
    description: "Manage your storage settings.",
    defaultValue: "UTC",
});

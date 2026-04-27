export type SettingType = "boolean" | "integer" | "string";

export type SettingValue = boolean | number | string;

export interface SettingDefinition {
    id: string; // Global unique ID, e.g. 'watchlist.disablePulse'
    groupId: string; // Used for grouping UI, e.g. 'watchlist'
    groupLabel: string; // e.g. 'Lists Widget'
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
        console.warn(`Setting with id "${def.id}" is already registered. Overwriting.`);
    }
    settingsMap.set(def.id, def);
}

/**
 * Retrieves a setting definition by its ID.
 */
export function getSettingDefinition(id: string): SettingDefinition | undefined {
    return settingsMap.get(id);
}

/**
 * Returns all registered settings.
 */
export function getAllSettings(): SettingDefinition[] {
    return Array.from(settingsMap.values());
}

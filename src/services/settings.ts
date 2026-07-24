import { api } from "./api";
import { getSettingDefinition, type SettingValue } from "../settings/registry";

type SettingsResponse = {
    settings: Record<string, SettingValue>;
};

let settingsCache: {
    data: Record<string, SettingValue> | null;
    fetchedAt: number;
} = {
    data: null,
    fetchedAt: 0,
};

const CACHE_TTL_MS = 30_000;

export async function prefetchSettings(): Promise<void> {
    try {
        const res = await api.get<SettingsResponse>("/user/settings");
        settingsCache = {
            data: res.settings || {},
            fetchedAt: Date.now(),
        };
    } catch {
        // Ignore prefetch errors
    }
}

/**
 * Resolves a setting value by merging the declared default with any persisted override.
 */
export async function getSettingValue<T extends SettingValue>(id: string): Promise<T> {
    const def = getSettingDefinition(id);
    if (!def) {
        throw new Error(`Setting definition not found for id: ${id}`);
    }

    const now = Date.now();
    if (settingsCache.data && now - settingsCache.fetchedAt < CACHE_TTL_MS) {
        if (id in settingsCache.data) {
            return settingsCache.data[id] as T;
        }
        return def.defaultValue as T;
    }

    try {
        const res = await api.get<SettingsResponse>("/user/settings");
        settingsCache = {
            data: res.settings || {},
            fetchedAt: now,
        };
        if (res.settings && id in res.settings) {
            return res.settings[id] as T;
        }
    } catch {
        // Fallback to default value if API request fails
    }

    return def.defaultValue as T;
}

/**
 * Persists a setting value override.
 * Enforces type validation based on the setting's declaration.
 */
export async function setSettingValue(id: string, value: SettingValue): Promise<void> {
    const def = getSettingDefinition(id);
    if (!def) {
        throw new Error(`Cannot set value for unknown setting: ${id}`);
    }

    // Validation
    const actualType = typeof value;
    if (def.type === "boolean" && actualType !== "boolean") {
        throw new Error(`Invalid type for setting ${id}: expected boolean, got ${actualType}`);
    }
    if (def.type === "string" && actualType !== "string") {
        throw new Error(`Invalid type for setting ${id}: expected string, got ${actualType}`);
    }
    if (def.type === "integer") {
        if (actualType !== "number" || !Number.isInteger(value)) {
            throw new Error(`Invalid type for setting ${id}: expected integer, got ${actualType}`);
        }
    }

    await api.put("/user/settings", {
        settings: { [id]: value },
    });

    if (settingsCache.data) {
        settingsCache.data[id] = value;
        settingsCache.fetchedAt = Date.now();
    }
}

/**
 * Checks if a boolean setting is enabled.
 */
export async function isEnabled(id: string): Promise<boolean> {
    return getSettingValue<boolean>(id);
}

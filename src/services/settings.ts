import { db } from "../db";
import { getSettingDefinition, type SettingValue } from "../settings/registry";

/**
 * Resolves a setting value by merging the declared default with any persisted override.
 */
export async function getSettingValue<T extends SettingValue>(id: string): Promise<T> {
    const def = getSettingDefinition(id);
    if (!def) {
        throw new Error(`Setting definition not found for id: ${id}`);
    }

    const record = await db.settings.get(id);
    if (record) {
        return record.value as T;
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

    await db.settings.put({
        id,
        value,
        updatedAt: Date.now(),
    });
}

/**
 * Checks if a boolean setting is enabled.
 */
export async function isEnabled(id: string): Promise<boolean> {
    return getSettingValue<boolean>(id);
}

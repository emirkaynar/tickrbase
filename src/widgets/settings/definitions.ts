import type { WidgetSettingDefinition, WidgetSettingsDefinition, WidgetSettingValue, WidgetSettingValues } from "./types";

export function widgetSettingItems(definition: WidgetSettingsDefinition): WidgetSettingDefinition[] {
    return definition.tabs.flatMap(tab => tab.groups.flatMap(group => group.settings));
}
export function isWidgetSettingValue(setting: WidgetSettingDefinition, value: unknown): value is WidgetSettingValue {
    return setting.type === "boolean" ? typeof value === "boolean"
        : typeof value === "string" && setting.options.some(option => option.value === value);
}
export function resolveWidgetSettings(definition: WidgetSettingsDefinition, saved: Record<string, unknown>): WidgetSettingValues {
    return Object.fromEntries(widgetSettingItems(definition).map(setting => [
        setting.id, isWidgetSettingValue(setting, saved[setting.id]) ? saved[setting.id] : setting.defaultValue,
    ])) as WidgetSettingValues;
}
export function defaultWidgetSettings(definition: WidgetSettingsDefinition): WidgetSettingValues {
    return Object.fromEntries(widgetSettingItems(definition).map(setting => [setting.id, setting.defaultValue]));
}

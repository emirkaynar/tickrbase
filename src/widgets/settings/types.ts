export type WidgetSettingValue = boolean | string;
export type WidgetSettingValues = Record<string, WidgetSettingValue>;

type SettingBase = { id: string; label: string; description?: string };
export type WidgetSettingDefinition = SettingBase & (
    | { type: "boolean"; defaultValue: boolean }
    | { type: "select"; defaultValue: string; options: { label: string; value: string }[] }
);

export type WidgetSettingsDefinition = {
    title: string;
    tabs: {
        id: string;
        label: string;
        groups: { id: string; label: string; settings: WidgetSettingDefinition[] }[];
    }[];
};

export type WidgetSettingsProps = {
    definition: WidgetSettingsDefinition;
    values: WidgetSettingValues;
    onChange: (id: string, value: WidgetSettingValue) => void;
    onReset: () => void;
    ready: boolean;
    status: "loading" | "ready" | "saving" | "unsaved" | "error";
    error: string | null;
    onRetry: () => void;
};

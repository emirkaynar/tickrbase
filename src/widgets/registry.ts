import type { ComponentType } from "preact";
import {
    normalizeSettingSections,
    registerSetting,
    type SettingSectionDefinition,
} from "../settings/registry";

export type WidgetType =
    | "basic-chart"
    | "advanced-chart"
    | "economic-calendar"
    | "watchlist"
    | "symbol-overview";

export type WidgetSize = { w: number; h: number };

export type WidgetComponentProps = {
    id: string;
    onRemove: () => void;
};

export type WidgetDefinition = {
    type: WidgetType;
    label: string;
    defaultSize: WidgetSize;
    minSize: WidgetSize;
    component: ComponentType<WidgetComponentProps>;
    settingSections?: SettingSectionDefinition[];
};

export type WidgetInstance = {
    id: string;
    screenId: string;
    type: WidgetType;
    x: number;
    y: number;
    w: number;
    h: number;
    minW: number;
    minH: number;
    createdAt: number;
};

// Populated after feature modules are initialised
const widgetMap = new Map<WidgetType, WidgetDefinition>();

export function registerWidget(def: WidgetDefinition): void {
    widgetMap.set(def.type, def);

    if (def.settingSections) {
        for (const setting of normalizeSettingSections(def.settingSections)) {
            registerSetting(setting);
        }
    }
}

export function getWidgetDefinition(type: WidgetType): WidgetDefinition {
    const def = widgetMap.get(type);
    if (!def) throw new Error(`Unknown widget type: ${type}`);
    return def;
}

export function createWidgetInstance(
    screenId: string,
    type: WidgetType,
    position?: { x: number; y: number; w: number; h: number },
): WidgetInstance {
    const def = getWidgetDefinition(type);
    const stamp = Date.now();
    return {
        id: `${type}-${stamp}`,
        screenId,
        type,
        x: position?.x ?? 0,
        y: position?.y ?? 0,
        w: position?.w ?? def.defaultSize.w,
        h: position?.h ?? def.defaultSize.h,
        minW: def.minSize.w,
        minH: def.minSize.h,
        createdAt: stamp,
    };
}

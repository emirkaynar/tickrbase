import type { ComponentType } from "preact";

export type WidgetType = "stock-chart";

export type WidgetSize = { w: number; h: number };

export type WidgetDefinition = {
    type: WidgetType;
    label: string;
    defaultSize: WidgetSize;
    minSize: WidgetSize;
    component: ComponentType<{ id: string }>;
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
}

export function getWidgetDefinition(type: WidgetType): WidgetDefinition {
    const def = widgetMap.get(type);
    if (!def) throw new Error(`Unknown widget type: ${type}`);
    return def;
}

export function createWidgetInstance(
    screenId: string,
    type: WidgetType,
): WidgetInstance {
    const def = getWidgetDefinition(type);
    const stamp = Date.now();
    return {
        id: `${type}-${stamp}`,
        screenId,
        type,
        x: 0,
        y: 0,
        w: def.defaultSize.w,
        h: def.defaultSize.h,
        minW: def.minSize.w,
        minH: def.minSize.h,
        createdAt: stamp,
    };
}

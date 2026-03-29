import Dexie, { type EntityTable } from "dexie";
import type { LayoutItem } from "react-grid-layout";

export type LayoutRecord = {
    id: string; // always 'main'
    items: LayoutItem[];
};

export type WidgetStateRecord = {
    id: string;
    symbol: string;
    interval?: string;
};

export type ChartStateRecord = {
    widget_id: string;
    timeScale: { from: number; to: number } | null;
};

export type ScreenRecord = {
    id: string;
    name: string;
    order: number;
    createdAt: number;
};

export type WidgetRecord = {
    id: string;
    screenId: string;
    type: string;
    x: number;
    y: number;
    w: number;
    h: number;
    minW: number;
    minH: number;
    createdAt: number;
};

export type UiStateRecord = {
    id: "active-screen";
    activeScreenId: string;
};

const db = new Dexie("lima") as Dexie & {
    widgetState: EntityTable<WidgetStateRecord, "id">;
    chartState: EntityTable<ChartStateRecord, "widget_id">;
    screens: EntityTable<ScreenRecord, "id">;
    widgets: EntityTable<WidgetRecord, "id">;
    uiState: EntityTable<UiStateRecord, "id">;
};

// v1-v7: legacy migrations retained so existing users keep their data
db.version(1).stores({ layout: "id", ohlcData: "symbol" });
db.version(2).stores({ layout: "id", ohlcData: null, ohlc: "id" });
db.version(3).stores({ layout: "id", ohlc: "id", widgetState: "id" });
db.version(4)
    .stores({ layout: "id", widgetState: "id" })
    .upgrade((tx) => tx.table("ohlc").clear());
db.version(5).stores({
    layout: "id",
    ohlc: "id",
    widgetState: "id",
    symbolsList: "id",
});
db.version(6).stores({
    layout: "id",
    ohlc: null,
    widgetState: "id",
    symbolsList: null,
});
db.version(7).stores({
    layout: "id",
    widgetState: "id",
    chartState: "widget_id",
});

// v8: current — modular layout model with screens + widgets + ui state
db.version(8).stores({
    layout: null,
    widgetState: "id",
    chartState: "widget_id",
    screens: "id, createdAt",
    widgets: "id, screenId, type, createdAt",
    uiState: "id",
});

// v9: add explicit screen ordering for palette-based reorder flows
db.version(9)
    .stores({
        layout: null,
        widgetState: "id",
        chartState: "widget_id",
        screens: "id, order, createdAt",
        widgets: "id, screenId, type, createdAt",
        uiState: "id",
    })
    .upgrade(async (tx) => {
        const screens = await tx
            .table("screens")
            .toCollection()
            .sortBy("createdAt");
        await Promise.all(
            screens.map((screen, index) =>
                tx.table("screens").update(screen.id, { order: index }),
            ),
        );
    });

export { db };

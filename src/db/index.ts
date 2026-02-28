import Dexie, { type EntityTable } from "dexie";
import type { LayoutItem } from "react-grid-layout";
export type LayoutRecord = {
    id: string; // always 'main'
    items: LayoutItem[];
};

export type WidgetStateRecord = {
    id: string; // widget key, e.g. 'stock-chart-0'
    symbol: string;
    interval: string; // Interval — stored as string to keep db layer agnostic
};

export type ChartStateRecord = {
    widget_id: string;
    timeScale: { from: any; to: any } | null;
};

const db = new Dexie("lima") as Dexie & {
    layout: EntityTable<LayoutRecord, "id">;
    widgetState: EntityTable<WidgetStateRecord, "id">;
    chartState: EntityTable<ChartStateRecord, "widget_id">;
};

db.version(1).stores({
    layout: "id",
    ohlcData: "symbol",
});

db.version(2).stores({
    layout: "id",
    ohlcData: null, // drop old table
    ohlc: "id",
});

db.version(3).stores({
    layout: "id",
    ohlc: "id",
    widgetState: "id",
});

// v4: clear ohlc cache to pick up corrected yahooRange values and bar filtering
db.version(4)
    .stores({
        layout: "id",
        widgetState: "id",
    })
    .upgrade((tx) => tx.table("ohlc").clear());

// v5: add symbolsList table (legacy)
db.version(5).stores({
    layout: "id",
    ohlc: "id",
    widgetState: "id",
    symbolsList: "id",
});

// v6: remove data caches; keep only layout + widget state
db.version(6).stores({
    layout: "id",
    ohlc: null,
    widgetState: "id",
    symbolsList: null,
});

// v7: add chart state persistence for zoom/pan
db.version(7).stores({
    layout: "id",
    widgetState: "id",
    chartState: "widget_id",
});

export { db };

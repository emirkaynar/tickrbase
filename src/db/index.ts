import Dexie, { type EntityTable } from "dexie";
import type { LayoutItem } from "react-grid-layout";
import type { Bar } from "../data/types";

export type { Bar };

export type LayoutRecord = {
    id: string; // always 'main'
    items: LayoutItem[];
};

// Compound key: 'SYMBOL|interval' e.g. 'ASELS.IS|1d', 'THYAO.IS|5m'
export type OhlcRecord = {
    id: string;
    bars: Bar[];
    fetchedAt: number;
};

export type WidgetStateRecord = {
    id: string; // widget key, e.g. 'stock-chart-0'
    symbol: string;
    interval: string; // Interval — stored as string to keep db layer agnostic
};

export type SymbolsRecord = {
    id: string; // always "bist"
    items: { label: string; value: string }[];
    fetchedAt: number;
};

const db = new Dexie("lima") as Dexie & {
    layout: EntityTable<LayoutRecord, "id">;
    ohlc: EntityTable<OhlcRecord, "id">;
    widgetState: EntityTable<WidgetStateRecord, "id">;
    symbolsList: EntityTable<SymbolsRecord, "id">;
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
        ohlc: "id",
        widgetState: "id",
    })
    .upgrade((tx) => tx.table("ohlc").clear());

// v5: add symbolsList table (additive — no data migration needed)
db.version(5).stores({
    layout: "id",
    ohlc: "id",
    widgetState: "id",
    symbolsList: "id",
});

export { db };

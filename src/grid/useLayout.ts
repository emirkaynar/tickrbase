import { useEffect, useState, useCallback } from "preact/hooks";
import type { Layout, LayoutItem } from "react-grid-layout";
import { db } from "../db";
import { updateWatchlist } from "../services/watchlist";
import { useDebounce } from "../hooks/useDebounce";
import {
    createWidgetInstance,
    type WidgetInstance,
    type WidgetType,
} from "../widgets/registry";

const ACTIVE_SCREEN_KEY = "active-screen" as const;

const ALL_HANDLES: LayoutItem["resizeHandles"] = [
    "s",
    "w",
    "e",
    "n",
    "sw",
    "nw",
    "se",
    "ne",
];

function withHandles(items: LayoutItem[]): LayoutItem[] {
    return items.map((item) =>
        item.resizeHandles ? item : { ...item, resizeHandles: ALL_HANDLES },
    );
}

async function ensureDefaultScreen(): Promise<{ id: string; name: string }> {
    const screenId = `screen-${Date.now()}`;
    const screen = { id: screenId, name: "Screen 1", createdAt: Date.now() };
    await db.screens.add(screen);
    await db.uiState.put({ id: ACTIVE_SCREEN_KEY, activeScreenId: screenId });
    return { id: screen.id, name: screen.name };
}

export function useLayout() {
    const [screens, setScreens] = useState<{ id: string; name: string }[]>([]);
    const [activeScreenId, setActiveScreenId] = useState("");
    const [widgets, setWidgets] = useState<WidgetInstance[]>([]);
    const [ready, setReady] = useState(false);

    const refreshWidgets = useCallback(async (screenId: string) => {
        const records = await db.widgets
            .where("screenId")
            .equals(screenId)
            .sortBy("createdAt");
        setWidgets(records as WidgetInstance[]);
    }, []);

    // Initial load
    useEffect(() => {
        void (async () => {
            let screenRecords = await db.screens.orderBy("createdAt").toArray();
            if (screenRecords.length === 0) {
                const created = await ensureDefaultScreen();
                screenRecords = [
                    {
                        id: created.id,
                        name: created.name,
                        createdAt: Date.now(),
                    },
                ];
            }

            const uiState = await db.uiState.get(ACTIVE_SCREEN_KEY);
            const nextActive =
                uiState?.activeScreenId &&
                screenRecords.some((s) => s.id === uiState.activeScreenId)
                    ? uiState.activeScreenId
                    : screenRecords[0].id;

            await db.uiState.put({
                id: ACTIVE_SCREEN_KEY,
                activeScreenId: nextActive,
            });
            setScreens(screenRecords.map((s) => ({ id: s.id, name: s.name })));
            setActiveScreenId(nextActive);
            await refreshWidgets(nextActive);
            setReady(true);
        })();
    }, [refreshWidgets]);

    const persistLayout = useDebounce(
        useCallback((items: Layout) => {
            void Promise.all(
                items.map((item) =>
                    db.widgets.update(item.i, {
                        x: item.x,
                        y: item.y,
                        w: item.w,
                        h: item.h,
                    }),
                ),
            );
        }, []),
        500,
    );

    const onLayoutChange = useCallback(
        (items: Layout) => {
            if (!activeScreenId) return;
            setWidgets((prev) =>
                prev.map((widget) => {
                    const match = items.find((item) => item.i === widget.id);
                    return match
                        ? {
                              ...widget,
                              x: match.x,
                              y: match.y,
                              w: match.w,
                              h: match.h,
                          }
                        : widget;
                }),
            );
            persistLayout(items);
        },
        [activeScreenId, persistLayout],
    );

    const layout = withHandles(
        widgets.map((w) => ({
            i: w.id,
            x: w.x,
            y: w.y,
            w: w.w,
            h: w.h,
            minW: w.minW,
            minH: w.minH,
        })),
    );

    const setActiveScreen = useCallback(
        async (screenId: string) => {
            if (screenId === activeScreenId) return;
            await db.uiState.put({
                id: ACTIVE_SCREEN_KEY,
                activeScreenId: screenId,
            });
            setActiveScreenId(screenId);
            await refreshWidgets(screenId);
        },
        [activeScreenId, refreshWidgets],
    );

    const createScreen = useCallback(async () => {
        const nextNumber = screens.length + 1;
        const now = Date.now();
        const screenId = `screen-${now}`;
        await db.screens.add({
            id: screenId,
            name: `Screen ${nextNumber}`,
            createdAt: now,
        });
        const next = [
            ...screens,
            { id: screenId, name: `Screen ${nextNumber}` },
        ];
        setScreens(next);
        await setActiveScreen(screenId);
    }, [screens, setActiveScreen]);

    const renameActiveScreen = useCallback(
        async (name: string) => {
            const trimmed = name.trim();
            if (!trimmed || !activeScreenId) return;
            await db.screens.update(activeScreenId, { name: trimmed });
            setScreens((prev) =>
                prev.map((s) =>
                    s.id === activeScreenId ? { ...s, name: trimmed } : s,
                ),
            );
        },
        [activeScreenId],
    );

    const addWidget = useCallback(
        async (type: WidgetType) => {
            if (!activeScreenId) return;
            const record = createWidgetInstance(activeScreenId, type);
            await db.widgets.add(record);
            setWidgets((prev) => [...prev, record]);

            // Register with watchlist — best effort
            void updateWatchlist([
                { ticker: "ASELS.IS", interval: "1d" },
            ]).catch(() => {});
        },
        [activeScreenId],
    );

    const removeWidget = useCallback(async (id: string) => {
        await db.widgets.delete(id);
        setWidgets((prev) => prev.filter((w) => w.id !== id));
    }, []);

    return {
        screens,
        activeScreenId,
        widgets,
        layout,
        onLayoutChange,
        setActiveScreen,
        createScreen,
        renameActiveScreen,
        addWidget,
        removeWidget,
        ready,
    } as const;
}

export type UseLayoutReturn = ReturnType<typeof useLayout>;

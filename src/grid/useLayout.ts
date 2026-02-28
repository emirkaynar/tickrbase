import { useEffect, useRef, useState } from "preact/hooks";
import type { Layout, LayoutItem } from "react-grid-layout";
import { db } from "../db";
import {
    createWidgetInstance,
    type WidgetInstance,
    type WidgetType,
} from "../widgets/registry";

const ACTIVE_SCREEN_KEY = "active-screen";

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

// Ensure every loaded item has resizeHandles (items saved before this feature won't)
function withHandles(items: LayoutItem[]): LayoutItem[] {
    return items.map((item) =>
        item.resizeHandles ? item : { ...item, resizeHandles: ALL_HANDLES },
    );
}

// Simple debounce — avoids IndexedDB writes on every px drag
function debounce<T extends unknown[]>(
    fn: (...args: T) => void,
    delay: number,
) {
    let timer: ReturnType<typeof setTimeout>;
    return (...args: T) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

export function useLayout() {
    const [screens, setScreens] = useState<{ id: string; name: string }[]>([]);
    const [activeScreenId, setActiveScreenId] = useState<string>("");
    const [widgets, setWidgets] = useState<WidgetInstance[]>([]);
    const [ready, setReady] = useState(false);

    const refreshWidgets = async (screenId: string) => {
        const records = await db.widgets
            .where("screenId")
            .equals(screenId)
            .sortBy("createdAt");
        setWidgets(records as WidgetInstance[]);
    };

    const ensureDefaultScreen = async (): Promise<{
        id: string;
        name: string;
    }> => {
        const screenId = `screen-${Date.now()}`;
        const screen = {
            id: screenId,
            name: "Screen 1",
            createdAt: Date.now(),
        };

        await db.screens.add(screen);
        await db.uiState.put({
            id: ACTIVE_SCREEN_KEY,
            activeScreenId: screenId,
        });
        return { id: screen.id, name: screen.name };
    };

    useEffect(() => {
        (async () => {
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
    }, []);

    const persist = useRef(
        debounce((items: Layout) => {
            const updates = items.map((item) =>
                db.widgets.update(item.i, {
                    x: item.x,
                    y: item.y,
                    w: item.w,
                    h: item.h,
                    minW: item.minW,
                    minH: item.minH,
                }),
            );

            void Promise.all(updates);
        }, 500),
    );

    const onLayoutChange = (items: Layout) => {
        if (!activeScreenId) return;
        const nextWidgets = widgets.map((widget) => {
            const match = items.find((item) => item.i === widget.id);
            if (!match) return widget;
            return {
                ...widget,
                x: match.x,
                y: match.y,
                w: match.w,
                h: match.h,
                minW: match.minW ?? widget.minW,
                minH: match.minH ?? widget.minH,
            };
        });

        setWidgets(nextWidgets);
        persist.current(items);
    };

    const layout = withHandles(
        widgets.map((widget) => ({
            i: widget.id,
            x: widget.x,
            y: widget.y,
            w: widget.w,
            h: widget.h,
            minW: widget.minW,
            minH: widget.minH,
        })),
    );

    const setActiveScreen = async (screenId: string) => {
        if (screenId === activeScreenId) return;
        await db.uiState.put({
            id: ACTIVE_SCREEN_KEY,
            activeScreenId: screenId,
        });
        setActiveScreenId(screenId);
        await refreshWidgets(screenId);
    };

    const createScreen = async () => {
        const nextNumber = screens.length + 1;
        const now = Date.now();
        const screenId = `screen-${now}`;
        const record = {
            id: screenId,
            name: `Screen ${nextNumber}`,
            createdAt: now,
        };

        await db.screens.add(record);
        const nextScreens = [...screens, { id: record.id, name: record.name }];
        setScreens(nextScreens);
        await setActiveScreen(screenId);
    };

    const renameActiveScreen = async (name: string) => {
        const trimmed = name.trim();
        if (!trimmed || !activeScreenId) return;
        await db.screens.update(activeScreenId, { name: trimmed });
        setScreens((prev) =>
            prev.map((screen) =>
                screen.id === activeScreenId
                    ? { ...screen, name: trimmed }
                    : screen,
            ),
        );
    };

    const addWidget = async (type: WidgetType) => {
        if (!activeScreenId) return;
        const record = createWidgetInstance(activeScreenId, type);
        await db.widgets.add(record);
        setWidgets((prev) => [...prev, record]);
    };

    const removeWidget = async (id: string) => {
        await db.widgets.delete(id);
        setWidgets((prev) => prev.filter((widget) => widget.id !== id));
    };

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

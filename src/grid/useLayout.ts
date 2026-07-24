import { useEffect, useState, useCallback, useRef } from "preact/hooks";
import type { Layout, LayoutItem } from "react-grid-layout";
import { api } from "../services/api";
import { useDebounce } from "../hooks/useDebounce";
import {
    createWidgetInstance,
    getWidgetDefinition,
    type WidgetInstance,
    type WidgetType,
} from "../widgets/registry";
import { calculateGridConstraints, findFittingSize } from "./constraints";

import { prefetchSettings } from "../services/settings";

export type ScreenItem = { id: string; name: string; order: number; createdAt: number };

export type BackendLayoutPayload = {
    screens: ScreenItem[];
    activeScreenId: string;
    widgets: WidgetInstance[];
};

const widgetStateCache = new Map<string, any>();

export function getWidgetStateFromCache(widgetId: string): any {
    if (widgetStateCache.has(widgetId)) {
        const val = widgetStateCache.get(widgetId);
        widgetStateCache.delete(widgetId);
        return val;
    }
    return undefined;
}

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

function defaultScreenNameFrom(records: { name: string }[]): string {
    const max = records.reduce((acc, rec) => {
        const m = rec.name.match(/^Screen\s+(\d+)$/i);
        if (!m) return acc;
        return Math.max(acc, Number(m[1]));
    }, 0);
    return `Screen ${max + 1}`;
}

export function useLayout(isAuthenticated: boolean = true) {
    const [screens, setScreens] = useState<ScreenItem[]>([]);
    const [activeScreenId, setActiveScreenId] = useState("");
    const [allWidgets, setAllWidgets] = useState<WidgetInstance[]>([]);
    const [ready, setReady] = useState(false);

    // Keep ref for current state to avoid stale closure during debounced save
    const stateRef = useRef({ screens, activeScreenId, allWidgets });
    stateRef.current = { screens, activeScreenId, allWidgets };

    // Initial load from backend API
    const loadLayout = useCallback(async () => {
        try {
            const data = await api.get<BackendLayoutPayload>("/user/layout");
            setScreens(data.screens || []);
            setActiveScreenId(data.activeScreenId || (data.screens && data.screens[0]?.id) || "");
            const normalizedWidgets = (data.widgets || []).map((w) => {
                const wClamped = Math.min(w.w || 6, 24);
                const hClamped = Math.min(w.h || 24, 24);
                return {
                    ...w,
                    w: wClamped,
                    h: hClamped,
                    x: Math.min(w.x || 0, Math.max(0, 24 - wClamped)),
                    y: Math.min(w.y || 0, Math.max(0, 24 - hClamped)),
                };
            });
            setAllWidgets(normalizedWidgets);
            setReady(true);

            // Parallel prefetch widget states and user settings
            const widgetIds = normalizedWidgets.map((w) => w.id);
            void Promise.all([
                prefetchSettings(),
                ...widgetIds.map(async (wId) => {
                    try {
                        const saved = await api.get<any>(`/user/widgets/${wId}/state`);
                        if (saved) {
                            widgetStateCache.set(wId, saved);
                        }
                    } catch {
                        // ignore prefetch errors
                    }
                }),
            ]);
        } catch (err) {
            console.error("Failed to load layout from backend:", err);
            setReady(true);
        }
    }, []);

    useEffect(() => {
        if (!isAuthenticated) {
            setScreens([]);
            setActiveScreenId("");
            setAllWidgets([]);
            setReady(false);
            return;
        }
        void loadLayout();
    }, [isAuthenticated, loadLayout]);

    // Save full layout to backend
    const saveLayoutToBackend = useCallback(async (
        nextScreens: ScreenItem[],
        nextActiveId: string,
        nextWidgets: WidgetInstance[]
    ) => {
        try {
            await api.put("/user/layout", {
                screens: nextScreens,
                activeScreenId: nextActiveId,
                widgets: nextWidgets,
            });
        } catch (err) {
            console.error("Failed to save layout to backend:", err);
        }
    }, []);

    const debouncedSave = useDebounce(saveLayoutToBackend, 600);

    // Get widgets for active screen
    const activeWidgets = allWidgets.filter((w) => w.screenId === activeScreenId);

    const onLayoutChange = useCallback(
        (items: Layout) => {
            if (!activeScreenId) return;

            setAllWidgets((prevWidgets) => {
                const updatedWidgets = prevWidgets.map((widget) => {
                    if (widget.screenId !== activeScreenId) return widget;
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
                });

                debouncedSave(stateRef.current.screens, stateRef.current.activeScreenId, updatedWidgets);
                return updatedWidgets;
            });
        },
        [activeScreenId, debouncedSave],
    );

    const layout = withHandles(
        activeWidgets.map((w) => ({
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
            setActiveScreenId(screenId);
            void saveLayoutToBackend(screens, screenId, allWidgets);
        },
        [activeScreenId, screens, allWidgets, saveLayoutToBackend],
    );

    const createScreen = useCallback(
        async (name?: string) => {
            const resolved = name?.trim() || defaultScreenNameFrom(screens);
            const now = Date.now();
            const screenId = `screen-${now}`;
            const newScreen: ScreenItem = {
                id: screenId,
                name: resolved,
                order: screens.length,
                createdAt: now,
            };

            const nextScreens = [...screens, newScreen];
            setScreens(nextScreens);
            setActiveScreenId(screenId);
            void saveLayoutToBackend(nextScreens, screenId, allWidgets);
        },
        [screens, allWidgets, saveLayoutToBackend],
    );

    const renameScreen = useCallback(
        async (screenId: string, name: string) => {
            const trimmed = name.trim();
            if (!trimmed) return;
            const nextScreens = screens.map((s) => (s.id === screenId ? { ...s, name: trimmed } : s));
            setScreens(nextScreens);
            void saveLayoutToBackend(nextScreens, activeScreenId, allWidgets);
        },
        [screens, activeScreenId, allWidgets, saveLayoutToBackend],
    );

    const renameActiveScreen = useCallback(
        async (name: string) => {
            if (!activeScreenId) return;
            await renameScreen(activeScreenId, name);
        },
        [activeScreenId, renameScreen],
    );

    const deleteScreen = useCallback(
        async (screenId: string): Promise<boolean> => {
            if (screens.length <= 1) return false;

            const idx = screens.findIndex((s) => s.id === screenId);
            if (idx < 0) return false;

            const survivor = screens.filter((s) => s.id !== screenId).map((s, i) => ({ ...s, order: i }));
            const remainingWidgets = allWidgets.filter((w) => w.screenId !== screenId);

            const nextActiveId = activeScreenId === screenId
                ? (survivor[Math.min(idx, survivor.length - 1)] ?? survivor[0]).id
                : activeScreenId;

            setScreens(survivor);
            setActiveScreenId(nextActiveId);
            setAllWidgets(remainingWidgets);
            void saveLayoutToBackend(survivor, nextActiveId, remainingWidgets);

            return true;
        },
        [screens, activeScreenId, allWidgets, saveLayoutToBackend],
    );

    const reorderScreens = useCallback(
        async (nextIds: string[]) => {
            if (nextIds.length <= 1) return;

            const idMap = new Map(nextIds.map((id, index) => [id, index]));
            const nextScreens = [...screens]
                .map((s) => ({ ...s, order: idMap.get(s.id) ?? s.order }))
                .sort((a, b) => a.order - b.order);

            setScreens(nextScreens);
            void saveLayoutToBackend(nextScreens, activeScreenId, allWidgets);
        },
        [screens, activeScreenId, allWidgets, saveLayoutToBackend],
    );

    const moveScreen = useCallback(
        async (screenId: string, direction: -1 | 1) => {
            const idx = screens.findIndex((s) => s.id === screenId);
            if (idx < 0) return;
            const nextIndex = idx + direction;
            if (nextIndex < 0 || nextIndex >= screens.length) return;

            const ids = screens.map((s) => s.id);
            const [moved] = ids.splice(idx, 1);
            ids.splice(nextIndex, 0, moved);
            await reorderScreens(ids);
        },
        [screens, reorderScreens],
    );

    const addWidget = useCallback(
        async (
            type: WidgetType,
        ): Promise<{ success: boolean; noSpace?: boolean }> => {
            if (!activeScreenId) return { success: false };

            const def = getWidgetDefinition(type);
            const constraints = calculateGridConstraints(window.innerHeight);

            const fitting = findFittingSize(
                activeWidgets,
                def.defaultSize,
                def.minSize,
                constraints,
            );

            if (!fitting) {
                return { success: false, noSpace: true };
            }

            const record = createWidgetInstance(activeScreenId, type, {
                x: fitting.position.x,
                y: fitting.position.y,
                w: fitting.size.w,
                h: fitting.size.h,
            });

            const nextWidgets = [...allWidgets, record];
            setAllWidgets(nextWidgets);
            void saveLayoutToBackend(screens, activeScreenId, nextWidgets);

            return { success: true };
        },
        [activeScreenId, activeWidgets, allWidgets, screens, saveLayoutToBackend],
    );

    const removeWidget = useCallback(
        async (id: string) => {
            const nextWidgets = allWidgets.filter((w) => w.id !== id);
            setAllWidgets(nextWidgets);
            void saveLayoutToBackend(screens, activeScreenId, nextWidgets);
        },
        [allWidgets, screens, activeScreenId, saveLayoutToBackend],
    );

    return {
        screens,
        activeScreenId,
        widgets: activeWidgets,
        layout,
        onLayoutChange,
        setActiveScreen,
        createScreen,
        renameScreen,
        renameActiveScreen,
        deleteScreen,
        reorderScreens,
        moveScreen,
        addWidget,
        removeWidget,
        ready,
    } as const;
}

export type UseLayoutReturn = ReturnType<typeof useLayout>;

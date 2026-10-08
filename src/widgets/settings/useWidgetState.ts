import { useEffect, useMemo } from "preact/hooks";
import { useSyncExternalStore } from "preact/compat";
import { getWidgetCacheToken } from "../widgetCache";
import { getWidgetStateStore } from "./widgetStateStore";

export function useWidgetState(id: string) {
    const token = getWidgetCacheToken(id);
    const store = useMemo(() => getWidgetStateStore(id), [id, token]);
    const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
    useEffect(() => { void store.load(); }, [store]);
    return { ...snapshot, update: store.update, retry: store.retry };
}

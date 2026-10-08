type CacheName = "prefetchedState" | "consumedState" | "chartData" | "chartBars" | "loadedCharts";
type WidgetCache = Map<string, unknown> | Set<string>;
export type WidgetCacheToken = object | undefined;

const caches = new Map<CacheName, WidgetCache>();
const activeWidgets = new Map<string, object>();
let sessionToken = {};

export function registerWidgetCache<T extends WidgetCache>(name: CacheName, cache: T): T {
    const previous = caches.get(name);
    if (previous !== cache) previous?.clear();
    caches.set(name, cache);
    return cache;
}

const prefetchedState = registerWidgetCache("prefetchedState", new Map<string, unknown>());
const consumedState = registerWidgetCache("consumedState", new Set<string>());

export function activateWidgetCache(id: string): void {
    if (!activeWidgets.has(id)) activeWidgets.set(id, {});
}

export function removeWidgetCaches(id: string): void {
    activeWidgets.delete(id);
    for (const cache of caches.values()) cache.delete(id);
}

export function clearWidgetCaches(): void {
    sessionToken = {};
    activeWidgets.clear();
    for (const cache of caches.values()) cache.clear();
}

export function syncWidgetCacheIds(ids: Iterable<string>): void {
    const surviving = new Set(ids);
    for (const id of activeWidgets.keys()) {
        if (!surviving.has(id)) removeWidgetCaches(id);
    }
    for (const id of surviving) activateWidgetCache(id);
}

export function getWidgetCacheSessionToken(): object {
    return sessionToken;
}

export function isWidgetCacheSessionCurrent(token: object): boolean {
    return token === sessionToken;
}

export function getWidgetCacheToken(id: string): WidgetCacheToken {
    return activeWidgets.get(id);
}

// A token identifies this widget's lifetime, including its authenticated session.
export function isWidgetCacheCurrent(id: string, token: WidgetCacheToken): boolean {
    return token !== undefined && activeWidgets.get(id) === token;
}

export function cacheWidgetState(id: string, state: unknown, token: WidgetCacheToken): boolean {
    if (!isWidgetCacheCurrent(id, token) || consumedState.has(id)) return false;
    prefetchedState.set(id, state);
    return true;
}

export function getWidgetStateFromCache(id: string): any {
    if (activeWidgets.has(id)) consumedState.add(id);
    const state = prefetchedState.get(id);
    prefetchedState.delete(id);
    return state;
}

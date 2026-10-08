import { api } from "../../services/api";
import {
    getWidgetCacheToken, getWidgetStateFromCache, isWidgetCacheCurrent, registerWidgetCache,
    type WidgetCacheToken,
} from "../widgetCache";
import type { WidgetSettingsProps } from "./types";

export type WidgetStateDocument = {
    symbol: string | null;
    interval: string | null;
    state: Record<string, unknown>;
};
export type WidgetStateSnapshot = {
    document: WidgetStateDocument;
    ready: boolean;
    status: WidgetSettingsProps["status"];
    error: string | null;
};

export function stateRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}

function normalize(value: unknown): WidgetStateDocument {
    const saved = stateRecord(value);
    return {
        symbol: typeof saved.symbol === "string" ? saved.symbol : null,
        interval: typeof saved.interval === "string" ? saved.interval : null,
        state: { ...stateRecord(saved.state) },
    };
}

class WidgetStateStore {
    private snapshot: WidgetStateSnapshot = {
        document: normalize(null), ready: false, status: "loading", error: null,
    };
    private listeners = new Set<() => void>();
    private loading: Promise<void> | null = null;
    private saving: Promise<void> | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private controller = new AbortController();
    private revision = 0;
    private savedRevision = 0;
    private disposed = false;

    constructor(privateId: string, token: WidgetCacheToken) {
        this.id = privateId;
        this.token = token;
    }
    private id: string;
    private token: WidgetCacheToken;
    private active = () => !this.disposed && isWidgetCacheCurrent(this.id, this.token);
    getSnapshot = () => this.snapshot;
    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };
    private publish(next: Partial<WidgetStateSnapshot>) {
        if (!this.active()) return;
        this.snapshot = { ...this.snapshot, ...next };
        for (const listener of this.listeners) listener();
    }

    load = (): Promise<void> => {
        if (!this.active() || this.snapshot.ready) return Promise.resolve();
        if (this.loading) return this.loading;
        this.publish({ status: "loading", error: null });
        this.loading = this.loadDocument().finally(() => { this.loading = null; });
        return this.loading;
    };
    private async loadDocument() {
        try {
            const cached = getWidgetStateFromCache(this.id);
            const saved = cached !== undefined ? cached
                : await api.get<unknown>(`/user/widgets/${this.id}/state`, this.controller.signal);
            this.publish({ document: normalize(saved), ready: true, status: "ready", error: null });
        } catch (error) {
            this.publish({ ready: false, status: "error", error: this.message(error, "load") });
        }
    }

    update = (change: (document: WidgetStateDocument) => WidgetStateDocument): void => {
        if (!this.active() || !this.snapshot.ready) return;
        const document = change(this.snapshot.document);
        if (JSON.stringify(document) === JSON.stringify(this.snapshot.document)) return;
        this.revision++;
        this.publish({ document, status: this.saving ? "saving" : "unsaved", error: null });
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 250);
    };

    private flush = (): Promise<void> => {
        if (!this.active() || !this.snapshot.ready || this.revision === this.savedRevision) return Promise.resolve();
        if (this.saving) return this.saving;
        if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
        this.saving = this.saveDocument().finally(() => { this.saving = null; });
        return this.saving;
    };
    private async saveDocument() {
        // One writer per instance: later changes wait for the complete earlier PUT/retry chain.
        while (this.active() && this.savedRevision !== this.revision) {
            const revision = this.revision;
            const document = this.snapshot.document;
            this.publish({ status: "saving", error: null });
            try {
                await api.put(`/user/widgets/${this.id}/state`, document, this.controller.signal);
                if (!this.active()) return;
                this.savedRevision = revision;
            } catch (error) {
                this.publish({ status: "error", error: this.message(error, "save") });
                return;
            }
        }
        this.publish({ status: "ready", error: null });
    }
    retry = (): Promise<void> => this.snapshot.ready ? this.flush() : this.load();
    private message(error: unknown, operation: string) {
        return `Could not ${operation} widget settings.${error instanceof Error && error.message ? ` ${error.message}` : " Please try again."}`;
    }
    dispose() {
        this.disposed = true;
        if (this.timer !== null) clearTimeout(this.timer);
        this.controller.abort();
        this.listeners.clear();
    }
}

// Remounts share the owner; permanent removal/logout cancels queued work instead.
class WidgetStateStores extends Map<string, WidgetStateStore> {
    override delete(id: string) {
        this.get(id)?.dispose();
        return super.delete(id);
    }
    override clear() {
        for (const store of this.values()) store.dispose();
        super.clear();
    }
}
const stores = registerWidgetCache("widgetState", new WidgetStateStores());
export function getWidgetStateStore(id: string): WidgetStateStore {
    let store = stores.get(id);
    if (!store) {
        store = new WidgetStateStore(id, getWidgetCacheToken(id));
        stores.set(id, store);
    }
    return store;
}

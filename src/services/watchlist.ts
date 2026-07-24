import { api } from "./api";
import type {
    ListDeleteResponse,
    ListItem,
    ListItemsResponse,
    ListRecord,
    ListRowState,
    ListsResponse,
    OkResponse,
} from "./types";

export type WatchlistBackendSchema = {
    id: string;
    name: string;
    order: number;
    items: string[];
    rowState?: {
        rowOrder?: string[];
        spacers?: any[];
    } | null;
    createdAt: number;
    updatedAt: number;
};

const DEFAULT_LIST_ID = "list:default";
// const DEFAULT_LIST_NAME = "Watchlist";

function createListId(): string {
    return `list:${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

function normalizeTicker(ticker: string): string {
    return ticker.trim().toUpperCase();
}

function normalizeListName(name: string): string {
    return name.trim().replace(/\s+/g, " ");
}

export async function fetchLists(
    signal?: AbortSignal,
): Promise<ListsResponse> {
    const lists = await api.get<WatchlistBackendSchema[]>("/user/watchlists", signal);
    return lists.map((l) => ({
        id: l.id,
        name: l.name,
        order: l.order,
        createdAt: l.createdAt,
        updatedAt: l.updatedAt,
    }));
}

export async function createList(
    name: string,
    signal?: AbortSignal,
): Promise<ListRecord> {
    const normalizedName = normalizeListName(name);

    if (!normalizedName) {
        throw new Error("List name cannot be empty.");
    }

    if (normalizedName.length > 32) {
        throw new Error("List name must be 32 characters or less.");
    }

    const currentLists = await api.get<WatchlistBackendSchema[]>("/user/watchlists", signal);
    if (currentLists.some((l) => l.name.toLowerCase() === normalizedName.toLowerCase())) {
        throw new Error("A list with this name already exists.");
    }

    const newId = createListId();
    const payload = {
        name: normalizedName,
        order: currentLists.length,
        items: [],
        rowState: null,
    };

    const created = await api.post<WatchlistBackendSchema>(`/user/watchlists/${newId}`, payload, signal);
    return {
        id: created.id,
        name: created.name,
        order: created.order,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
    };
}

export async function deleteList(
    listId: string,
    signal?: AbortSignal,
): Promise<ListDeleteResponse> {
    const lists = await api.get<WatchlistBackendSchema[]>("/user/watchlists", signal);
    const index = lists.findIndex((l) => l.id === listId);

    if (index < 0) {
        const fallback = lists[0] ?? { id: DEFAULT_LIST_ID };
        return {
            ok: false,
            deleted: false,
            activeListId: fallback.id,
            reason: "not-found",
        };
    }

    if (lists.length <= 1) {
        return {
            ok: false,
            deleted: false,
            activeListId: lists[0].id,
            reason: "last-list",
        };
    }

    await api.delete(`/user/watchlists/${listId}`, signal);
    const remaining = lists.filter((l) => l.id !== listId);
    const nextActive = remaining[Math.min(index, remaining.length - 1)] ?? remaining[0];

    return {
        ok: true,
        deleted: true,
        activeListId: nextActive.id,
    };
}

export async function fetchListItems(
    listId: string,
    signal?: AbortSignal,
): Promise<ListItemsResponse> {
    const lists = await api.get<WatchlistBackendSchema[]>("/user/watchlists", signal);
    const target = lists.find((l) => l.id === listId);
    if (!target) return [];
    return target.items.map((ticker) => ({ ticker }));
}

export async function addSymbolsToList(
    listId: string,
    items: ListItem[],
    signal?: AbortSignal,
): Promise<OkResponse> {
    if (items.length === 0) return { ok: true };

    const lists = await api.get<WatchlistBackendSchema[]>("/user/watchlists", signal);
    const target = lists.find((l) => l.id === listId);
    if (!target) return { ok: true };

    const newTickers = items.map((i) => normalizeTicker(i.ticker)).filter(Boolean);
    const updatedItems = Array.from(new Set([...target.items, ...newTickers]));

    let updatedRowState = target.rowState;
    if (updatedRowState && Array.isArray(updatedRowState.rowOrder)) {
        const existingOrder = new Set(updatedRowState.rowOrder);
        const addedOrder = newTickers.filter((t) => !existingOrder.has(t));
        if (addedOrder.length > 0) {
            updatedRowState = {
                ...updatedRowState,
                rowOrder: [...updatedRowState.rowOrder, ...addedOrder],
            };
        }
    }

    await api.post(`/user/watchlists/${listId}`, {
        name: target.name,
        order: target.order,
        items: updatedItems,
        rowState: updatedRowState,
    }, signal);

    return { ok: true };
}

export async function addSymbolToList(
    listId: string,
    ticker: string,
    signal?: AbortSignal,
): Promise<OkResponse> {
    return addSymbolsToList(listId, [{ ticker }], signal);
}

export async function removeSymbolFromList(
    listId: string,
    ticker: string,
    signal?: AbortSignal,
): Promise<OkResponse> {
    const normalized = normalizeTicker(ticker);
    if (!normalized) return { ok: true };

    const lists = await api.get<WatchlistBackendSchema[]>("/user/watchlists", signal);
    const target = lists.find((l) => l.id === listId);
    if (!target) return { ok: true };

    const updatedItems = target.items.filter((item) => item !== normalized);

    let updatedRowState = target.rowState;
    if (updatedRowState && Array.isArray(updatedRowState.rowOrder)) {
        updatedRowState = {
            ...updatedRowState,
            rowOrder: updatedRowState.rowOrder.filter((item) => item !== normalized),
        };
    }

    await api.post(`/user/watchlists/${listId}`, {
        name: target.name,
        order: target.order,
        items: updatedItems,
        rowState: updatedRowState,
    }, signal);

    return { ok: true };
}

export async function fetchListRowState(
    listId: string,
    signal?: AbortSignal,
): Promise<ListRowState> {
    const lists = await api.get<WatchlistBackendSchema[]>("/user/watchlists", signal);
    const target = lists.find((l) => l.id === listId);
    return {
        rowOrder: target?.rowState?.rowOrder ?? [],
        spacers: target?.rowState?.spacers ?? [],
    };
}

export async function saveListRowState(
    listId: string,
    state: ListRowState,
    signal?: AbortSignal,
): Promise<OkResponse> {
    const lists = await api.get<WatchlistBackendSchema[]>("/user/watchlists", signal);
    const target = lists.find((l) => l.id === listId);
    if (!target) return { ok: true };

    await api.post(`/user/watchlists/${listId}`, {
        name: target.name,
        order: target.order,
        items: target.items,
        rowState: state,
    }, signal);

    return { ok: true };
}

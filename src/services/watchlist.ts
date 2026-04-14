import type {
    ListDeleteResponse,
    ListItem,
    ListItemsResponse,
    ListRecord,
    ListRowState,
    ListsResponse,
    OkResponse,
} from "./types";
import { db } from "../db";

const DEFAULT_LIST_ID = "list:default";
const DEFAULT_LIST_NAME = "Watchlist";

function createListId(): string {
    return `list:${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

function createListItemId(listId: string, ticker: string): string {
    return `${listId}::${ticker}`;
}

function normalizeTicker(ticker: string): string {
    return ticker.trim().toUpperCase();
}

function normalizeListName(name: string): string {
    return name.trim().replace(/\s+/g, " ");
}

function listNameKey(name: string): string {
    return normalizeListName(name).toLowerCase();
}

function uniqueTickers(items: ListItem[]): string[] {
    const set = new Set<string>();
    for (const item of items) {
        const ticker = normalizeTicker(item.ticker);
        if (!ticker) continue;
        set.add(ticker);
    }
    return Array.from(set);
}

async function ensureDefaultListRecord(): Promise<ListRecord> {
    const ordered = await db.lists.orderBy("order").toArray();
    if (ordered.length > 0) {
        const first = ordered[0];
        return {
            id: first.id,
            name: first.name,
            order: first.order,
            createdAt: first.createdAt,
            updatedAt: first.updatedAt,
        };
    }

    const now = Date.now();
    const record = {
        id: DEFAULT_LIST_ID,
        name: DEFAULT_LIST_NAME,
        nameLower: listNameKey(DEFAULT_LIST_NAME),
        order: 0,
        createdAt: now,
        updatedAt: now,
    };

    await db.lists.put(record);

    return {
        id: record.id,
        name: record.name,
        order: record.order,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

export async function fetchLists(
    _signal?: AbortSignal,
): Promise<ListsResponse> {
    await ensureDefaultListRecord();
    const rows = await db.lists.orderBy("order").toArray();

    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        order: row.order,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }));
}

export async function createList(
    name: string,
    _signal?: AbortSignal,
): Promise<ListRecord> {
    const normalizedName = normalizeListName(name);
    const normalizedKey = listNameKey(name);

    if (!normalizedName) {
        throw new Error("List name cannot be empty.");
    }

    if (normalizedName.length > 32) {
        throw new Error("List name must be 32 characters or less.");
    }

    const created = await db.transaction("rw", db.lists, async () => {
        await ensureDefaultListRecord();

        const existing = await db.lists
            .where("nameLower")
            .equals(normalizedKey)
            .first();
        if (existing) {
            throw new Error("A list with this name already exists.");
        }

        const now = Date.now();
        const order = await db.lists.count();
        const record = {
            id: createListId(),
            name: normalizedName,
            nameLower: normalizedKey,
            order,
            createdAt: now,
            updatedAt: now,
        };

        await db.lists.put(record);
        return record;
    });

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
    _signal?: AbortSignal,
): Promise<ListDeleteResponse> {
    return db.transaction(
        "rw",
        db.lists,
        db.listItems,
        db.tableRowState,
        async () => {
            const lists = await db.lists.orderBy("order").toArray();
            const index = lists.findIndex((list) => list.id === listId);

            if (index < 0) {
                const fallback = lists[0] ?? (await ensureDefaultListRecord());
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

            await db.lists.delete(listId);

            const itemIds = await db.listItems
                .where("listId")
                .equals(listId)
                .primaryKeys();
            await db.listItems.bulkDelete(itemIds);
            await db.tableRowState.delete(listId);

            const remaining = await db.lists.orderBy("order").toArray();
            const now = Date.now();
            await Promise.all(
                remaining.map((list, nextIndex) =>
                    db.lists.update(list.id, {
                        order: nextIndex,
                        updatedAt: now,
                    }),
                ),
            );

            const nextActive =
                remaining[Math.min(index, remaining.length - 1)] ??
                remaining[0];

            return {
                ok: true,
                deleted: true,
                activeListId: nextActive.id,
            };
        },
    );
}

export async function fetchListItems(
    listId: string,
    _signal?: AbortSignal,
): Promise<ListItemsResponse> {
    await ensureDefaultListRecord();
    const rows = await db.listItems.where("listId").equals(listId).toArray();
    rows.sort((a, b) => a.createdAt - b.createdAt);

    return rows.map((row) => ({ ticker: row.ticker }));
}

export async function addSymbolsToList(
    listId: string,
    items: ListItem[],
    _signal?: AbortSignal,
): Promise<OkResponse> {
    if (items.length === 0) return { ok: true };

    const now = Date.now();
    const tickers = uniqueTickers(items);

    await db.transaction("rw", db.listItems, async () => {
        for (const ticker of tickers) {
            const id = createListItemId(listId, ticker);
            const existing = await db.listItems.get(id);
            await db.listItems.put({
                id,
                listId,
                ticker,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
            });
        }
    });

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
    _signal?: AbortSignal,
): Promise<OkResponse> {
    const normalized = normalizeTicker(ticker);
    if (!normalized) return { ok: true };

    await db.listItems.delete(createListItemId(listId, normalized));
    return { ok: true };
}

export async function fetchListRowState(
    listId: string,
    _signal?: AbortSignal,
): Promise<ListRowState> {
    const state = await db.tableRowState.get(listId);
    return {
        rowOrder: state?.rowOrder ?? [],
        spacers: state?.spacers ?? [],
    };
}

export async function saveListRowState(
    listId: string,
    state: ListRowState,
    _signal?: AbortSignal,
): Promise<OkResponse> {
    const now = Date.now();
    const existing = await db.tableRowState.get(listId);

    await db.tableRowState.put({
        id: listId,
        rowOrder: state.rowOrder,
        spacers: state.spacers,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    });

    return { ok: true };
}

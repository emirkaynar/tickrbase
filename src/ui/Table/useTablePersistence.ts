import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "preact/hooks";
import type { ColumnSizingState, SortingState } from "@tanstack/react-table";
import { db, type TablePreferencesRecord } from "../../db";
import { useDebounce } from "../../hooks/useDebounce";
import type { TableScopeType, TableSpacerRow } from "./types";

const SPACER_PREFIX = "spacer:";

function uniqueOrdered(values: string[]): string[] {
    const seen = new Set<string>();
    const next: string[] = [];

    for (const value of values) {
        if (!value || seen.has(value)) continue;
        seen.add(value);
        next.push(value);
    }

    return next;
}

export function isSpacerId(id: string): boolean {
    return id.startsWith(SPACER_PREFIX);
}

export function normalizeSpacerId(id: string): string {
    return isSpacerId(id) ? id : `${SPACER_PREFIX}${id}`;
}

export function createSpacerId(): string {
    return `${SPACER_PREFIX}${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

export function normalizeSpacers(spacers: TableSpacerRow[]): TableSpacerRow[] {
    const seen = new Set<string>();
    const next: TableSpacerRow[] = [];

    for (const spacer of spacers) {
        const id = normalizeSpacerId(spacer.id);
        if (seen.has(id)) continue;
        seen.add(id);
        next.push({
            id,
            label: spacer.label,
            height: spacer.height,
        });
    }

    return next;
}

export function normalizeColumnOrder(
    columnOrder: string[],
    allColumnIds: string[],
): string[] {
    const available = new Set(allColumnIds);
    const ordered = uniqueOrdered(columnOrder).filter((id) =>
        available.has(id),
    );

    for (const id of allColumnIds) {
        if (!ordered.includes(id)) ordered.push(id);
    }

    return ordered;
}

export function normalizeVisibleColumnIds(
    visibleColumnIds: string[],
    allColumnIds: string[],
    lockedColumnIds: string[],
): string[] {
    const available = new Set(allColumnIds);
    const locked = new Set(lockedColumnIds.filter((id) => available.has(id)));
    const visible = uniqueOrdered(visibleColumnIds).filter((id) =>
        available.has(id),
    );

    for (const id of locked) {
        if (!visible.includes(id)) visible.push(id);
    }

    return visible;
}

export function normalizeColumnWidths(
    columnWidths: ColumnSizingState,
    allColumnIds: string[],
): ColumnSizingState {
    const available = new Set(allColumnIds);
    const next: ColumnSizingState = {};

    for (const [id, size] of Object.entries(columnWidths)) {
        if (!available.has(id)) continue;
        if (!Number.isFinite(size) || size <= 0) continue;
        next[id] = size;
    }

    return next;
}

export function normalizeRowOrder(
    rowOrder: string[],
    rowIds: string[],
    spacerIds: string[],
): string[] {
    const available = new Set([...rowIds, ...spacerIds]);
    const next = uniqueOrdered(rowOrder).filter((id) => available.has(id));

    for (const id of rowIds) {
        if (!next.includes(id)) next.push(id);
    }

    for (const id of spacerIds) {
        if (!next.includes(id)) next.push(id);
    }

    return next;
}

export function buildTablePreferenceId(
    scopeType: TableScopeType,
    scopeId: string,
    tableId: string,
): string {
    return `${scopeType}:${scopeId}::${tableId}`;
}

type UseTablePersistenceInput = {
    scopeType: TableScopeType;
    scopeId: string;
    tableId: string;
    allColumnIds: string[];
    lockedColumnIds: string[];
    rowIds: string[];
    initialSpacerRows: TableSpacerRow[];
};

type UseTablePersistenceResult = {
    instanceId: string;
    hydrated: boolean;
    visibleColumnIds: string[];
    setVisibleColumnIds: (
        value: string[] | ((prev: string[]) => string[]),
    ) => void;
    columnOrder: string[];
    setColumnOrder: (value: string[] | ((prev: string[]) => string[])) => void;
    columnWidths: ColumnSizingState;
    setColumnWidths: (
        value:
            | ColumnSizingState
            | ((prev: ColumnSizingState) => ColumnSizingState),
    ) => void;
    rowOrder: string[];
    setRowOrder: (value: string[] | ((prev: string[]) => string[])) => void;
    spacers: TableSpacerRow[];
    setSpacers: (
        value:
            | TableSpacerRow[]
            | ((prev: TableSpacerRow[]) => TableSpacerRow[]),
    ) => void;
    sorting: SortingState;
    setSorting: (
        value: SortingState | ((prev: SortingState) => SortingState),
    ) => void;
    resetToDefaults: () => void;
};

export function useTablePersistence({
    scopeType,
    scopeId,
    tableId,
    allColumnIds,
    lockedColumnIds,
    rowIds,
    initialSpacerRows,
}: UseTablePersistenceInput): UseTablePersistenceResult {
    const instanceId = useMemo(
        () => buildTablePreferenceId(scopeType, scopeId, tableId),
        [scopeType, scopeId, tableId],
    );

    const normalizedInitialSpacers = useMemo(
        () => normalizeSpacers(initialSpacerRows),
        [initialSpacerRows],
    );

    const defaultVisibleColumnIds = useMemo(
        () =>
            normalizeVisibleColumnIds(
                allColumnIds,
                allColumnIds,
                lockedColumnIds,
            ),
        [allColumnIds, lockedColumnIds],
    );

    const defaultColumnOrder = useMemo(
        () => normalizeColumnOrder(allColumnIds, allColumnIds),
        [allColumnIds],
    );

    const defaultRowOrder = useMemo(
        () =>
            normalizeRowOrder(
                [],
                rowIds,
                normalizedInitialSpacers.map((spacer) => spacer.id),
            ),
        [rowIds, normalizedInitialSpacers],
    );

    const [hydrated, setHydrated] = useState(false);
    const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>(
        defaultVisibleColumnIds,
    );
    const [columnOrder, setColumnOrder] =
        useState<string[]>(defaultColumnOrder);
    const [columnWidths, setColumnWidths] = useState<ColumnSizingState>({});
    const [rowOrder, setRowOrder] = useState<string[]>(defaultRowOrder);
    const [spacers, setSpacers] = useState<TableSpacerRow[]>(
        normalizedInitialSpacers,
    );
    const [sorting, setSorting] = useState<SortingState>([]);

    const createdAtRef = useRef<number>(Date.now());

    const resetToDefaults = useCallback(() => {
        setVisibleColumnIds(defaultVisibleColumnIds);
        setColumnOrder(defaultColumnOrder);
        setColumnWidths({});
        setSpacers(normalizedInitialSpacers);
        setRowOrder(defaultRowOrder);
        setSorting([]);
    }, [
        defaultVisibleColumnIds,
        defaultColumnOrder,
        normalizedInitialSpacers,
        defaultRowOrder,
    ]);

    useEffect(() => {
        let cancelled = false;

        setHydrated(false);

        void (async () => {
            const saved = await db.tablePreferences.get(instanceId);
            if (cancelled) return;

            if (!saved) {
                createdAtRef.current = Date.now();
                setVisibleColumnIds(defaultVisibleColumnIds);
                setColumnOrder(defaultColumnOrder);
                setColumnWidths({});
                setSpacers(normalizedInitialSpacers);
                setRowOrder(defaultRowOrder);
                setSorting([]);
                setHydrated(true);
                return;
            }

            const nextSpacers = normalizeSpacers(saved.spacers ?? []);

            setVisibleColumnIds(
                normalizeVisibleColumnIds(
                    saved.visibleColumnIds ?? [],
                    allColumnIds,
                    lockedColumnIds,
                ),
            );
            setColumnOrder(
                normalizeColumnOrder(saved.columnOrder ?? [], allColumnIds),
            );
            setColumnWidths(
                normalizeColumnWidths(saved.columnWidths ?? {}, allColumnIds),
            );
            setSpacers(nextSpacers);
            setRowOrder(
                normalizeRowOrder(
                    saved.rowOrder ?? [],
                    rowIds,
                    nextSpacers.map((spacer) => spacer.id),
                ),
            );
            setSorting(saved.sorting ?? []);

            createdAtRef.current = saved.createdAt ?? Date.now();
            setHydrated(true);
        })();

        return () => {
            cancelled = true;
        };
    }, [instanceId]);

    useEffect(() => {
        if (!hydrated) return;

        setVisibleColumnIds((prev) =>
            normalizeVisibleColumnIds(prev, allColumnIds, lockedColumnIds),
        );
        setColumnOrder((prev) => normalizeColumnOrder(prev, allColumnIds));
        setColumnWidths((prev) => normalizeColumnWidths(prev, allColumnIds));
    }, [hydrated, allColumnIds, lockedColumnIds]);

    useEffect(() => {
        if (!hydrated) return;

        setSpacers((prev) => normalizeSpacers(prev));
    }, [hydrated]);

    useEffect(() => {
        if (!hydrated) return;

        setRowOrder((prev) =>
            normalizeRowOrder(
                prev,
                rowIds,
                spacers.map((spacer) => spacer.id),
            ),
        );
    }, [hydrated, rowIds, spacers]);

    const persist = useDebounce(
        useCallback((record: TablePreferencesRecord) => {
            void db.tablePreferences.put(record);
        }, []),
        250,
    );

    useEffect(() => {
        if (!hydrated) return;

        const normalizedVisible = normalizeVisibleColumnIds(
            visibleColumnIds,
            allColumnIds,
            lockedColumnIds,
        );
        const normalizedOrder = normalizeColumnOrder(columnOrder, allColumnIds);
        const normalizedWidths = normalizeColumnWidths(
            columnWidths,
            allColumnIds,
        );
        const normalizedSpacers = normalizeSpacers(spacers);
        const normalizedRows = normalizeRowOrder(
            rowOrder,
            rowIds,
            normalizedSpacers.map((spacer) => spacer.id),
        );

        persist({
            id: instanceId,
            scopeType,
            scopeId,
            tableId,
            visibleColumnIds: normalizedVisible,
            columnOrder: normalizedOrder,
            columnWidths: normalizedWidths,
            rowOrder: normalizedRows,
            spacers: normalizedSpacers,
            sorting,
            createdAt: createdAtRef.current,
            updatedAt: Date.now(),
        });
    }, [
        hydrated,
        visibleColumnIds,
        columnOrder,
        columnWidths,
        rowOrder,
        spacers,
        sorting,
        allColumnIds,
        lockedColumnIds,
        rowIds,
        instanceId,
        scopeType,
        scopeId,
        tableId,
        persist,
    ]);

    return {
        instanceId,
        hydrated,
        visibleColumnIds,
        setVisibleColumnIds,
        columnOrder,
        setColumnOrder,
        columnWidths,
        setColumnWidths,
        rowOrder,
        setRowOrder,
        spacers,
        setSpacers,
        sorting,
        setSorting,
        resetToDefaults,
    };
}

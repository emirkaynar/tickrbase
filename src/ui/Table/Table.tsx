import type { ComponentChildren, JSX } from "preact";
import { memo } from "preact/compat";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "preact/hooks";
import {
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    useReactTable,
    type ColumnSizingState,
    type Row,
    type SortingState,
    type Updater,
    type VisibilityState,
} from "@tanstack/react-table";
import type {
    TableColumnMeta,
    TableController,
    TableProps,
    TableSpacerRow,
} from "./types";
import { api } from "../../services/api";
import { fetchListRowState, saveListRowState } from "../../services/watchlist";
import styles from "./Table.module.css";

const SPACER_PREFIX = "spacer:";
const COLUMN_DRAG_HOLD_DELAY_MS = 100;
const COLUMN_DRAG_HOLD_TOLERANCE_PX = 6;
const DEFAULT_LOCKED_COLUMN_IDS: string[] = [];
const DEFAULT_INITIAL_SPACERS: TableSpacerRow[] = [];
const VIRTUAL_ROW_HEIGHT_PX = 33;
const VIRTUAL_OVERSCAN_ROWS = 8;
const VIRTUAL_MIN_ROWS = 2;

function normalizeSpacerId(id: string): string {
    return id.startsWith(SPACER_PREFIX) ? id : `${SPACER_PREFIX}${id}`;
}

function createSpacerId(): string {
    return `${SPACER_PREFIX}${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

function cx(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(" ");
}

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

function toIdKey(ids: string[]): string {
    return ids.join("\u001f");
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
    if (left === right) return true;
    if (left.length !== right.length) return false;

    for (let i = 0; i < left.length; i += 1) {
        if (left[i] !== right[i]) return false;
    }

    return true;
}

function normalizeColumnOrder(
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

function normalizeVisibleColumnIds(
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

function normalizeRowOrder(
    rowOrder: string[],
    rowIds: string[],
    spacers?: TableSpacerRow[],
): string[] {
    const validSpacerIds = spacers
        ? new Set(spacers.map((s) => s.id))
        : new Set(rowIds.filter((id) => id.startsWith(SPACER_PREFIX)));

    const next: string[] = [];
    const seen = new Set<string>();

    for (const id of uniqueOrdered(rowOrder)) {
        if (!id) continue;

        // If it's a spacer row, drop it only if it is NOT in validSpacerIds (i.e. deleted)
        if (id.startsWith(SPACER_PREFIX)) {
            if (!validSpacerIds.has(id)) continue;
        }

        seen.add(id);
        next.push(id);
    }

    for (const id of rowIds) {
        if (!seen.has(id)) {
            seen.add(id);
            next.push(id);
        }
    }

    return next;
}

function normalizeSorting(
    sorting: SortingState,
    allColumnIds: string[],
): SortingState {
    const available = new Set(allColumnIds);
    const next: SortingState = [];

    for (const item of sorting) {
        if (!available.has(item.id)) continue;
        next.push({ id: item.id, desc: Boolean(item.desc) });
        if (next.length >= 1) break;
    }

    return next;
}

function normalizeSpacerRows(spacers: TableSpacerRow[]): TableSpacerRow[] {
    const seen = new Set<string>();
    const next: TableSpacerRow[] = [];

    for (const spacer of spacers) {
        const id = normalizeSpacerId(spacer.id);
        if (seen.has(id)) continue;
        seen.add(id);
        next.push({
            id,
            label: spacer.label?.trim() || undefined,
            height:
                typeof spacer.height === "number" && spacer.height > 0
                    ? spacer.height
                    : undefined,
        });
    }

    return next;
}

function normalizeColumnWidths(
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

function mergeDefaultColumnWidths(
    columnWidths: ColumnSizingState,
    defaultColumnWidths: ColumnSizingState,
): ColumnSizingState {
    let next = columnWidths;

    for (const [id, size] of Object.entries(defaultColumnWidths)) {
        if (!Number.isFinite(size) || size <= 0) continue;
        if (next[id] !== undefined) continue;

        if (next === columnWidths) {
            next = { ...columnWidths };
        }

        next[id] = size;
    }

    return next;
}

function resolveUpdater<T>(updater: Updater<T>, prev: T): T {
    return typeof updater === "function"
        ? (updater as (old: T) => T)(prev)
        : updater;
}

function moveById(
    items: string[],
    sourceId: string,
    targetId: string,
): string[] {
    if (sourceId === targetId) return items;

    const from = items.indexOf(sourceId);
    const to = items.indexOf(targetId);
    if (from < 0 || to < 0) return items;

    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
}

function toCssSize(value: number | string | undefined): string | undefined {
    if (value == null) return undefined;
    return typeof value === "number" ? `${value}px` : value;
}

function findScrollParent(element: HTMLElement | null): HTMLElement | null {
    let current = element?.parentElement ?? null;

    while (current) {
        const styles = window.getComputedStyle(current);
        const overflowY = styles.overflowY;
        const overflow = styles.overflow;
        const isScrollable =
            overflowY === "auto" ||
            overflowY === "scroll" ||
            overflow === "auto" ||
            overflow === "scroll";

        if (isScrollable) {
            return current;
        }

        current = current.parentElement;
    }

    return null;
}

function getDefaultColumnWidth(
    size?: number,
    minSize?: number,
): number | undefined {
    if (Number.isFinite(size) && (size as number) > 0) {
        return size;
    }

    if (Number.isFinite(minSize) && (minSize as number) > 0) {
        return minSize;
    }

    return undefined;
}

type DraggableHeaderProps = {
    dragEnabled: boolean;
    draggable: boolean;
    sticky: boolean;
    size: number;
    isDragSource: boolean;
    isDropTarget: boolean;
    isResizing: boolean;
    onResizeStart: (event: MouseEvent | TouchEvent) => void;
    onDragStart: (event: DragEvent) => void;
    onDragOver: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
    onDragEnd: () => void;
    onPointerDown: (event: PointerEvent) => void;
    onPointerMove: (event: PointerEvent) => void;
    onPointerUp: () => void;
    onPointerLeave: () => void;
    onPointerCancel: () => void;
    alignmentClassName?: string;
    children: ComponentChildren;
};

function DraggableHeader({
    dragEnabled,
    draggable,
    sticky,
    size,
    isDragSource,
    isDropTarget,
    isResizing,
    onResizeStart,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    onPointerCancel,
    alignmentClassName,
    children,
}: DraggableHeaderProps) {
    return (
        <th
            data-draggable={dragEnabled ? "true" : undefined}
            style={{
                width: `${size}px`,
                minWidth: `${size}px`,
                maxWidth: `${size}px`,
            }}
            className={cx(
                styles.headerCell,
                sticky && styles.stickyCell,
                isDragSource && styles.dragSource,
                isDropTarget && styles.dropTarget,
            )}
        >
            <div
                className={cx(styles.headerInner, alignmentClassName)}
                draggable={draggable}
                onDragStart={draggable ? (onDragStart as never) : undefined}
                onDragOver={draggable ? (onDragOver as never) : undefined}
                onDrop={draggable ? (onDrop as never) : undefined}
                onDragEnd={draggable ? (onDragEnd as never) : undefined}
                onPointerDown={
                    dragEnabled ? (onPointerDown as never) : undefined
                }
                onPointerMove={
                    dragEnabled ? (onPointerMove as never) : undefined
                }
                onPointerUp={dragEnabled ? (onPointerUp as never) : undefined}
                onPointerLeave={
                    dragEnabled ? (onPointerLeave as never) : undefined
                }
                onPointerCancel={
                    dragEnabled ? (onPointerCancel as never) : undefined
                }
            >
                {children}
            </div>

            <div
                className={cx(
                    styles.columnResizer,
                    isResizing && styles.resizing,
                )}
                onMouseDown={onResizeStart as never}
                onTouchStart={onResizeStart as never}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize column"
            />
        </th>
    );
}

type DraggableDataRowProps<TData extends object> = {
    rowId: string;
    row: Row<TData>;
    layoutVersion: string;
    stickyColumnId: string;
    draggable: boolean;
    isDragSource: boolean;
    isDropTarget: boolean;
    isSettled: boolean;
    onRowDragStart: (rowId: string, event: DragEvent) => void;
    onRowDragOver: (rowId: string, event: DragEvent) => void;
    onRowDrop: (event: DragEvent) => void;
    onRowDragEnd: () => void;
};

type DraggableSpacerRowProps = {
    rowId: string;
    spacer: TableSpacerRow;
    colSpan: number;
    draggable: boolean;
    isDragSource: boolean;
    isDropTarget: boolean;
    isSettled: boolean;
    onRowDragStart: (rowId: string, event: DragEvent) => void;
    onRowDragOver: (rowId: string, event: DragEvent) => void;
    onRowDrop: (event: DragEvent) => void;
    onRowDragEnd: () => void;
    onRemoveSpacer: (rowId: string) => void;
};

type DisplayRow<TData extends object> =
    | { kind: "data"; id: string; row: Row<TData> }
    | { kind: "spacer"; id: string; spacer: TableSpacerRow };

function getAlignmentClassName(
    align: "left" | "center" | "right" | undefined,
): string {
    if (align === "right") return styles.alignRight;
    if (align === "center") return styles.alignCenter;
    return styles.alignLeft;
}

function DraggableDataRow<TData extends object>({
    rowId,
    row,
    layoutVersion,
    stickyColumnId,
    draggable,
    isDragSource,
    isDropTarget,
    onRowDragStart,
    onRowDragOver,
    onRowDrop,
    onRowDragEnd,
    isSettled,
}: DraggableDataRowProps<TData>) {
    void layoutVersion;

    const handleDragStart = useCallback(
        (event: DragEvent) => {
            onRowDragStart(rowId, event);
        },
        [onRowDragStart, rowId],
    );

    const handleDragOver = useCallback(
        (event: DragEvent) => {
            onRowDragOver(rowId, event);
        },
        [onRowDragOver, rowId],
    );

    return (
        <tr
            draggable={draggable}
            onDragStart={draggable ? (handleDragStart as never) : undefined}
            onDragOver={draggable ? (handleDragOver as never) : undefined}
            onDrop={draggable ? (onRowDrop as never) : undefined}
            onDragEnd={draggable ? (onRowDragEnd as never) : undefined}
            data-draggable={draggable ? "true" : undefined}
            data-drag-state={
                isDragSource
                    ? "dragging"
                    : isDropTarget
                      ? "over"
                      : isSettled
                        ? "settled"
                        : undefined
            }
            className={cx(
                styles.bodyRow,
                isDragSource && styles.dragSource,
                isDropTarget && styles.dropTarget,
            )}
        >
            {row.getVisibleCells().map((cell) => {
                const sticky = cell.column.id === stickyColumnId;
                const meta = cell.column.columnDef.meta as
                    | TableColumnMeta
                    | undefined;
                const alignClassName = getAlignmentClassName(meta?.align);

                return (
                    <td
                        key={cell.id}
                        style={{
                            width: `${cell.column.getSize()}px`,
                            minWidth: `${cell.column.getSize()}px`,
                            maxWidth: `${cell.column.getSize()}px`,
                        }}
                        className={cx(styles.cell, sticky && styles.stickyCell)}
                    >
                        <div
                            className={cx(styles.cellContent, alignClassName)}
                            data-pulse-host="true"
                        >
                            <span
                                className={cx(styles.cellValue, alignClassName)}
                            >
                                {flexRender(
                                    cell.column.columnDef.cell,
                                    cell.getContext(),
                                )}
                            </span>
                        </div>
                    </td>
                );
            })}

            <td className={styles.fillCell} aria-hidden="true" />
        </tr>
    );
}

function areDataRowPropsEqual<TData extends object>(
    prev: DraggableDataRowProps<TData>,
    next: DraggableDataRowProps<TData>,
): boolean {
    return (
        prev.rowId === next.rowId &&
        prev.row.original === next.row.original &&
        prev.layoutVersion === next.layoutVersion &&
        prev.stickyColumnId === next.stickyColumnId &&
        prev.draggable === next.draggable &&
        prev.isDragSource === next.isDragSource &&
        prev.isDropTarget === next.isDropTarget &&
        prev.isSettled === next.isSettled &&
        prev.onRowDragStart === next.onRowDragStart &&
        prev.onRowDragOver === next.onRowDragOver &&
        prev.onRowDrop === next.onRowDrop &&
        prev.onRowDragEnd === next.onRowDragEnd
    );
}

const MemoDraggableDataRow = memo(
    DraggableDataRow as (props: DraggableDataRowProps<object>) => JSX.Element,
    areDataRowPropsEqual,
) as typeof DraggableDataRow;

function DraggableSpacerRow({
    rowId,
    spacer,
    colSpan,
    draggable,
    isDragSource,
    isDropTarget,
    isSettled,
    onRowDragStart,
    onRowDragOver,
    onRowDrop,
    onRowDragEnd,
    onRemoveSpacer,
}: DraggableSpacerRowProps) {
    const handleDragStart = useCallback(
        (event: DragEvent) => {
            onRowDragStart(rowId, event);
        },
        [onRowDragStart, rowId],
    );

    const handleDragOver = useCallback(
        (event: DragEvent) => {
            onRowDragOver(rowId, event);
        },
        [onRowDragOver, rowId],
    );

    const handleRemove = useCallback(() => {
        onRemoveSpacer(rowId);
    }, [onRemoveSpacer, rowId]);

    return (
        <tr
            draggable={draggable}
            onDragStart={draggable ? (handleDragStart as never) : undefined}
            onDragOver={draggable ? (handleDragOver as never) : undefined}
            onDrop={draggable ? (onRowDrop as never) : undefined}
            onDragEnd={draggable ? (onRowDragEnd as never) : undefined}
            data-draggable={draggable ? "true" : undefined}
            data-drag-state={
                isDragSource
                    ? "dragging"
                    : isDropTarget
                      ? "over"
                      : isSettled
                        ? "settled"
                        : undefined
            }
            className={cx(
                styles.spacerRow,
                isDragSource && styles.dragSource,
                isDropTarget && styles.dropTarget,
            )}
        >
            <td colSpan={colSpan} className={styles.spacerCell}>
                <div className={styles.spacer}>
                    <span className={styles.spacerLabel} title={spacer.label}>
                        {spacer.label || "Group"}
                    </span>
                    <button
                        type="button"
                        className={styles.spacerRemoveButton}
                        draggable={false}
                        onPointerDown={(event) => {
                            event.stopPropagation();
                        }}
                        onClick={(event) => {
                            event.stopPropagation();
                            handleRemove();
                        }}
                    >
                        Remove
                    </button>
                </div>
            </td>
        </tr>
    );
}

function areSpacerRowPropsEqual(
    prev: DraggableSpacerRowProps,
    next: DraggableSpacerRowProps,
): boolean {
    return (
        prev.rowId === next.rowId &&
        prev.spacer === next.spacer &&
        prev.colSpan === next.colSpan &&
        prev.draggable === next.draggable &&
        prev.isDragSource === next.isDragSource &&
        prev.isDropTarget === next.isDropTarget &&
        prev.isSettled === next.isSettled &&
        prev.onRowDragStart === next.onRowDragStart &&
        prev.onRowDragOver === next.onRowDragOver &&
        prev.onRowDrop === next.onRowDrop &&
        prev.onRowDragEnd === next.onRowDragEnd &&
        prev.onRemoveSpacer === next.onRemoveSpacer
    );
}

const MemoDraggableSpacerRow = memo(DraggableSpacerRow, areSpacerRowPropsEqual);

export function Table<TData extends object>({
    rows,
    columns,
    getRowId,
    scopeType: _scopeType,
    scopeId: _scopeId,
    tableId: _tableId,
    variant = "widget",
    className,
    stickyColumnId = "symbol",
    lockedColumnIds = DEFAULT_LOCKED_COLUMN_IDS,
    initialSpacerRows: _initialSpacerRows = DEFAULT_INITIAL_SPACERS,
    emptyMessage = "No rows to display.",
    height,
    maxHeight,
    enableColumnReorder = true,
    enableRowReorder = true,
    disableRowReorderWhenSorted: _disableRowReorderWhenSorted = true,
    rowStateId,
    isHydrating: externalHydrating,
    onControllerReady,
}: TableProps<TData>) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [draggingRowId, setDraggingRowId] = useState("");
    const [dragOverRowId, setDragOverRowId] = useState("");
    const [settledRowId, setSettledRowId] = useState("");
    const [draggingColumnId, setDraggingColumnId] = useState("");
    const [dragOverColumnId, setDragOverColumnId] = useState("");
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);
    const draggingRowIdRef = useRef("");
    const dragOverRowIdRef = useRef("");
    const canReorderRowsRef = useRef(false);
    const allRowIdsRef = useRef<string[]>([]);
    const settledRowTimerRef = useRef<number | null>(null);
    const lastSavedPreferencesKeyRef = useRef("");
    const lastSavedRowStateKeyRef = useRef("");
    const loadedRowStateIdRef = useRef("");
    const draggingColumnIdRef = useRef("");
    const dragOverColumnIdRef = useRef("");
    const armedColumnDragIdRef = useRef("");
    const pendingColumnDragIdRef = useRef("");
    const columnDragHoldTimerRef = useRef<number | null>(null);
    const columnDragPointerStartRef = useRef<{ x: number; y: number } | null>(
        null,
    );

    const allColumnIds = useMemo(
        () => uniqueOrdered(columns.map((column) => column.id)),
        [columns],
    );

    const lockedFromMeta = useMemo(
        () =>
            columns
                .filter((column) => column.meta?.locked)
                .map((column) => column.id),
        [columns],
    );

    const normalizedLockedColumnIds = useMemo(() => {
        const merged = uniqueOrdered([
            ...lockedColumnIds,
            ...lockedFromMeta,
            stickyColumnId,
        ]);
        const available = new Set(allColumnIds);
        return merged.filter((id) => available.has(id));
    }, [lockedColumnIds, lockedFromMeta, stickyColumnId, allColumnIds]);

    const lockedSet = useMemo(
        () => new Set(normalizedLockedColumnIds),
        [normalizedLockedColumnIds],
    );

    const dataRowIds = useMemo(
        () => rows.map((row, index) => getRowId(row, index)),
        [rows, getRowId],
    );
    const dataRowCount = dataRowIds.length;
    const dataRowIdsKey = useMemo(() => toIdKey(dataRowIds), [dataRowIds]);

    const dataById = useMemo(() => {
        const map = new Map<string, TData>();
        rows.forEach((row, index) => {
            map.set(getRowId(row, index), row);
        });
        return map;
    }, [rows, getRowId]);

    const defaultColumnWidths = useMemo<ColumnSizingState>(() => {
        const next: ColumnSizingState = {};

        for (const column of columns) {
            const width = getDefaultColumnWidth(column.size, column.minSize);
            if (width === undefined) continue;
            next[column.id] = width;
        }

        return next;
    }, [columns]);

    const defaultVisibleColumnIds = useMemo(
        () =>
            normalizeVisibleColumnIds(
                allColumnIds,
                allColumnIds,
                normalizedLockedColumnIds,
            ),
        [allColumnIds, normalizedLockedColumnIds],
    );

    const defaultColumnOrder = useMemo(
        () => normalizeColumnOrder(allColumnIds, allColumnIds),
        [allColumnIds],
    );

    const defaultNormalizedColumnWidths = useMemo(
        () =>
            normalizeColumnWidths(
                mergeDefaultColumnWidths(
                    defaultColumnWidths,
                    defaultColumnWidths,
                ),
                allColumnIds,
            ),
        [defaultColumnWidths, allColumnIds],
    );

    const defaultSpacers = useMemo(
        () => normalizeSpacerRows(_initialSpacerRows),
        [_initialSpacerRows],
    );
    const defaultAllRowIds = useMemo(
        () => [...dataRowIds, ...defaultSpacers.map((spacer) => spacer.id)],
        [dataRowIds, defaultSpacers],
    );
    const defaultRowOrder = useMemo(
        () => normalizeRowOrder([], defaultAllRowIds),
        [defaultAllRowIds],
    );

    const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>(
        defaultVisibleColumnIds,
    );
    const [columnOrder, setColumnOrder] =
        useState<string[]>(defaultColumnOrder);
    const [columnWidths, setColumnWidths] = useState<ColumnSizingState>(
        defaultNormalizedColumnWidths,
    );
    const [sorting, setSorting] = useState<SortingState>([]);
    const [rowOrder, setRowOrder] = useState<string[]>(defaultRowOrder);
    const [spacers, setSpacers] = useState<TableSpacerRow[]>(defaultSpacers);
    const [preferencesHydrated, setPreferencesHydrated] = useState(false);
    const [rowStateHydrated, setRowStateHydrated] = useState(false);
    const persistenceId = useMemo(
        () => `${_scopeType}:${_scopeId}:${_tableId}`,
        [_scopeType, _scopeId, _tableId],
    );
    const effectiveRowStateId = rowStateId ?? persistenceId;

    useEffect(() => {
        setVisibleColumnIds((prev) =>
            normalizeVisibleColumnIds(
                prev,
                allColumnIds,
                normalizedLockedColumnIds,
            ),
        );
        setColumnOrder((prev) => normalizeColumnOrder(prev, allColumnIds));
        setColumnWidths((prev) =>
            mergeDefaultColumnWidths(
                normalizeColumnWidths(prev, allColumnIds),
                defaultNormalizedColumnWidths,
            ),
        );
    }, [
        allColumnIds,
        normalizedLockedColumnIds,
        defaultNormalizedColumnWidths,
    ]);

    const normalizedSpacers = useMemo(
        () => normalizeSpacerRows(spacers),
        [spacers],
    );
    const spacerIds = useMemo(
        () => normalizedSpacers.map((spacer) => spacer.id),
        [normalizedSpacers],
    );
    const spacerCount = spacerIds.length;
    const spacerIdsKey = useMemo(() => toIdKey(spacerIds), [spacerIds]);
    const allRowIds = useMemo(
        () => [...dataRowIds, ...spacerIds],
        [dataRowIdsKey, spacerIdsKey],
    );

    useEffect(() => {
        setRowOrder((prev) => {
            const hasPersistedDataRowIds = prev.some(
                (id) => !id.startsWith(SPACER_PREFIX),
            );
            const hasPersistedSpacerRowIds = prev.some((id) =>
                id.startsWith(SPACER_PREFIX),
            );

            if (dataRowCount === 0 && hasPersistedDataRowIds) {
                return prev;
            }

            if (spacerCount === 0 && hasPersistedSpacerRowIds) {
                return prev;
            }

            const normalized = normalizeRowOrder(prev, allRowIds, normalizedSpacers);
            return areStringArraysEqual(prev, normalized) ? prev : normalized;
        });
    }, [allRowIds, dataRowCount, spacerCount, dataRowIdsKey, spacerIdsKey, normalizedSpacers]);

    useEffect(() => {
        setSorting((prev) => normalizeSorting(prev, allColumnIds));
    }, [allColumnIds]);

    useEffect(() => {
        let active = true;

        setPreferencesHydrated(false);
        lastSavedPreferencesKeyRef.current = "";

        const loadPreferences = async () => {
            try {
                const url = `/user/table-prefs?scope_type=${encodeURIComponent(_scopeType)}&scope_id=${encodeURIComponent(_scopeId)}&table_id=${encodeURIComponent(_tableId)}`;
                const persisted = await api.get<any>(url);
                if (!active || !persisted || !persisted.visibleColumnIds) return;

                setVisibleColumnIds(
                    normalizeVisibleColumnIds(
                        persisted.visibleColumnIds,
                        allColumnIds,
                        normalizedLockedColumnIds,
                    ),
                );
                setColumnOrder(
                    normalizeColumnOrder(persisted.columnOrder, allColumnIds),
                );
                setColumnWidths(
                    mergeDefaultColumnWidths(
                        normalizeColumnWidths(
                            persisted.columnWidths,
                            allColumnIds,
                        ),
                        defaultNormalizedColumnWidths,
                    ),
                );
                setSorting(normalizeSorting(persisted.sorting, allColumnIds));

                const key = JSON.stringify({
                    visibleColumnIds: normalizeVisibleColumnIds(
                        persisted.visibleColumnIds,
                        allColumnIds,
                        normalizedLockedColumnIds,
                    ),
                    columnOrder: normalizeColumnOrder(
                        persisted.columnOrder,
                        allColumnIds,
                    ),
                    columnWidths: mergeDefaultColumnWidths(
                        normalizeColumnWidths(
                            persisted.columnWidths,
                            allColumnIds,
                        ),
                        defaultNormalizedColumnWidths,
                    ),
                    sorting: normalizeSorting(persisted.sorting, allColumnIds),
                });
                lastSavedPreferencesKeyRef.current = key;
            } catch (error) {
                console.warn("[Table] Failed to hydrate preferences", error);
            } finally {
                if (active) {
                    setPreferencesHydrated(true);
                }
            }
        };

        void loadPreferences();

        return () => {
            active = false;
        };
    }, [
        persistenceId,
        allColumnIds,
        normalizedLockedColumnIds,
        defaultNormalizedColumnWidths,
    ]);

    useEffect(() => {
        if (!preferencesHydrated) return;

        const normalizedVisible = normalizeVisibleColumnIds(
            visibleColumnIds,
            allColumnIds,
            normalizedLockedColumnIds,
        );
        const normalizedOrder = normalizeColumnOrder(columnOrder, allColumnIds);
        const normalizedWidths = mergeDefaultColumnWidths(
            normalizeColumnWidths(columnWidths, allColumnIds),
            defaultNormalizedColumnWidths,
        );
        const normalizedSorting = normalizeSorting(sorting, allColumnIds);

        const nextPreferencesKey = JSON.stringify({
            visibleColumnIds: normalizedVisible,
            columnOrder: normalizedOrder,
            columnWidths: normalizedWidths,
            sorting: normalizedSorting,
        });
        if (nextPreferencesKey === lastSavedPreferencesKeyRef.current) return;

        let active = true;

        const savePreferences = async () => {
            try {
                await api.put("/user/table-prefs", {
                    scopeType: _scopeType,
                    scopeId: _scopeId,
                    tableId: _tableId,
                    prefs: {
                        visibleColumnIds: normalizedVisible,
                        columnOrder: normalizedOrder,
                        columnWidths: normalizedWidths,
                        sorting: normalizedSorting,
                    },
                });

                if (active) {
                    lastSavedPreferencesKeyRef.current = nextPreferencesKey;
                }
            } catch (error) {
                console.warn("[Table] Failed to persist preferences", error);
            }
        };

        void savePreferences();

        return () => {
            active = false;
        };
    }, [
        preferencesHydrated,
        persistenceId,
        _scopeType,
        _scopeId,
        _tableId,
        visibleColumnIds,
        columnOrder,
        columnWidths,
        sorting,
        allColumnIds,
        normalizedLockedColumnIds,
        defaultNormalizedColumnWidths,
    ]);

    useEffect(() => {
        let active = true;

        setRowStateHydrated(false);
        loadedRowStateIdRef.current = "";
        lastSavedRowStateKeyRef.current = "";

        const loadRowState = async () => {
            try {
                const persisted = await fetchListRowState(effectiveRowStateId);
                if (!active) return;

                if (persisted && (persisted.rowOrder?.length > 0 || persisted.spacers?.length > 0)) {
                    const loadedSpacers = normalizeSpacerRows(
                        persisted.spacers,
                    );
                    const loadedRowOrder = uniqueOrdered(persisted.rowOrder);
                    const initialRowOrder = normalizeRowOrder(
                        loadedRowOrder,
                        [...dataRowIds, ...loadedSpacers.map((s) => s.id)],
                        loadedSpacers,
                    );

                    setRowOrder(initialRowOrder);
                    setSpacers(loadedSpacers);
                    loadedRowStateIdRef.current = effectiveRowStateId;
                    lastSavedRowStateKeyRef.current = JSON.stringify({
                        rowOrder: initialRowOrder,
                        spacers: loadedSpacers,
                    });

                    return;
                }

                const clearedSpacers = normalizeSpacerRows(defaultSpacers);
                const clearedRowOrder = normalizeRowOrder(
                    [],
                    [...dataRowIds, ...clearedSpacers.map((s) => s.id)],
                    clearedSpacers,
                );
                setRowOrder(clearedRowOrder);
                setSpacers(clearedSpacers);
                loadedRowStateIdRef.current = effectiveRowStateId;
                lastSavedRowStateKeyRef.current = JSON.stringify({
                    rowOrder: clearedRowOrder,
                    spacers: clearedSpacers,
                });
            } catch (error) {
                console.warn("[Table] Failed to hydrate row state", error);
            } finally {
                if (active) {
                    setRowStateHydrated(true);
                }
            }
        };

        void loadRowState();

        return () => {
            active = false;
        };
    }, [effectiveRowStateId, defaultSpacers]);

    useEffect(() => {
        if (!rowStateHydrated) return;
        if (loadedRowStateIdRef.current !== effectiveRowStateId) return;
        if (draggingRowId) return;

        const hasPersistedDataRowIds = rowOrder.some(
            (id) => !id.startsWith(SPACER_PREFIX),
        );
        const hasPersistedSpacerRowIds = rowOrder.some((id) =>
            id.startsWith(SPACER_PREFIX),
        );
        if (dataRowCount === 0 && hasPersistedDataRowIds) {
            return;
        }
        if (spacerCount === 0 && hasPersistedSpacerRowIds) {
            return;
        }

        const persistedSpacers = normalizeSpacerRows(spacers);
        const persistedRowOrder = normalizeRowOrder(
            rowOrder,
            [...dataRowIds, ...persistedSpacers.map((spacer) => spacer.id)],
            persistedSpacers,
        );
        const nextRowStateKey = JSON.stringify({
            rowOrder: persistedRowOrder,
            spacers: persistedSpacers,
        });
        if (nextRowStateKey === lastSavedRowStateKeyRef.current) return;

        let active = true;

        const saveRowState = async () => {
            try {
                await saveListRowState(effectiveRowStateId, {
                    rowOrder: persistedRowOrder,
                    spacers: persistedSpacers,
                });

                if (active) {
                    lastSavedRowStateKeyRef.current = nextRowStateKey;
                }
            } catch (error) {
                console.warn("[Table] Failed to persist row state", error);
            }
        };

        void saveRowState();

        return () => {
            active = false;
        };
    }, [
        rowStateHydrated,
        draggingRowId,
        rowOrder,
        spacers,
        dataRowCount,
        dataRowIdsKey,
        spacerCount,
        spacerIdsKey,
        effectiveRowStateId,
    ]);

    const resetToDefaults = () => {
        setVisibleColumnIds(defaultVisibleColumnIds);
        setColumnOrder(defaultColumnOrder);
        setColumnWidths(defaultNormalizedColumnWidths);
        setSorting([]);
        setRowOrder(defaultRowOrder);
        setSpacers(defaultSpacers);
    };

    const columnVisibility = useMemo<VisibilityState>(() => {
        const visibleSet = new Set(visibleColumnIds);
        const visibility: VisibilityState = {};

        for (const id of allColumnIds) {
            visibility[id] = lockedSet.has(id) ? true : visibleSet.has(id);
        }

        return visibility;
    }, [visibleColumnIds, allColumnIds, lockedSet]);

    const orderedRowIds = useMemo(
        () => normalizeRowOrder(rowOrder, allRowIds, normalizedSpacers),
        [rowOrder, allRowIds, normalizedSpacers],
    );

    const orderedDataRowIds = useMemo(
        () => orderedRowIds.filter((id) => !id.startsWith(SPACER_PREFIX)),
        [orderedRowIds],
    );

    const orderedRows = useMemo(() => {
        const next: TData[] = [];

        for (const id of orderedDataRowIds) {
            const row = dataById.get(id);
            if (row !== undefined) next.push(row);
        }

        return next;
    }, [orderedDataRowIds, dataById]);

    const table = useReactTable({
        data: orderedRows,
        columns,
        getRowId: (row, index) => getRowId(row, index),
        state: {
            sorting,
            columnOrder,
            columnSizing: columnWidths,
            columnVisibility,
        },
        onSortingChange: (updater) => {
            setSorting((prev) =>
                normalizeSorting(resolveUpdater(updater, prev), allColumnIds),
            );
        },
        onColumnOrderChange: (updater) => {
            setColumnOrder((prev) =>
                normalizeColumnOrder(
                    resolveUpdater(updater, prev),
                    allColumnIds,
                ),
            );
        },
        onColumnSizingChange: (updater) => {
            setColumnWidths((prev) => resolveUpdater(updater, prev));
        },
        onColumnVisibilityChange: (updater) => {
            setVisibleColumnIds((prev) => {
                const previous: VisibilityState = {};
                const prevSet = new Set(prev);

                for (const id of allColumnIds) {
                    previous[id] = lockedSet.has(id) ? true : prevSet.has(id);
                }

                const next = resolveUpdater(updater, previous);
                const nextVisible = allColumnIds.filter(
                    (id) => lockedSet.has(id) || next[id] !== false,
                );

                return normalizeVisibleColumnIds(
                    nextVisible,
                    allColumnIds,
                    normalizedLockedColumnIds,
                );
            });
        },
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        enableMultiSort: false,
        columnResizeMode: "onChange",
        enableColumnResizing: true,
    });

    const visibleLeafColumns = table.getVisibleLeafColumns();
    const renderedColumnCount = Math.max(visibleLeafColumns.length + 1, 1);
    const tableRows = table.getRowModel().rows;
    const rowLayoutVersion = useMemo(() => {
        const parts = visibleLeafColumns.map(
            (column) => `${column.id}:${column.getSize()}`,
        );
        return `${stickyColumnId}|${parts.join("|")}`;
    }, [visibleLeafColumns, stickyColumnId]);
    const tableRowsById = useMemo(() => {
        const map = new Map<string, Row<TData>>();
        for (const row of tableRows) {
            map.set(row.id, row);
        }
        return map;
    }, [tableRows]);
    const spacerById = useMemo(() => {
        const map = new Map<string, TableSpacerRow>();
        for (const spacer of normalizedSpacers) {
            map.set(spacer.id, spacer);
        }
        return map;
    }, [normalizedSpacers]);

    const hasActiveSorting = sorting.length > 0;
    const canReorderRows =
        enableRowReorder &&
        (!_disableRowReorderWhenSorted || !hasActiveSorting);

    dragOverRowIdRef.current = dragOverRowId;
    canReorderRowsRef.current = canReorderRows;
    allRowIdsRef.current = allRowIds;

    const orderedDisplayRows = useMemo<DisplayRow<TData>[]>(() => {
        const next: DisplayRow<TData>[] = [];

        for (const id of orderedRowIds) {
            const dataRow = tableRowsById.get(id);
            if (dataRow) {
                next.push({ kind: "data", id, row: dataRow });
                continue;
            }

            const spacer = spacerById.get(id);
            if (spacer) {
                next.push({ kind: "spacer", id, spacer });
            }
        }

        return next;
    }, [orderedRowIds, tableRowsById, spacerById]);

    useEffect(() => {
        const rootElement = rootRef.current;
        if (!rootElement) return;

        const scrollParent = findScrollParent(rootElement);
        if (!scrollParent) return;

        let rafId = 0;

        const syncMetrics = () => {
            rafId = 0;
            setScrollTop(scrollParent.scrollTop);
            setViewportHeight(scrollParent.clientHeight);
        };

        const queueSync = () => {
            if (rafId !== 0) return;
            rafId = window.requestAnimationFrame(syncMetrics);
        };

        queueSync();
        scrollParent.addEventListener("scroll", queueSync, { passive: true });
        window.addEventListener("resize", queueSync);

        const resizeObserver = new ResizeObserver(() => {
            queueSync();
        });
        resizeObserver.observe(scrollParent);

        return () => {
            scrollParent.removeEventListener("scroll", queueSync);
            window.removeEventListener("resize", queueSync);
            resizeObserver.disconnect();
            if (rafId !== 0) {
                window.cancelAnimationFrame(rafId);
            }
        };
    }, []);

    const sortedDisplayRows = useMemo<DisplayRow<TData>[]>(
        () => tableRows.map((row) => ({ kind: "data", id: row.id, row })),
        [tableRows],
    );

    const displayRows = hasActiveSorting
        ? sortedDisplayRows
        : orderedDisplayRows;

    const virtualized =
        !draggingRowId &&
        displayRows.length >= VIRTUAL_MIN_ROWS &&
        viewportHeight > 0;

    const safeScrollTop = Math.max(scrollTop, 0);
    const virtualStartIndex = virtualized
        ? Math.max(
              Math.floor(safeScrollTop / VIRTUAL_ROW_HEIGHT_PX) -
                  VIRTUAL_OVERSCAN_ROWS,
              0,
          )
        : 0;

    const virtualVisibleCount = virtualized
        ? Math.ceil(viewportHeight / VIRTUAL_ROW_HEIGHT_PX) +
          VIRTUAL_OVERSCAN_ROWS * 2
        : displayRows.length;

    const virtualEndIndex = virtualized
        ? Math.min(virtualStartIndex + virtualVisibleCount, displayRows.length)
        : displayRows.length;

    const topVirtualPadding = virtualized
        ? virtualStartIndex * VIRTUAL_ROW_HEIGHT_PX
        : 0;
    const bottomVirtualPadding = virtualized
        ? Math.max(displayRows.length - virtualEndIndex, 0) *
          VIRTUAL_ROW_HEIGHT_PX
        : 0;

    const renderedDisplayRows = virtualized
        ? displayRows.slice(virtualStartIndex, virtualEndIndex)
        : displayRows;

    const markRowSettled = (rowId: string) => {
        if (!rowId) return;

        if (settledRowTimerRef.current != null) {
            window.clearTimeout(settledRowTimerRef.current);
            settledRowTimerRef.current = null;
        }

        setSettledRowId(rowId);
        settledRowTimerRef.current = window.setTimeout(() => {
            setSettledRowId((prev) => (prev === rowId ? "" : prev));
            settledRowTimerRef.current = null;
        }, 240);
    };

    const resetRowDragState = (settledId?: string) => {
        draggingRowIdRef.current = "";
        dragOverRowIdRef.current = "";
        setDraggingRowId("");
        setDragOverRowId("");
        if (settledId) {
            markRowSettled(settledId);
        }
    };

    const handleRowDragStart = useCallback(
        (rowId: string, event: DragEvent) => {
            if (!canReorderRowsRef.current) return;

            draggingRowIdRef.current = rowId;
            dragOverRowIdRef.current = rowId;
            setDraggingRowId(rowId);
            setDragOverRowId(rowId);

            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", rowId);
            }
        },
        [],
    );

    const handleRowDragOver = useCallback(
        (targetRowId: string, event: DragEvent) => {
            if (!canReorderRowsRef.current) return;

            const sourceRowId =
                draggingRowIdRef.current ||
                event.dataTransfer?.getData("text/plain") ||
                "";

            if (!sourceRowId || sourceRowId === targetRowId) return;

            event.preventDefault();

            if (dragOverRowIdRef.current === targetRowId) return;

            dragOverRowIdRef.current = targetRowId;

            setDragOverRowId(targetRowId);

            setRowOrder((prev) => {
                const normalized = normalizeRowOrder(
                    prev,
                    allRowIdsRef.current,
                );
                return moveById(normalized, sourceRowId, targetRowId);
            });
        },
        [],
    );

    const handleRowDrop = useCallback((event: DragEvent) => {
        event.preventDefault();
        resetRowDragState(draggingRowIdRef.current);
    }, []);

    const handleRowDragEnd = useCallback(() => {
        resetRowDragState(draggingRowIdRef.current);
    }, []);

    const clearColumnDragHoldTimer = () => {
        if (columnDragHoldTimerRef.current == null) return;
        window.clearTimeout(columnDragHoldTimerRef.current);
        columnDragHoldTimerRef.current = null;
    };

    const clearPendingColumnDragHold = () => {
        pendingColumnDragIdRef.current = "";
        columnDragPointerStartRef.current = null;
        clearColumnDragHoldTimer();
    };

    const clearColumnDragArmedState = () => {
        armedColumnDragIdRef.current = "";
    };

    const handleColumnPointerDown = (columnId: string, event: PointerEvent) => {
        if (!enableColumnReorder || lockedSet.has(columnId)) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;

        clearColumnDragArmedState();
        pendingColumnDragIdRef.current = columnId;
        columnDragPointerStartRef.current = {
            x: event.clientX,
            y: event.clientY,
        };

        clearColumnDragHoldTimer();
        columnDragHoldTimerRef.current = window.setTimeout(() => {
            if (pendingColumnDragIdRef.current !== columnId) return;
            armedColumnDragIdRef.current = columnId;
        }, COLUMN_DRAG_HOLD_DELAY_MS);
    };

    const handleColumnPointerMove = (event: PointerEvent) => {
        const start = columnDragPointerStartRef.current;
        if (!start) return;
        if (armedColumnDragIdRef.current) return;

        const dx = Math.abs(event.clientX - start.x);
        const dy = Math.abs(event.clientY - start.y);
        if (
            dx > COLUMN_DRAG_HOLD_TOLERANCE_PX ||
            dy > COLUMN_DRAG_HOLD_TOLERANCE_PX
        ) {
            clearPendingColumnDragHold();
        }
    };

    const handleColumnPointerUp = () => {
        clearPendingColumnDragHold();
        if (!draggingColumnIdRef.current) {
            clearColumnDragArmedState();
        }
    };

    const handleColumnPointerLeave = () => {
        if (armedColumnDragIdRef.current || draggingColumnIdRef.current) return;
        clearPendingColumnDragHold();
    };

    const handleColumnPointerCancel = () => {
        clearPendingColumnDragHold();
        if (!draggingColumnIdRef.current) {
            clearColumnDragArmedState();
        }
    };

    const resetColumnDragState = () => {
        draggingColumnIdRef.current = "";
        dragOverColumnIdRef.current = "";
        clearPendingColumnDragHold();
        clearColumnDragArmedState();
        setDraggingColumnId("");
        setDragOverColumnId("");
    };

    const handleColumnDragStart = (columnId: string, event: DragEvent) => {
        if (!enableColumnReorder || lockedSet.has(columnId)) return;

        if (armedColumnDragIdRef.current !== columnId) {
            event.preventDefault();
            return;
        }

        clearPendingColumnDragHold();

        draggingColumnIdRef.current = columnId;
        dragOverColumnIdRef.current = columnId;
        setDraggingColumnId(columnId);
        setDragOverColumnId(columnId);

        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", columnId);
        }
    };

    const handleColumnDragOver = (targetColumnId: string, event: DragEvent) => {
        if (!enableColumnReorder || lockedSet.has(targetColumnId)) return;

        event.preventDefault();

        const sourceColumnId =
            draggingColumnIdRef.current ||
            event.dataTransfer?.getData("text/plain") ||
            "";

        if (!sourceColumnId || sourceColumnId === targetColumnId) return;
        if (lockedSet.has(sourceColumnId)) return;
        if (dragOverColumnIdRef.current === targetColumnId) return;

        dragOverColumnIdRef.current = targetColumnId;
        setDragOverColumnId(targetColumnId);

        setColumnOrder((prev) => {
            const normalized = normalizeColumnOrder(prev, allColumnIds);
            return moveById(normalized, sourceColumnId, targetColumnId);
        });
    };

    const handleColumnDrop = (event: DragEvent) => {
        event.preventDefault();
        resetColumnDragState();
    };

    const columnMetaMap = useMemo(() => {
        const map = new Map<
            string,
            { label: string; locked: boolean; removable: boolean }
        >();

        for (const column of columns) {
            const label =
                column.meta?.label ??
                (typeof column.header === "string" ? column.header : column.id);
            const locked =
                lockedSet.has(column.id) || Boolean(column.meta?.locked);
            const removable = !locked && column.meta?.removable !== false;
            map.set(column.id, { label, locked, removable });
        }

        return map;
    }, [columns, lockedSet]);

    const controller = useMemo<TableController>(
        () => ({
            getColumnOptions: () => {
                const order = normalizeColumnOrder(columnOrder, allColumnIds);
                const visible = new Set(visibleColumnIds);

                return order.map((id) => {
                    const meta = columnMetaMap.get(id);
                    return {
                        id,
                        label: meta?.label ?? id,
                        visible: visible.has(id),
                        locked: meta?.locked ?? false,
                        removable: meta?.removable ?? true,
                    };
                });
            },
            getAddableColumns: () => {
                const visible = new Set(visibleColumnIds);
                return normalizeColumnOrder(columnOrder, allColumnIds)
                    .map((id) => {
                        const meta = columnMetaMap.get(id);
                        return {
                            id,
                            label: meta?.label ?? id,
                            visible: visible.has(id),
                            locked: meta?.locked ?? false,
                            removable: meta?.removable ?? true,
                        };
                    })
                    .filter((item) => !item.visible && item.removable);
            },
            showColumn: (id: string) => {
                if (!allColumnIds.includes(id)) return;
                setVisibleColumnIds((prev) => {
                    if (prev.includes(id)) return prev;
                    return normalizeVisibleColumnIds(
                        [...prev, id],
                        allColumnIds,
                        normalizedLockedColumnIds,
                    );
                });
            },
            hideColumn: (id: string) => {
                if (lockedSet.has(id)) return;
                setVisibleColumnIds((prev) =>
                    normalizeVisibleColumnIds(
                        prev.filter((columnId) => columnId !== id),
                        allColumnIds,
                        normalizedLockedColumnIds,
                    ),
                );
            },
            toggleColumn: (id: string) => {
                if (lockedSet.has(id)) return;

                setVisibleColumnIds((prev) => {
                    const isVisible = prev.includes(id);
                    const next = isVisible
                        ? prev.filter((columnId) => columnId !== id)
                        : [...prev, id];

                    return normalizeVisibleColumnIds(
                        next,
                        allColumnIds,
                        normalizedLockedColumnIds,
                    );
                });
            },
            addSpacer: (spacer) => {
                const id = spacer?.id
                    ? normalizeSpacerId(spacer.id)
                    : createSpacerId();
                const label = spacer?.label?.trim() || undefined;

                setSpacers((prev) => {
                    if (prev.some((item) => item.id === id)) return prev;
                    return [
                        ...prev,
                        {
                            id,
                            label,
                            height:
                                typeof spacer?.height === "number" &&
                                spacer.height > 0
                                    ? spacer.height
                                    : undefined,
                        },
                    ];
                });

                setRowOrder((prev) => {
                    const next = normalizeRowOrder(prev, [...allRowIds, id]);
                    if (next.includes(id)) return next;
                    return [...next, id];
                });

                return id;
            },
            removeSpacer: (id: string) => {
                const normalizedId = normalizeSpacerId(id);
                setSpacers((prev) =>
                    prev.filter((spacer) => spacer.id !== normalizedId),
                );
                setRowOrder((prev) =>
                    prev.filter((rowId) => rowId !== normalizedId),
                );
            },
            resetLayout: () => {
                resetToDefaults();
            },
        }),
        [
            allColumnIds,
            columnMetaMap,
            columnOrder,
            lockedSet,
            normalizedLockedColumnIds,
            allRowIds,
            resetToDefaults,
            setVisibleColumnIds,
            visibleColumnIds,
        ],
    );

    useEffect(() => {
        if (!onControllerReady) return;
        onControllerReady(controller);
    }, [controller, onControllerReady]);

    useEffect(
        () => () => {
            clearColumnDragHoldTimer();
            if (settledRowTimerRef.current != null) {
                window.clearTimeout(settledRowTimerRef.current);
            }
        },
        [],
    );

    const rootStyle = useMemo<JSX.CSSProperties>(
        () => ({
            height: toCssSize(height),
            maxHeight: toCssSize(maxHeight),
        }),
        [height, maxHeight],
    );

    const isHydrating =
        !preferencesHydrated || !rowStateHydrated || Boolean(externalHydrating);

    return (
        <>
            <div
                ref={rootRef}
                className={cx(
                    styles.root,
                    variant === "widget" ? styles.widget : styles.full,
                    isHydrating && styles.hydrating,
                    className,
                )}
                style={rootStyle}
            >
                <table
                    className={styles.table}
                    style={{
                        width: `max(100%, ${Math.max(table.getTotalSize(), 1)}px)`,
                    }}
                >
                    <colgroup>
                        {visibleLeafColumns.map((column) => (
                            <col
                                key={column.id}
                                style={{
                                    width: `${column.getSize()}px`,
                                    minWidth: `${column.getSize()}px`,
                                    maxWidth: `${column.getSize()}px`,
                                }}
                            />
                        ))}
                        <col className={styles.fillColumn} />
                    </colgroup>

                    <thead className={styles.head}>
                        {table.getHeaderGroups().map((headerGroup) => (
                            <tr
                                key={headerGroup.id}
                                className={styles.headerRow}
                            >
                                {headerGroup.headers.map((header) => {
                                    if (header.isPlaceholder) {
                                        return (
                                            <th
                                                key={header.id}
                                                style={{
                                                    width: `${header.getSize()}px`,
                                                    minWidth: `${header.getSize()}px`,
                                                    maxWidth: `${header.getSize()}px`,
                                                }}
                                                className={styles.headerCell}
                                            />
                                        );
                                    }

                                    const canDragColumn =
                                        enableColumnReorder &&
                                        !lockedSet.has(header.column.id);
                                    const meta = header.column.columnDef
                                        .meta as TableColumnMeta | undefined;
                                    const alignClassName =
                                        getAlignmentClassName(meta?.align);
                                    const sortState =
                                        header.column.getIsSorted();
                                    const sortDirection =
                                        sortState === false
                                            ? undefined
                                            : sortState;
                                    const canSort =
                                        meta?.sortable === true &&
                                        header.column.getCanSort();
                                    const sortIndicator = sortDirection
                                        ? (meta?.sortIcon?.(sortDirection) ??
                                          (sortDirection === "asc" ? "↑" : "↓"))
                                        : null;

                                    return (
                                        <DraggableHeader
                                            key={header.id}
                                            dragEnabled={canDragColumn}
                                            draggable={canDragColumn}
                                            sticky={
                                                header.column.id ===
                                                stickyColumnId
                                            }
                                            size={header.getSize()}
                                            isDragSource={
                                                draggingColumnId ===
                                                header.column.id
                                            }
                                            isDropTarget={
                                                Boolean(draggingColumnId) &&
                                                dragOverColumnId ===
                                                    header.column.id &&
                                                draggingColumnId !==
                                                    header.column.id
                                            }
                                            isResizing={header.column.getIsResizing()}
                                            onResizeStart={header.getResizeHandler()}
                                            onDragStart={(event) =>
                                                handleColumnDragStart(
                                                    header.column.id,
                                                    event,
                                                )
                                            }
                                            onDragOver={(event) =>
                                                handleColumnDragOver(
                                                    header.column.id,
                                                    event,
                                                )
                                            }
                                            onDrop={handleColumnDrop}
                                            onDragEnd={resetColumnDragState}
                                            onPointerDown={(event) =>
                                                handleColumnPointerDown(
                                                    header.column.id,
                                                    event,
                                                )
                                            }
                                            onPointerMove={
                                                handleColumnPointerMove
                                            }
                                            onPointerUp={handleColumnPointerUp}
                                            onPointerLeave={
                                                handleColumnPointerLeave
                                            }
                                            onPointerCancel={
                                                handleColumnPointerCancel
                                            }
                                            alignmentClassName={alignClassName}
                                        >
                                            {canSort ? (
                                                <button
                                                    type="button"
                                                    draggable={false}
                                                    className={
                                                        styles.sortButton
                                                    }
                                                    onClick={(event) => {
                                                        event.preventDefault();
                                                        event.stopPropagation();

                                                        if (
                                                            sortDirection ===
                                                            "asc"
                                                        ) {
                                                            header.column.toggleSorting(
                                                                true,
                                                            );
                                                            return;
                                                        }

                                                        if (
                                                            sortDirection ===
                                                            "desc"
                                                        ) {
                                                            header.column.clearSorting();
                                                            return;
                                                        }

                                                        header.column.toggleSorting(
                                                            false,
                                                        );
                                                    }}
                                                    onPointerDown={(event) => {
                                                        event.stopPropagation();
                                                    }}
                                                >
                                                    <span
                                                        className={
                                                            styles.headerContent
                                                        }
                                                    >
                                                        {flexRender(
                                                            header.column
                                                                .columnDef
                                                                .header,
                                                            header.getContext(),
                                                        )}
                                                    </span>
                                                    {sortIndicator ? (
                                                        <span
                                                            className={
                                                                styles.sortIndicator
                                                            }
                                                            aria-hidden="true"
                                                        >
                                                            {sortIndicator}
                                                        </span>
                                                    ) : null}
                                                </button>
                                            ) : (
                                                <span
                                                    className={
                                                        styles.headerContent
                                                    }
                                                >
                                                    {flexRender(
                                                        header.column.columnDef
                                                            .header,
                                                        header.getContext(),
                                                    )}
                                                </span>
                                            )}
                                        </DraggableHeader>
                                    );
                                })}

                                <th
                                    className={styles.fillHeaderCell}
                                    aria-hidden="true"
                                />
                            </tr>
                        ))}
                    </thead>

                    <tbody className={styles.body}>
                        {displayRows.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={renderedColumnCount}
                                    className={styles.emptyCell}
                                >
                                    {emptyMessage}
                                </td>
                            </tr>
                        ) : (
                            <>
                                {topVirtualPadding > 0 ? (
                                    <tr
                                        key="virtual-pad-top"
                                        className={styles.virtualPadRow}
                                        aria-hidden="true"
                                    >
                                        <td
                                            colSpan={renderedColumnCount}
                                            className={styles.virtualPadCell}
                                            style={{
                                                height: `${topVirtualPadding}px`,
                                            }}
                                        />
                                    </tr>
                                ) : null}

                                {renderedDisplayRows.map((displayRow) =>
                                    displayRow.kind === "data" ? (
                                        <MemoDraggableDataRow
                                            key={displayRow.id}
                                            rowId={displayRow.id}
                                            row={displayRow.row}
                                            layoutVersion={rowLayoutVersion}
                                            stickyColumnId={stickyColumnId}
                                            draggable={canReorderRows}
                                            isDragSource={
                                                draggingRowId === displayRow.id
                                            }
                                            isDropTarget={
                                                Boolean(draggingRowId) &&
                                                dragOverRowId ===
                                                    displayRow.id &&
                                                draggingRowId !== displayRow.id
                                            }
                                            isSettled={
                                                settledRowId === displayRow.id
                                            }
                                            onRowDragStart={handleRowDragStart}
                                            onRowDragOver={handleRowDragOver}
                                            onRowDrop={handleRowDrop}
                                            onRowDragEnd={handleRowDragEnd}
                                        />
                                    ) : (
                                        <MemoDraggableSpacerRow
                                            key={displayRow.id}
                                            rowId={displayRow.id}
                                            spacer={displayRow.spacer}
                                            colSpan={renderedColumnCount}
                                            draggable={canReorderRows}
                                            isDragSource={
                                                draggingRowId === displayRow.id
                                            }
                                            isDropTarget={
                                                Boolean(draggingRowId) &&
                                                dragOverRowId ===
                                                    displayRow.id &&
                                                draggingRowId !== displayRow.id
                                            }
                                            isSettled={
                                                settledRowId === displayRow.id
                                            }
                                            onRowDragStart={handleRowDragStart}
                                            onRowDragOver={handleRowDragOver}
                                            onRowDrop={handleRowDrop}
                                            onRowDragEnd={handleRowDragEnd}
                                            onRemoveSpacer={
                                                controller.removeSpacer
                                            }
                                        />
                                    ),
                                )}

                                {bottomVirtualPadding > 0 ? (
                                    <tr
                                        key="virtual-pad-bottom"
                                        className={styles.virtualPadRow}
                                        aria-hidden="true"
                                    >
                                        <td
                                            colSpan={renderedColumnCount}
                                            className={styles.virtualPadCell}
                                            style={{
                                                height: `${bottomVirtualPadding}px`,
                                            }}
                                        />
                                    </tr>
                                ) : null}
                            </>
                        )}
                    </tbody>
                </table>
            </div>
        </>
    );
}

export type { TableController, TableProps } from "./types";

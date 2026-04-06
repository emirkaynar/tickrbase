import type { ComponentChildren, JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
    DragDropProvider,
    KeyboardSensor,
    PointerSensor,
    type DragDropEventHandlers,
} from "@dnd-kit/react";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import { isSortableOperation, useSortable } from "@dnd-kit/react/sortable";
import {
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    useReactTable,
    type Row,
    type Updater,
    type VisibilityState,
} from "@tanstack/react-table";
import { Modifier } from "@dnd-kit/abstract";
import type { TableController, TableProps, TableSpacerRow } from "./types";
import {
    createSpacerId,
    isSpacerId,
    normalizeColumnOrder,
    normalizeRowOrder,
    normalizeSpacerId,
    normalizeVisibleColumnIds,
    useTablePersistence,
} from "./useTablePersistence";
import styles from "./Table.module.css";

const ROW_DND_PREFIX = "row:";
const DRAG_HOLD_DELAY_MS = 180;
const DRAG_HOLD_TOLERANCE_PX = 6;

class RestrictVerticalAxisModifier extends Modifier {
    apply(operation: any) {
        return {
            x: 0,
            y: operation.transform.y,
        };
    }
}

type DragEndPayload = Parameters<
    NonNullable<DragDropEventHandlers["onDragEnd"]>
>[0];

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

function toRowDragId(rowId: string): string {
    return `${ROW_DND_PREFIX}${rowId}`;
}

function fromRowDragId(dragId: string): string | null {
    return dragId.startsWith(ROW_DND_PREFIX)
        ? dragId.slice(ROW_DND_PREFIX.length)
        : null;
}

function toCssSize(value: number | string | undefined): string | undefined {
    if (value == null) return undefined;
    return typeof value === "number" ? `${value}px` : value;
}

function getSortIndicator(direction: false | "asc" | "desc"): string {
    if (direction === "asc") return "↑";
    if (direction === "desc") return "↓";
    return "↕";
}

type SortableHeaderProps = {
    draggable: boolean;
    sticky: boolean;
    size: number;
    isDragSource: boolean;
    isDropTarget: boolean;
    sorted: false | "asc" | "desc";
    canSort: boolean;
    isResizing: boolean;
    onToggleSort: () => void;
    onResizeStart: (event: MouseEvent | TouchEvent) => void;
    onDragStart: (event: DragEvent) => void;
    onDragOver: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
    onDragEnd: () => void;
    children: ComponentChildren;
};

function SortableHeader({
    draggable,
    sticky,
    size,
    isDragSource,
    isDropTarget,
    sorted,
    canSort,
    isResizing,
    onToggleSort,
    onResizeStart,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    children,
}: SortableHeaderProps) {
    return (
        <th
            data-draggable={draggable ? "true" : undefined}
            style={{ width: `${size}px`, minWidth: `${size}px` }}
            className={cx(
                styles.headerCell,
                sticky && styles.stickyCell,
                isDragSource && styles.dragSource,
                isDropTarget && styles.dropTarget,
            )}
        >
            <div
                className={styles.headerInner}
                draggable={draggable}
                onDragStart={draggable ? (onDragStart as never) : undefined}
                onDragOver={draggable ? (onDragOver as never) : undefined}
                onDrop={draggable ? (onDrop as never) : undefined}
                onDragEnd={draggable ? (onDragEnd as never) : undefined}
            >
                {canSort ? (
                    <button
                        type="button"
                        className={styles.sortButton}
                        onClick={onToggleSort}
                    >
                        <span className={styles.headerContent}>{children}</span>
                        <span className={styles.sortIndicator}>
                            {getSortIndicator(sorted)}
                        </span>
                    </button>
                ) : (
                    <span className={styles.headerContent}>{children}</span>
                )}
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

type SortableDataRowProps<TData extends object> = {
    id: string;
    index: number;
    row: Row<TData>;
    groupId: string;
    stickyColumnId: string;
    draggable: boolean;
};

function SortableDataRow<TData extends object>({
    id,
    index,
    row,
    groupId,
    stickyColumnId,
    draggable,
}: SortableDataRowProps<TData>) {
    const { ref, isDragSource, isDropTarget } = useSortable({
        id: toRowDragId(id),
        index,
        group: groupId,
        disabled: !draggable,
        modifiers: draggable ? [RestrictVerticalAxisModifier] : undefined,
        feedback: draggable ? "clone" : "default",
        transition: {
            duration: 180,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            idle: true,
        },
    });

    return (
        <tr
            ref={ref as never}
            data-draggable={draggable ? "true" : undefined}
            className={cx(
                styles.bodyRow,
                isDragSource && styles.dragSource,
                isDropTarget && styles.dropTarget,
            )}
        >
            {row.getVisibleCells().map((cell) => {
                const sticky = cell.column.id === stickyColumnId;

                return (
                    <td
                        key={cell.id}
                        style={{
                            width: `${cell.column.getSize()}px`,
                            minWidth: `${cell.column.getSize()}px`,
                        }}
                        className={cx(styles.cell, sticky && styles.stickyCell)}
                    >
                        <div className={styles.cellContent}>
                            <span className={styles.cellValue}>
                                {flexRender(
                                    cell.column.columnDef.cell,
                                    cell.getContext(),
                                )}
                            </span>
                        </div>
                    </td>
                );
            })}
        </tr>
    );
}

type SortableSpacerRowProps = {
    spacer: TableSpacerRow;
    index: number;
    colSpan: number;
    groupId: string;
    draggable: boolean;
};

function SortableSpacerRow({
    spacer,
    index,
    colSpan,
    groupId,
    draggable,
}: SortableSpacerRowProps) {
    const { ref, isDragSource, isDropTarget } = useSortable({
        id: toRowDragId(spacer.id),
        index,
        group: groupId,
        disabled: !draggable,
        modifiers: draggable ? [RestrictVerticalAxisModifier] : undefined,
        feedback: draggable ? "clone" : "default",
        transition: {
            duration: 180,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            idle: true,
        },
    });

    return (
        <tr
            ref={ref as never}
            data-draggable={draggable ? "true" : undefined}
            className={cx(
                styles.spacerRow,
                isDragSource && styles.dragSource,
                isDropTarget && styles.dropTarget,
            )}
        >
            <td colSpan={Math.max(colSpan, 1)} className={styles.spacerCell}>
                <div
                    className={styles.spacer}
                    style={{
                        height: toCssSize(spacer.height ?? 18),
                    }}
                >
                    {spacer.label ? (
                        <span className={styles.spacerLabel}>
                            {spacer.label}
                        </span>
                    ) : (
                        <span className={styles.spacerLine} />
                    )}
                </div>
            </td>
        </tr>
    );
}

export function Table<TData extends object>({
    rows,
    columns,
    getRowId,
    scopeType,
    scopeId,
    tableId,
    variant = "widget",
    className,
    stickyColumnId = "symbol",
    lockedColumnIds = [],
    initialSpacerRows = [],
    emptyMessage = "No rows to display.",
    height,
    maxHeight,
    enableColumnReorder = true,
    enableRowReorder = true,
    disableRowReorderWhenSorted = true,
    onControllerReady,
}: TableProps<TData>) {
    const [draggingColumnId, setDraggingColumnId] = useState("");
    const [dragOverColumnId, setDragOverColumnId] = useState("");
    const draggingColumnIdRef = useRef("");
    const dragOverColumnIdRef = useRef("");

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

    const {
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
    } = useTablePersistence({
        scopeType,
        scopeId,
        tableId,
        allColumnIds,
        lockedColumnIds: normalizedLockedColumnIds,
        rowIds: dataRowIds,
        initialSpacerRows,
    });

    const columnVisibility = useMemo<VisibilityState>(() => {
        const visibleSet = new Set(visibleColumnIds);
        const visibility: VisibilityState = {};

        for (const id of allColumnIds) {
            visibility[id] = lockedSet.has(id) ? true : visibleSet.has(id);
        }

        return visibility;
    }, [visibleColumnIds, allColumnIds, lockedSet]);

    const table = useReactTable({
        data: rows,
        columns,
        getRowId: (row, index) => getRowId(row, index),
        state: {
            sorting,
            columnOrder,
            columnSizing: columnWidths,
            columnVisibility,
        },
        onSortingChange: setSorting,
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
        columnResizeMode: "onChange",
        enableColumnResizing: true,
    });

    const visibleLeafColumns = table.getVisibleLeafColumns();
    const visibleColumnCount = Math.max(visibleLeafColumns.length, 1);

    const rowGroupId = `${instanceId}:rows`;

    const rowMap = useMemo(() => {
        const map = new Map<string, Row<TData>>();
        for (const row of table.getRowModel().rows) {
            map.set(row.id, row);
        }
        return map;
    }, [table, rows, sorting, columnVisibility]);

    const spacerMap = useMemo(() => {
        return new Map(spacers.map((spacer) => [spacer.id, spacer]));
    }, [spacers]);

    const normalizedBaseRowOrder = useMemo(
        () =>
            normalizeRowOrder(
                rowOrder,
                dataRowIds,
                spacers.map((spacer) => spacer.id),
            ),
        [rowOrder, dataRowIds, spacers],
    );

    const sortedDataIds = useMemo(
        () => table.getRowModel().rows.map((row) => row.id),
        [table, rows, sorting, columnVisibility],
    );

    const hasActiveSorting = sorting.length > 0;

    const displayRowIds = useMemo(() => {
        if (!hasActiveSorting) {
            return normalizedBaseRowOrder;
        }

        const queue = [...sortedDataIds];
        const next: string[] = [];

        for (const token of normalizedBaseRowOrder) {
            if (isSpacerId(token)) {
                if (spacerMap.has(token)) next.push(token);
                continue;
            }

            const id = queue.shift();
            if (id) next.push(id);
        }

        next.push(...queue);
        return next;
    }, [hasActiveSorting, sortedDataIds, normalizedBaseRowOrder, spacerMap]);

    const canReorderRows =
        enableRowReorder && (!disableRowReorderWhenSorted || !hasActiveSorting);

    const resetColumnDragState = () => {
        draggingColumnIdRef.current = "";
        dragOverColumnIdRef.current = "";
        setDraggingColumnId("");
        setDragOverColumnId("");
    };

    const handleColumnDragStart = (columnId: string, event: DragEvent) => {
        if (!enableColumnReorder) return;

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
        if (!enableColumnReorder) return;

        event.preventDefault();

        const sourceColumnId =
            draggingColumnIdRef.current ||
            event.dataTransfer?.getData("text/plain") ||
            "";

        if (!sourceColumnId || sourceColumnId === targetColumnId) return;
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

    const handleDragEnd = (event: DragEndPayload) => {
        const operation = event.operation;
        if (event.canceled || !isSortableOperation(operation)) return;

        const { source, target } = operation;
        if (!target) return;
        if (!source) return;

        if (source.group === rowGroupId && target.group === rowGroupId) {
            const sourceId = fromRowDragId(String(source.id));
            const targetId = fromRowDragId(String(target.id));
            if (!sourceId || !targetId) return;

            setRowOrder((prev) => {
                const normalized = normalizeRowOrder(
                    prev,
                    dataRowIds,
                    spacers.map((spacer) => spacer.id),
                );
                return moveById(normalized, sourceId, targetId);
            });
        }
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

                setSpacers((prev) => {
                    if (prev.some((item) => item.id === id)) return prev;
                    return [
                        ...prev,
                        {
                            id,
                            label: spacer?.label,
                            height: spacer?.height,
                        },
                    ];
                });

                setRowOrder((prev) =>
                    prev.includes(id) ? prev : [...prev, id],
                );

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
            resetToDefaults,
            setRowOrder,
            setSpacers,
            setVisibleColumnIds,
            visibleColumnIds,
        ],
    );

    useEffect(() => {
        if (!onControllerReady) return;
        onControllerReady(controller);
    }, [controller, onControllerReady]);

    const rootStyle = useMemo<JSX.CSSProperties>(
        () => ({
            height: toCssSize(height),
            maxHeight: toCssSize(maxHeight),
        }),
        [height, maxHeight],
    );

    const sensors = useMemo(
        () => [
            PointerSensor.configure({
                activationConstraints: [
                    new PointerActivationConstraints.Delay({
                        value: DRAG_HOLD_DELAY_MS,
                        tolerance: DRAG_HOLD_TOLERANCE_PX,
                    }),
                ],
            }),
            KeyboardSensor,
        ],
        [],
    );

    if (!hydrated) {
        return (
            <div
                className={cx(
                    styles.root,
                    variant === "widget" ? styles.widget : styles.full,
                    className,
                )}
                style={rootStyle}
            >
                <div className={styles.loading}>Loading table...</div>
            </div>
        );
    }

    return (
        <div
            className={cx(
                styles.root,
                variant === "widget" ? styles.widget : styles.full,
                className,
            )}
            style={rootStyle}
        >
            <DragDropProvider sensors={sensors} onDragEnd={handleDragEnd}>
                <table
                    className={styles.table}
                    style={{
                        width: `max(100%, ${table.getTotalSize()}px)`,
                    }}
                >
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
                                                }}
                                                className={styles.headerCell}
                                            />
                                        );
                                    }

                                    return (
                                        <SortableHeader
                                            key={header.id}
                                            draggable={enableColumnReorder}
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
                                            sorted={
                                                header.column.getIsSorted() as
                                                    | false
                                                    | "asc"
                                                    | "desc"
                                            }
                                            canSort={
                                                header.column.getCanSort() &&
                                                (
                                                    header.column.columnDef
                                                        .meta as
                                                        | {
                                                              sortable?: boolean;
                                                          }
                                                        | undefined
                                                )?.sortable !== false
                                            }
                                            isResizing={header.column.getIsResizing()}
                                            onToggleSort={() =>
                                                header.column.toggleSorting()
                                            }
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
                                        >
                                            {flexRender(
                                                header.column.columnDef.header,
                                                header.getContext(),
                                            )}
                                        </SortableHeader>
                                    );
                                })}
                            </tr>
                        ))}
                    </thead>

                    <tbody className={styles.body}>
                        {displayRowIds.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={visibleColumnCount}
                                    className={styles.emptyCell}
                                >
                                    {emptyMessage}
                                </td>
                            </tr>
                        ) : (
                            displayRowIds.map((id, index) => {
                                if (isSpacerId(id)) {
                                    const spacer = spacerMap.get(id);
                                    if (!spacer) return null;

                                    return (
                                        <SortableSpacerRow
                                            key={id}
                                            spacer={spacer}
                                            index={index}
                                            colSpan={visibleColumnCount}
                                            groupId={rowGroupId}
                                            draggable={canReorderRows}
                                        />
                                    );
                                }

                                const row = rowMap.get(id);
                                if (!row) return null;

                                return (
                                    <SortableDataRow
                                        key={id}
                                        id={id}
                                        index={index}
                                        row={row}
                                        groupId={rowGroupId}
                                        stickyColumnId={stickyColumnId}
                                        draggable={canReorderRows}
                                    />
                                );
                            })
                        )}
                    </tbody>
                </table>
            </DragDropProvider>
        </div>
    );
}

export type { TableController, TableProps } from "./types";

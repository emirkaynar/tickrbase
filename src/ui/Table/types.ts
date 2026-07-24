import type { ColumnDef, SortingState } from "@tanstack/react-table";
import type { ComponentChildren } from "preact";

export type TableVariant = "widget" | "full";

export type TableScopeType = "widget" | "page";

export type TableSpacerRow = {
    id: string;
    label?: string;
    height?: number;
};

export type TableColumnMeta = {
    label?: string;
    locked?: boolean;
    removable?: boolean;
    sortable?: boolean;
    align?: "left" | "center" | "right";
    sortIcon?: (direction: "asc" | "desc" | undefined) => ComponentChildren;
};

export type TableColumnDef<TData extends object> = ColumnDef<TData, unknown> & {
    id: string;
    meta?: TableColumnMeta;
};

export type TablePersistedState = {
    visibleColumnIds: string[];
    columnOrder: string[];
    columnWidths: Record<string, number>;
    rowOrder: string[];
    spacers: TableSpacerRow[];
    sorting: SortingState;
};

export type TableColumnOption = {
    id: string;
    label: string;
    visible: boolean;
    locked: boolean;
    removable: boolean;
};

export type TableController = {
    getColumnOptions: () => TableColumnOption[];
    getAddableColumns: () => TableColumnOption[];
    showColumn: (id: string) => void;
    hideColumn: (id: string) => void;
    toggleColumn: (id: string) => void;
    addSpacer: (spacer?: Partial<TableSpacerRow>) => string;
    removeSpacer: (id: string) => void;
    resetLayout: () => void;
};

export type TableScope = {
    scopeType: TableScopeType;
    scopeId: string;
    tableId: string;
};

export type TableProps<TData extends object> = {
    rows: TData[];
    columns: TableColumnDef<TData>[];
    getRowId: (row: TData, index: number) => string;
    scopeType: TableScopeType;
    scopeId: string;
    tableId: string;
    variant?: TableVariant;
    className?: string;
    stickyColumnId?: string;
    lockedColumnIds?: string[];
    initialSpacerRows?: TableSpacerRow[];
    emptyMessage?: string;
    height?: number | string;
    maxHeight?: number | string;
    enableColumnReorder?: boolean;
    enableRowReorder?: boolean;
    disableRowReorderWhenSorted?: boolean;
    rowStateId?: string;
    isHydrating?: boolean;
    onControllerReady?: (controller: TableController) => void;
};

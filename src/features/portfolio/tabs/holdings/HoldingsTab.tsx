import { useCallback, useMemo, useRef, useState } from "preact/hooks";
import {
    ArrowDown,
    ArrowDownAZ,
    ArrowUp,
    ArrowUpAZ,
    Columns3,
} from "lucide-react";
import type { PositionResponse } from "../../../../services/types";
import {
    ReturnBreakdownBadge,
    Select,
    Skeleton,
    SymbolCell,
    Table,
    Tooltip,
    type SelectItem,
    type TableColumnDef,
    type TableColumnOption,
    type TableController,
} from "../../../../ui";
import {
    formatCurrency,
    formatPercent,
    isCrossCurrency,
} from "../../../../utils";
import { computeReturnBreakdown } from "../../../../utils/pnlBreakdown";
import { DualCurrencyCell } from "../../../../ui/Table/decorators/DualCurrencyCell";
import sharedPortfolioStyles from "../../PortfolioPage.module.css";

const HOLDINGS_LOCKED_COLUMN_IDS = ["ticker"];
const HOLDINGS_GET_ROW_ID = (row: PositionResponse) => row.id;

interface HoldingsTabProps {
    positions: PositionResponse[];
    loading: boolean;
    error: string;
    baseCurrency?: string;
    showNativeSubtitles?: boolean;
}

export function HoldingsTab({
    positions,
    loading,
    error,
    baseCurrency = "TRY",
    showNativeSubtitles = true,
}: HoldingsTabProps) {
    const tableControllerRef = useRef<TableController | null>(null);
    const [hasController, setHasController] = useState(false);
    const [columnOptions, setColumnOptions] = useState<TableColumnOption[]>([]);

    const columns = useMemo<TableColumnDef<PositionResponse>[]>(
        () => [
            {
                id: "ticker",
                accessorKey: "ticker",
                header: "Symbol",
                meta: {
                    label: "Symbol",
                    locked: true,
                    removable: false,
                    sortable: true,
                    sortIcon: (direction) =>
                        direction === "asc" ? (
                            <ArrowUpAZ size={14} />
                        ) : (
                            <ArrowDownAZ size={14} />
                        ),
                },
                size: 140,
                minSize: 110,
                cell: ({ row }) => (
                    <SymbolCell
                        symbol={row.original.ticker}
                        subtitle={row.original.asset_class}
                        currency={row.original.currency}
                        baseCurrency={baseCurrency}
                        fxRate={row.original.fx_rate_to_base}
                    />
                ),
            },
            {
                id: "quantity",
                accessorKey: "quantity",
                header: "Quantity",
                meta: {
                    label: "Quantity",
                    removable: true,
                    sortable: true,
                    sortIcon: (direction) =>
                        direction === "asc" ? (
                            <ArrowUp size={14} />
                        ) : (
                            <ArrowDown size={14} />
                        ),
                },
                size: 110,
                minSize: 90,
                cell: ({ getValue }) => (
                    <span>{(getValue() as number).toLocaleString()}</span>
                ),
            },
            {
                id: "avgPrice",
                accessorKey: "avg_price",
                header: "Avg Price",
                meta: {
                    label: "Avg Price",
                    removable: true,
                    sortable: true,
                    sortIcon: (direction) =>
                        direction === "asc" ? (
                            <ArrowUp size={14} />
                        ) : (
                            <ArrowDown size={14} />
                        ),
                },
                size: 120,
                minSize: 100,
                cell: ({ row }) => (
                    <DualCurrencyCell
                        primaryValue={row.original.avg_price}
                        primaryCurrency={baseCurrency}
                        nativeValue={
                            row.original.avg_price_native ??
                            row.original.avg_price
                        }
                        nativeCurrency={row.original.currency}
                        showSubtitle={showNativeSubtitles}
                    />
                ),
            },
            {
                id: "currentPrice",
                accessorKey: "current_price",
                header: "Current",
                meta: {
                    label: "Current Price",
                    removable: true,
                    sortable: true,
                    sortIcon: (direction) =>
                        direction === "asc" ? (
                            <ArrowUp size={14} />
                        ) : (
                            <ArrowDown size={14} />
                        ),
                },
                size: 120,
                minSize: 100,
                cell: ({ row }) => (
                    <DualCurrencyCell
                        primaryValue={row.original.current_price}
                        primaryCurrency={baseCurrency}
                        nativeValue={
                            row.original.current_price_native ??
                            row.original.current_price
                        }
                        nativeCurrency={row.original.currency}
                        showSubtitle={showNativeSubtitles}
                    />
                ),
            },
            {
                id: "marketValue",
                accessorKey: "market_value",
                header: "Market Value",
                meta: {
                    label: "Market Value",
                    removable: true,
                    sortable: true,
                    sortIcon: (direction) =>
                        direction === "asc" ? (
                            <ArrowUp size={14} />
                        ) : (
                            <ArrowDown size={14} />
                        ),
                },
                size: 130,
                minSize: 110,
                cell: ({ row }) => (
                    <DualCurrencyCell
                        primaryValue={row.original.market_value}
                        primaryCurrency={baseCurrency}
                        nativeValue={
                            row.original.market_value_native ??
                            row.original.market_value
                        }
                        nativeCurrency={row.original.currency}
                        showSubtitle={showNativeSubtitles}
                        bold
                    />
                ),
            },
            {
                id: "pnl",
                accessorKey: "pnl",
                header: "P/L",
                meta: {
                    label: "P/L",
                    removable: true,
                    sortable: true,
                    sortIcon: (direction) =>
                        direction === "asc" ? (
                            <ArrowUp size={14} />
                        ) : (
                            <ArrowDown size={14} />
                        ),
                },
                size: 130,
                minSize: 110,
                cell: ({ row }) => {
                    const val = row.original.pnl;
                    const cross = isCrossCurrency(row.original.currency, baseCurrency);
                    const data = computeReturnBreakdown(row.original, baseCurrency);
                    const formattedBase = formatCurrency(val, baseCurrency, {
                        currency: baseCurrency, compact: false
                    });

                    return (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span
                                className={
                                    val >= 0
                                        ? sharedPortfolioStyles.pnlPositive
                                        : sharedPortfolioStyles.pnlNegative
                                }
                            >
                                {val > 0 ? `+${formattedBase}` : formattedBase}
                            </span>
                            {cross && <ReturnBreakdownBadge data={data} mode="abs" />}
                        </div>
                    );
                },
            },
            {
                id: "pnlPercent",
                accessorKey: "pnl_percent",
                header: "P/L %",
                meta: {
                    label: "P/L %",
                    removable: true,
                    sortable: true,
                    sortIcon: (direction) =>
                        direction === "asc" ? (
                            <ArrowUp size={14} />
                        ) : (
                            <ArrowDown size={14} />
                        ),
                },
                size: 110,
                minSize: 90,
                cell: ({ row }) => {
                    const data = computeReturnBreakdown(row.original, baseCurrency);
                    const displayPct = data.totalReturnPct;
                    const cross = isCrossCurrency(row.original.currency, baseCurrency);

                    return (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span
                                className={
                                    displayPct >= 0
                                        ? sharedPortfolioStyles.pnlPositive
                                        : sharedPortfolioStyles.pnlNegative
                                }
                            >
                                {formatPercent(displayPct)}
                            </span>
                            {cross && <ReturnBreakdownBadge data={data} mode="pct" />}
                        </div>
                    );
                },
            },
            {
                id: "weight",
                accessorKey: "weight_percent",
                header: "Weight %",
                meta: {
                    label: "Weight %",
                    removable: true,
                    sortable: true,
                    sortIcon: (direction) =>
                        direction === "asc" ? (
                            <ArrowUp size={14} />
                        ) : (
                            <ArrowDown size={14} />
                        ),
                },
                size: 100,
                minSize: 85,
                cell: ({ getValue }) => (
                    <span>
                        {formatPercent(getValue() as number, {
                            signDisplay: "auto",
                        })}
                    </span>
                ),
            },
        ],
        [baseCurrency],
    );

    const selectorOrderByColumnId = useMemo(() => {
        const order = new Map<string, number>();
        for (const [index, column] of columns.entries()) {
            if (!column.id) continue;
            order.set(column.id, index);
        }
        return order;
    }, [columns]);

    const toSelectorOrderedOptions = useCallback(
        (next: TableColumnOption[]): TableColumnOption[] => {
            const sorted = [...next];
            sorted.sort((left, right) => {
                const leftOrder = selectorOrderByColumnId.get(left.id);
                const rightOrder = selectorOrderByColumnId.get(right.id);

                if (leftOrder == null && rightOrder == null) {
                    return left.label.localeCompare(right.label);
                }
                if (leftOrder == null) return 1;
                if (rightOrder == null) return -1;
                return leftOrder - rightOrder;
            });
            return sorted;
        },
        [selectorOrderByColumnId],
    );

    const setColumnOptionsIfChanged = useCallback(
        (next: TableColumnOption[]) => {
            const ordered = toSelectorOrderedOptions(next);
            setColumnOptions((prev) => {
                if (prev === ordered) return prev;
                if (prev.length !== ordered.length) return ordered;
                for (let i = 0; i < prev.length; i++) {
                    const a = prev[i];
                    const b = ordered[i];
                    if (
                        !b ||
                        a.id !== b.id ||
                        a.visible !== b.visible ||
                        a.locked !== b.locked
                    ) {
                        return ordered;
                    }
                }
                return prev;
            });
        },
        [toSelectorOrderedOptions],
    );

    const handleControllerReady = useCallback(
        (controller: TableController) => {
            tableControllerRef.current = controller;
            setHasController(true);
            setColumnOptionsIfChanged(controller.getColumnOptions());
        },
        [setColumnOptionsIfChanged],
    );

    const refreshColumnOptions = useCallback(() => {
        const c = tableControllerRef.current;
        if (!c) return;
        setColumnOptionsIfChanged(c.getColumnOptions());
    }, [setColumnOptionsIfChanged]);

    const handleVisibleColumnsChange = useCallback(
        (nextVisibleIds: string[]) => {
            const c = tableControllerRef.current;
            if (!c) return;
            const nextSet = new Set(nextVisibleIds);
            for (const opt of columnOptions) {
                if (opt.locked) continue;
                const shouldBeVisible = nextSet.has(opt.id);
                if (shouldBeVisible === opt.visible) continue;
                if (shouldBeVisible) c.showColumn(opt.id);
                else c.hideColumn(opt.id);
            }
        },
        [columnOptions],
    );

    const columnItems = useMemo<SelectItem[]>(
        () =>
            columnOptions.map((opt) => ({
                label: opt.label,
                value: opt.id,
                disabled: opt.locked,
                locked: opt.locked,
            })),
        [columnOptions],
    );

    const visibleColumnIds = useMemo(
        () => columnOptions.filter((o) => o.visible).map((o) => o.id),
        [columnOptions],
    );

    if (loading) {
        return <Skeleton height={360} width="100%" />;
    }

    if (error) {
        return <div className={sharedPortfolioStyles.error}>{error}</div>;
    }

    return (
        <>
            <div className={sharedPortfolioStyles.headerContainer}>
                <span className={sharedPortfolioStyles.header}>Holdings</span>
                <Tooltip content="Columns">
                    <Select
                        items={columnItems}
                        multiple
                        values={visibleColumnIds}
                        onValuesChange={handleVisibleColumnsChange}
                        onOpenChange={(open) => {
                            if (open) refreshColumnOptions();
                        }}
                        placement="bottom-end"
                        variant="full"
                        triggerVariant="icon"
                        triggerIcon={<Columns3 />}
                        triggerLabel="Columns"
                        disabled={!hasController}
                    />
                </Tooltip>
            </div>

            <div className={sharedPortfolioStyles.tableContainer}>
                <Table
                    rows={positions}
                    columns={columns}
                    getRowId={HOLDINGS_GET_ROW_ID}
                    scopeType="page"
                    scopeId="portfolio"
                    tableId="positions-v3"
                    variant="full"
                    stickyColumnId="ticker"
                    lockedColumnIds={HOLDINGS_LOCKED_COLUMN_IDS}
                    maxHeight="calc(100vh - var(--topbar-height) - 280px)"
                    enableColumnReorder
                    emptyMessage="No positions in this portfolio yet. Click '+ Add Trade' to get started."
                    onControllerReady={handleControllerReady}
                />
            </div>
        </>
    );
}

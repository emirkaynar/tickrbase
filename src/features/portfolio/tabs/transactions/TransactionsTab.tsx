import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "preact/hooks";
import {
    ArrowDown,
    ArrowDownAZ,
    ArrowUp,
    ArrowUpAZ,
    Columns3,
    Pencil,
    Trash2,
} from "lucide-react";
import {
    deleteTransaction,
    listTransactions,
} from "../../../../services/portfolio";
import type {
    PortfolioSummary,
    TransactionResponse,
} from "../../../../services/types";
import {
    Badge,
    Button,
    Dialog,
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
import { isCrossCurrency } from "../../../../utils";
import { computeHistoricReturnBreakdown } from "../../../../utils/pnlBreakdown";
import { DualCurrencyCell } from "../../../../ui/Table/decorators/DualCurrencyCell";
import { TradeTransactionModal } from "../../dialogs/TradeTransactionModal";
import styles from "../../PortfolioPage.module.css";
import sharedPortfolioStyles from "../../PortfolioPage.module.css";
import tabStyles from "./TransactionsTab.module.css";

const LEDGER_LOCKED_COLUMN_IDS = ["ticker", "actions"];
const LEDGER_PINNED_COLUMNS = { left: ["ticker"], right: ["actions"] };
const LEDGER_GET_ROW_ID = (row: TransactionResponse) => row.id;

interface LedgerTabProps {
    portfolioId: string;
    portfolios: PortfolioSummary[];
    onRefresh: () => void;
    baseCurrency?: string;
    showNativeSubtitles?: boolean;
}

export function TransactionTab({
    portfolioId,
    portfolios,
    onRefresh,
    baseCurrency = "TRY",
    showNativeSubtitles = true,
}: LedgerTabProps) {
    const [transactions, setTransactions] = useState<TransactionResponse[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [editingTx, setEditingTx] = useState<TransactionResponse | null>(
        null,
    );
    const [deletingTx, setDeletingTx] = useState<TransactionResponse | null>(
        null,
    );

    const tableControllerRef = useRef<TableController | null>(null);
    const [hasController, setHasController] = useState(false);
    const [columnOptions, setColumnOptions] = useState<TableColumnOption[]>([]);

    const loadTransactions = async (signal?: AbortSignal) => {
        try {
            setLoading(true);
            setError("");
            const id = portfolioId || undefined;
            const data = await listTransactions(id, signal);
            setTransactions(data);
        } catch {
            if (!signal?.aborted) setError("Could not load transactions.");
        } finally {
            if (!signal?.aborted) setLoading(false);
        }
    };

    useEffect(() => {
        const controller = new AbortController();
        void loadTransactions(controller.signal);
        return () => controller.abort();
    }, [portfolioId, baseCurrency]);

    const handleDeleteTransaction = useCallback(async () => {
        if (!deletingTx) return;
        try {
            await deleteTransaction(deletingTx.id);
            setDeletingTx(null);
            void loadTransactions();
            onRefresh();
        } catch {
            setError("Could not delete transaction.");
        }
    }, [deletingTx, onRefresh]);

    const columns = useMemo<TableColumnDef<TransactionResponse>[]>(
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
                cell: ({ row, getValue }) => (
                    <SymbolCell
                        symbol={getValue() as string}
                        subtitle={row.original.asset_class}
                        currency={row.original.currency}
                        baseCurrency={baseCurrency}
                        fxRate={row.original.fx_rate_to_base}
                        isHistoricFx={true}
                    />
                ),
            },
            {
                id: "type",
                accessorKey: "type",
                header: "Type",
                meta: {
                    label: "Type",
                    removable: true,
                    sortable: true,
                    sortIcon: (direction) =>
                        direction === "asc" ? (
                            <ArrowUpAZ size={14} />
                        ) : (
                            <ArrowDownAZ size={14} />
                        ),
                },
                size: 90,
                minSize: 75,
                cell: ({ getValue }) => {
                    const type = getValue() as string;
                    return (
                        <span>
                            <Badge
                                variant={
                                    type === "BUY"
                                        ? "bull"
                                        : type === "SELL"
                                          ? "bear"
                                          : "accent"
                                }
                            >
                                {type}
                            </Badge>
                        </span>
                    );
                },
            },
            {
                id: "date",
                accessorKey: "executed_at",
                header: "Date",
                meta: {
                    label: "Date",
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
                sortingFn: (rowA, rowB, columnId) => {
                    const rawA = rowA.getValue<number>(columnId) ?? 0;
                    const rawB = rowB.getValue<number>(columnId) ?? 0;
                    const msA = rawA > 1e11 ? rawA : rawA * 1000;
                    const msB = rawB > 1e11 ? rawB : rawB * 1000;
                    return msA - msB;
                },
                cell: ({ getValue }) => {
                    const ts = getValue() as number;
                    const ms = ts > 1e11 ? ts : ts * 1000;
                    return (
                        <span className={sharedPortfolioStyles.cellTertiary}>
                            {new Date(ms).toLocaleDateString()}
                        </span>
                    );
                },
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
                size: 90,
                minSize: 75,
                cell: ({ getValue }) => (
                    <span className={sharedPortfolioStyles.cellSecondary}>
                        {(getValue() as number).toLocaleString()}
                    </span>
                ),
            },
            {
                id: "unit_price",
                accessorKey: "unit_price",
                header: "Price",
                meta: {
                    label: "Price",
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
                cell: ({ row }) => (
                    <DualCurrencyCell
                        primaryValue={
                            row.original.unit_price_base ??
                            row.original.unit_price *
                                row.original.fx_rate_to_base
                        }
                        primaryCurrency={baseCurrency}
                        nativeValue={row.original.unit_price}
                        nativeCurrency={row.original.currency}
                        showSubtitle={showNativeSubtitles}
                    />
                ),
            },
            {
                id: "fee",
                accessorKey: "fee",
                header: "Fee",
                meta: {
                    label: "Fee",
                    removable: true,
                    sortable: true,
                    sortIcon: (direction) =>
                        direction === "asc" ? (
                            <ArrowUp size={14} />
                        ) : (
                            <ArrowDown size={14} />
                        ),
                },
                size: 90,
                minSize: 75,
                cell: ({ row }) =>
                    row.original.fee === 0 ? (
                        <span className={sharedPortfolioStyles.cellTertiary}>
                            —
                        </span>
                    ) : (
                        <DualCurrencyCell
                            primaryValue={
                                row.original.fee * row.original.fx_rate_to_base
                            }
                            primaryCurrency={baseCurrency}
                            nativeValue={row.original.fee}
                            nativeCurrency={row.original.currency}
                            showSubtitle={showNativeSubtitles}
                        />
                    ),
            },
            {
                id: "currency",
                accessorKey: "currency",
                header: "Currency",
                meta: {
                    label: "Currency",
                    removable: true,
                    sortable: true,
                    sortIcon: (direction) =>
                        direction === "asc" ? (
                            <ArrowUpAZ size={14} />
                        ) : (
                            <ArrowDownAZ size={14} />
                        ),
                },
                size: 65,
                minSize: 55,
                cell: ({ getValue }) => (
                    <span className={sharedPortfolioStyles.cellTertiary}>
                        {getValue() as string}
                    </span>
                ),
            },
            {
                id: "realized_pnl",
                accessorKey: "realized_pnl",
                header: "Realized P/L",
                meta: {
                    label: "Realized P/L",
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
                cell: ({ row }) => {
                    const val = row.original.realized_pnl;
                    if (val == null || val === 0)
                        return (
                            <span
                                className={sharedPortfolioStyles.cellTertiary}
                            >
                                —
                            </span>
                        );
                    const valBase =
                        row.original.realized_pnl_base ??
                        val * row.original.fx_rate_to_base;
                    const cross = isCrossCurrency(row.original.currency, baseCurrency);
                    const historicData = computeHistoricReturnBreakdown(row.original, baseCurrency);

                    return (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <DualCurrencyCell
                                primaryValue={valBase}
                                primaryCurrency={baseCurrency}
                                nativeValue={val}
                                nativeCurrency={row.original.currency}
                                showSubtitle={showNativeSubtitles}
                                isPositive={val >= 0}
                            />
                            {cross && (
                                <ReturnBreakdownBadge data={historicData} mode="historic" />
                            )}
                        </div>
                    );
                },
            },
            {
                id: "notes",
                accessorKey: "notes",
                header: "Notes",
                meta: {
                    label: "Notes",
                    removable: true,
                    sortable: true,
                    sortIcon: (direction) =>
                        direction === "asc" ? (
                            <ArrowUpAZ size={14} />
                        ) : (
                            <ArrowDownAZ size={14} />
                        ),
                },
                size: 160,
                minSize: 100,
                cell: ({ getValue }) => (
                    <span className={sharedPortfolioStyles.cellNotes}>
                        {getValue() !== null ? (
                            <Tooltip
                                variant="long"
                                content={(getValue() as string | null) || "—"}
                            >
                                {(getValue() as string | null) || "—"}
                            </Tooltip>
                        ) : (
                            "—"
                        )}
                    </span>
                ),
            },
            {
                id: "actions",
                header: "",
                meta: { label: "Actions", locked: true, removable: false },
                size: 60,
                minSize: 60,
                cell: ({ row }) => (
                    <div className={tabStyles.actionButtons}>
                        <Tooltip content="Edit transaction">
                            <Button
                                variant="ghost"
                                size="icon"
                                className={tabStyles.rowEditButton}
                                onClick={() => setEditingTx(row.original)}
                                aria-label="Edit transaction"
                            >
                                <Pencil size={13} />
                            </Button>
                        </Tooltip>
                        <Tooltip content="Delete transaction">
                            <Button
                                variant="ghost"
                                size="icon"
                                className={tabStyles.rowDeleteButton}
                                onClick={() => setDeletingTx(row.original)}
                                aria-label="Delete transaction"
                            >
                                <Trash2 size={13} />
                            </Button>
                        </Tooltip>
                    </div>
                ),
            },
        ],
        [baseCurrency, showNativeSubtitles],
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

    if (loading) return <Skeleton height={360} width="100%" />;
    if (error) return <div className={styles.error}>{error}</div>;

    return (
        <>
            <div className={sharedPortfolioStyles.headerContainer}>
                <span className={sharedPortfolioStyles.header}>Hello</span>
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
                    rows={transactions}
                    columns={columns}
                    getRowId={LEDGER_GET_ROW_ID}
                    scopeType="page"
                    scopeId="portfolio-ledger"
                    tableId="ledger-v1"
                    variant="full"
                    pinnedColumns={LEDGER_PINNED_COLUMNS}
                    lockedColumnIds={LEDGER_LOCKED_COLUMN_IDS}
                    maxHeight="calc(100vh - var(--topbar-height) - 280px)"
                    enableColumnReorder
                    emptyMessage="No transactions recorded yet. Click '+ Add Trade' in the header to start."
                    onControllerReady={handleControllerReady}
                />

                {editingTx && (
                    <TradeTransactionModal
                        open={true}
                        onClose={() => setEditingTx(null)}
                        portfolios={portfolios}
                        activePortfolioId={portfolioId}
                        initialTransaction={editingTx}
                        onSaved={() => {
                            setEditingTx(null);
                            void loadTransactions();
                            onRefresh();
                        }}
                    />
                )}

                <Dialog
                    open={deletingTx !== null}
                    onClose={() => setDeletingTx(null)}
                    title="Delete Transaction"
                    description={`Are you sure you want to delete this ${deletingTx?.type || ""} transaction for ${deletingTx?.ticker || ""}?`}
                >
                    <div className={tabStyles.deleteDialogActions}>
                        <Button onClick={() => setDeletingTx(null)}>
                            Cancel
                        </Button>
                        <Button
                            variant="solid"
                            onClick={() => void handleDeleteTransaction()}
                        >
                            Delete
                        </Button>
                    </div>
                </Dialog>
            </div>
        </>
    );
}

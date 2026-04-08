import { useEffect, useMemo, useState } from "preact/hooks";
import { listPortfolio } from "../../services/portfolio";
import type { PortfolioPosition } from "../../services/types";
import { Table, type TableColumnDef } from "../../ui";
import styles from "./PortfolioPage.module.css";

const PRICE_FORMATTER = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

const QUANTITY_FORMATTER = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
});

const PERCENT_FORMATTER = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

function formatPrice(value: number): string {
    return PRICE_FORMATTER.format(value);
}

function formatQuantity(value: number): string {
    return QUANTITY_FORMATTER.format(value);
}

function formatPercent(value: number): string {
    return `${PERCENT_FORMATTER.format(value)}%`;
}

export function PortfolioPage() {
    const [rows, setRows] = useState<PortfolioPosition[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        const controller = new AbortController();

        void (async () => {
            try {
                setLoading(true);
                setError("");
                const data = await listPortfolio(controller.signal);
                setRows(data);
            } catch {
                if (!controller.signal.aborted) {
                    setError("Could not load portfolio positions.");
                }
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false);
                }
            }
        })();

        return () => controller.abort();
    }, []);

    const columns = useMemo<TableColumnDef<PortfolioPosition>[]>(
        () => [
            {
                id: "symbol",
                accessorKey: "ticker",
                header: "Symbol",
                meta: { label: "Symbol", locked: true, removable: false },
                size: 140,
                minSize: 110,
                cell: ({ row }) => (
                    <span className={styles.symbolCell}>
                        {row.original.ticker}
                    </span>
                ),
            },
            {
                id: "quantity",
                accessorKey: "quantity",
                header: "Quantity",
                meta: { label: "Quantity" },
                size: 140,
                minSize: 120,
                cell: ({ getValue }) => (
                    <span>{formatQuantity(getValue() as number)}</span>
                ),
            },
            {
                id: "avgPrice",
                accessorKey: "avg_price",
                header: "Avg Price",
                meta: { label: "Avg Price" },
                size: 120,
                minSize: 110,
                cell: ({ getValue }) => (
                    <span>{formatPrice(getValue() as number)}</span>
                ),
            },
            {
                id: "currentPrice",
                accessorKey: "current_price",
                header: "Current",
                meta: { label: "Current" },
                size: 120,
                minSize: 110,
                cell: ({ getValue }) => (
                    <span>{formatPrice(getValue() as number)}</span>
                ),
            },
            {
                id: "pnl",
                accessorKey: "pnl",
                header: "P/L",
                meta: { label: "P/L" },
                size: 120,
                minSize: 110,
                cell: ({ getValue }) => {
                    const value = getValue() as number;
                    return (
                        <span
                            className={
                                value >= 0
                                    ? styles.pnlPositive
                                    : styles.pnlNegative
                            }
                        >
                            {formatPrice(value)}
                        </span>
                    );
                },
            },
            {
                id: "pnlPercent",
                accessorKey: "pnl_percent",
                header: "P/L %",
                meta: { label: "P/L %" },
                size: 110,
                minSize: 100,
                cell: ({ getValue }) => {
                    const value = getValue() as number;
                    return (
                        <span
                            className={
                                value >= 0
                                    ? styles.pnlPositive
                                    : styles.pnlNegative
                            }
                        >
                            {formatPercent(value)}
                        </span>
                    );
                },
            },
        ],
        [],
    );

    return (
        <div className={styles.root}>
            <div className={styles.header}>
                <h1 className={styles.title}>Portfolio</h1>
                <p className={styles.subtitle}>
                    Track and reorder positions with persisted table layouts.
                </p>
            </div>

            <div className={styles.tableWrap}>
                {loading && (
                    <div className={styles.status}>
                        Loading portfolio positions...
                    </div>
                )}

                {!loading && error && (
                    <div className={styles.error}>{error}</div>
                )}

                {!loading && !error && (
                    <Table
                        rows={rows}
                        columns={columns}
                        getRowId={(row) => row.ticker}
                        scopeType="page"
                        scopeId="portfolio"
                        tableId="positions-v2"
                        variant="full"
                        stickyColumnId="symbol"
                        lockedColumnIds={["symbol"]}
                        maxHeight="calc(100vh - var(--topbar-height) - 180px)"
                        emptyMessage="No positions yet. Add a position to get started."
                    />
                )}
            </div>
        </div>
    );
}

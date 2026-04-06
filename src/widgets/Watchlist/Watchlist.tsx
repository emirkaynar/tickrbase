import { useEffect, useMemo, useState } from "preact/hooks";
import { Table, type TableColumnDef, WidgetRemoveButton } from "../../ui";
import { fetchWatchlist } from "../../services/watchlist";
import { INTERVAL_CONFIG, type WatchlistItem } from "../../services/types";
import { ScrollArea as ArcScrollArea } from "@ark-ui/react/scroll-area";
import { registerWidget } from "../registry";
import styles from "./Watchlist.module.css";

type Props = { id: string; onRemove: () => void };

type WatchlistRow = WatchlistItem & {
    last_seen?: number;
};

function intervalOrder(interval: string): number {
    const order = ["1m", "5m", "15m", "30m", "1h", "1d", "1wk", "1mo"];
    const index = order.indexOf(interval);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function formatRelativeTime(unixSeconds?: number): string {
    if (!unixSeconds) return "-";

    const nowSec = Math.floor(Date.now() / 1000);
    const delta = Math.max(0, nowSec - unixSeconds);

    if (delta < 60) return `${delta}s ago`;
    if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
    if (delta < 86_400) return `${Math.floor(delta / 3600)}h ago`;
    return `${Math.floor(delta / 86_400)}d ago`;
}

function getIntervalLabel(interval: string): string {
    const entry = INTERVAL_CONFIG[interval as keyof typeof INTERVAL_CONFIG];
    return entry?.label ?? interval;
}

function Watchlist({ id, onRemove }: Props) {
    const [rows, setRows] = useState<WatchlistRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        const controller = new AbortController();

        const load = async () => {
            try {
                setError("");
                const data = await fetchWatchlist(controller.signal);
                setRows(data as WatchlistRow[]);
            } catch {
                if (!controller.signal.aborted) {
                    setError("Could not load watchlist.");
                }
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false);
                }
            }
        };

        setLoading(true);
        void load();

        const timer = window.setInterval(() => {
            if (!controller.signal.aborted) {
                void load();
            }
        }, 30_000);

        return () => {
            controller.abort();
            window.clearInterval(timer);
        };
    }, []);

    const columns = useMemo<TableColumnDef<WatchlistRow>[]>(
        () => [
            {
                id: "symbol",
                accessorKey: "ticker",
                header: "Symbol",
                meta: {
                    label: "Symbol",
                    locked: true,
                    removable: false,
                    sortable: true,
                },
                size: 0,
                minSize: 80,
                cell: ({ row }) => (
                    <span className={styles.symbolCell}>
                        {row.original.ticker}
                    </span>
                ),
            },
            {
                id: "interval",
                accessorKey: "interval",
                header: "Interval",
                meta: { label: "Interval", sortable: true },
                sortingFn: (left, right) =>
                    intervalOrder(left.original.interval) -
                    intervalOrder(right.original.interval),
                size: 110,
                minSize: 100,
                cell: ({ row }) => (
                    <span className={styles.mutedValue}>
                        {getIntervalLabel(row.original.interval)}
                    </span>
                ),
            },
            {
                id: "updated",
                accessorFn: (row) => row.last_seen ?? 0,
                header: "Updated",
                meta: { label: "Updated", sortable: true },
                size: 130,
                minSize: 110,
                cell: ({ row }) => (
                    <span className={styles.mutedValue}>
                        {formatRelativeTime(row.original.last_seen)}
                    </span>
                ),
            },
        ],
        [],
    );

    return (
        <div className={styles.root}>
            <div className={`${styles.handle} widget-handle`}>
                <div className={styles.widgetTitle}>
                    <div className={styles.heading}>Watchlist</div>
                    {!loading && !error && (
                        <span className={styles.count}>
                            {rows.length} symbols
                        </span>
                    )}
                </div>
                <div className={`${styles.dragGrip} sc-drag-grip`} />
                <div className={styles.controls}>
                    <WidgetRemoveButton
                        class={styles.removeBtn}
                        onClick={onRemove}
                    />
                </div>
            </div>
            <ArcScrollArea.Root className={styles.scrollRoot}>
                <ArcScrollArea.Viewport className={styles.scrollViewport}>
                    <ArcScrollArea.Content className={styles.scrollContent}>
                        <div className={styles.content}>
                            {error ? (
                                <div className={styles.errorState}>{error}</div>
                            ) : (
                                <>
                                    <Table
                                        className={styles.table}
                                        rows={rows}
                                        columns={columns}
                                        getRowId={(row) =>
                                            `${row.ticker}:${row.interval}`
                                        }
                                        scopeType="widget"
                                        scopeId={id}
                                        tableId="watchlist"
                                        variant="widget"
                                        stickyColumnId="symbol"
                                        lockedColumnIds={["symbol"]}
                                        height="100%"
                                        emptyMessage="No watchlist symbols yet."
                                    ></Table>
                                </>
                            )}

                            {loading && !error && (
                                <div className={styles.loadingOverlay} />
                            )}
                        </div>
                    </ArcScrollArea.Content>
                </ArcScrollArea.Viewport>
                <ArcScrollArea.Scrollbar
                    className={styles.scrollbar}
                    orientation="vertical"
                >
                    <ArcScrollArea.Thumb className={styles.scrollThumb} />
                </ArcScrollArea.Scrollbar>
                <ArcScrollArea.Scrollbar
                    className={styles.scrollbar}
                    orientation="horizontal"
                >
                    <ArcScrollArea.Thumb className={styles.scrollThumb} />
                </ArcScrollArea.Scrollbar>
                <ArcScrollArea.Corner className={styles.Corner} />
            </ArcScrollArea.Root>
        </div>
    );
}

registerWidget({
    type: "watchlist",
    label: "Watchlist",
    defaultSize: { w: 9, h: 14 },
    minSize: { w: 7, h: 8 },
    component: Watchlist,
});

export { Watchlist };

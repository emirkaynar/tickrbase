import { Columns3 } from "lucide-react";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "preact/hooks";
import {
    Skeleton,
    Select,
    Table,
    type SelectItem,
    type TableColumnDef,
    type TableColumnOption,
    type TableController,
    WidgetRemoveButton,
    Tooltip,
} from "../../ui";
import { fetchWatchlist } from "../../services/watchlist";
import { livePricesClient } from "../../services/livePrices";
import type { WatchlistItem } from "../../services/types";
import { ScrollArea as ArcScrollArea } from "@ark-ui/react/scroll-area";
import { registerWidget } from "../registry";
import styles from "./Watchlist.module.css";

type Props = { id: string; onRemove: () => void };

type WatchlistRow = WatchlistItem & {
    price: number | null;
    isPriceLoading: boolean;
    isPricePulsing: boolean;
};

const WATCHLIST_LOCKED_COLUMN_IDS = ["symbol"];
const PRICE_PULSE_MS = 260;

function formatPrice(value: number): string {
    return value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function areColumnOptionsEqual(
    left: TableColumnOption[],
    right: TableColumnOption[],
): boolean {
    if (left === right) return true;
    if (left.length !== right.length) return false;

    for (let i = 0; i < left.length; i += 1) {
        const a = left[i];
        const b = right[i];
        if (!b) return false;
        if (
            a.id !== b.id ||
            a.label !== b.label ||
            a.visible !== b.visible ||
            a.locked !== b.locked ||
            a.removable !== b.removable
        ) {
            return false;
        }
    }

    return true;
}

function Watchlist({ id, onRemove }: Props) {
    const [items, setItems] = useState<WatchlistItem[]>([]);
    const [priceByTicker, setPriceByTicker] = useState<Record<string, number>>(
        {},
    );
    const [pulsingByTicker, setPulsingByTicker] = useState<
        Record<string, boolean>
    >({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const tableControllerRef = useRef<TableController | null>(null);
    const [hasController, setHasController] = useState(false);
    const [columnOptions, setColumnOptions] = useState<TableColumnOption[]>([]);
    const pulseTimersRef = useRef<Record<string, number>>({});

    useEffect(() => {
        const controller = new AbortController();

        const load = async () => {
            try {
                setError("");
                const data = await fetchWatchlist(controller.signal);
                setItems(data);
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
        }, 5_000);

        return () => {
            controller.abort();
            window.clearInterval(timer);
        };
    }, []);

    useEffect(() => {
        const subscriptionId = `watchlist:${id}`;
        const symbols = items.map((item) => item.ticker);

        if (!symbols.length) {
            livePricesClient.removeWidget(subscriptionId);
            return;
        }

        livePricesClient.updateSymbols(subscriptionId, symbols);

        return () => {
            livePricesClient.removeWidget(subscriptionId);
        };
    }, [id, items]);

    useEffect(() => {
        const unsubscribe = livePricesClient.onTick((tick) => {
            let didPriceChange = false;

            setPriceByTicker((prev) => {
                if (!Number.isFinite(tick.price)) return prev;
                const nextPrice = tick.price;
                if (prev[tick.symbol] === nextPrice) return prev;
                didPriceChange = true;
                return {
                    ...prev,
                    [tick.symbol]: nextPrice,
                };
            });

            if (!didPriceChange) {
                return;
            }

            setPulsingByTicker((prev) => ({
                ...prev,
                [tick.symbol]: true,
            }));

            const existingTimer = pulseTimersRef.current[tick.symbol];
            if (existingTimer != null) {
                window.clearTimeout(existingTimer);
            }

            pulseTimersRef.current[tick.symbol] = window.setTimeout(() => {
                setPulsingByTicker((prev) => {
                    if (!prev[tick.symbol]) return prev;
                    const next = { ...prev };
                    delete next[tick.symbol];
                    return next;
                });
                delete pulseTimersRef.current[tick.symbol];
            }, PRICE_PULSE_MS);
        });

        return () => {
            unsubscribe();
            for (const timer of Object.values(pulseTimersRef.current)) {
                window.clearTimeout(timer);
            }
            pulseTimersRef.current = {};
        };
    }, []);

    const rows = useMemo<WatchlistRow[]>(
        () =>
            items.map((item) => {
                const ticker = item.ticker;
                const price = priceByTicker[ticker];

                return {
                    ...item,
                    price: Number.isFinite(price) ? price : null,
                    isPriceLoading: !Number.isFinite(price),
                    isPricePulsing: Boolean(pulsingByTicker[ticker]),
                };
            }),
        [items, priceByTicker, pulsingByTicker],
    );

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
                    align: "left",
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
                id: "price",
                accessorFn: (row) => row.price,
                header: "Price",
                meta: { label: "Price", align: "right" },
                size: 100,
                minSize: 60,
                cell: ({ row }) => (
                    <span
                        className={styles.priceCell}
                        data-cell-pulse={
                            row.original.isPricePulsing ? "true" : undefined
                        }
                    >
                        {row.original.isPriceLoading ? (
                            <Skeleton
                                variant="text"
                                className={styles.priceSkeleton}
                            />
                        ) : (
                            formatPrice(row.original.price ?? 0)
                        )}
                    </span>
                ),
            },
        ],
        [],
    );

    const setColumnOptionsIfChanged = useCallback(
        (next: TableColumnOption[]) => {
            setColumnOptions((prev) =>
                areColumnOptionsEqual(prev, next) ? prev : next,
            );
        },
        [],
    );

    const refreshColumnOptions = useCallback(() => {
        const controller = tableControllerRef.current;
        if (!controller) return;
        setColumnOptionsIfChanged(controller.getColumnOptions());
    }, [setColumnOptionsIfChanged]);

    const handleControllerReady = useCallback(
        (controller: TableController) => {
            tableControllerRef.current = controller;
            setHasController(true);
            setColumnOptionsIfChanged(controller.getColumnOptions());
        },
        [setColumnOptionsIfChanged],
    );

    const columnItems = useMemo<SelectItem[]>(
        () =>
            columnOptions.map((option) => ({
                label: option.label,
                value: option.id,
                disabled: option.locked,
                locked: option.locked,
            })),
        [columnOptions],
    );

    const visibleColumnIds = useMemo(
        () =>
            columnOptions
                .filter((option) => option.visible)
                .map((option) => option.id),
        [columnOptions],
    );

    const handleVisibleColumnsChange = useCallback(
        (nextVisibleIds: string[]) => {
            const tableController = tableControllerRef.current;
            if (!tableController) return;

            const nextVisibleSet = new Set(nextVisibleIds);
            let didChange = false;

            for (const option of columnOptions) {
                if (option.locked) continue;

                const shouldBeVisible = nextVisibleSet.has(option.id);
                if (shouldBeVisible === option.visible) continue;
                didChange = true;

                if (shouldBeVisible) {
                    tableController.showColumn(option.id);
                } else {
                    tableController.hideColumn(option.id);
                }
            }

            if (!didChange) return;
            setColumnOptionsIfChanged(tableController.getColumnOptions());
        },
        [columnOptions, setColumnOptionsIfChanged],
    );

    return (
        <div className={styles.root}>
            <div className={`${styles.handle} widget-handle`}>
                <div className={`${styles.dragGrip} sc-drag-grip`}>
                    <div className={styles.widgetTitle}>
                        <div className={styles.heading}>Watchlist</div>
                        {!loading && !error && (
                            <span className={styles.count}>
                                {items.length} symbols
                            </span>
                        )}
                    </div>
                </div>
                <div className={styles.controls}>
                    <Tooltip content="Columns">
                        <Select
                            className={styles.columnSelect}
                            items={columnItems}
                            multiple
                            values={visibleColumnIds}
                            onValuesChange={handleVisibleColumnsChange}
                            onOpenChange={(open) => {
                                if (open) refreshColumnOptions();
                            }}
                            placement="bottom"
                            variant="widget"
                            triggerVariant="icon"
                            triggerIcon={<Columns3 />}
                            triggerLabel="Columns"
                            disabled={!hasController}
                        />
                    </Tooltip>

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
                                <Table
                                    className={styles.table}
                                    rows={rows}
                                    columns={columns}
                                    getRowId={(row) => row.ticker}
                                    scopeType="widget"
                                    scopeId={id}
                                    tableId="watchlist-v3"
                                    variant="widget"
                                    stickyColumnId="symbol"
                                    lockedColumnIds={
                                        WATCHLIST_LOCKED_COLUMN_IDS
                                    }
                                    height="100%"
                                    emptyMessage="No watchlist symbols yet."
                                    onControllerReady={handleControllerReady}
                                />
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
            {loading && !error && <Skeleton />}
        </div>
    );
}

registerWidget({
    type: "watchlist",
    label: "Watchlist",
    defaultSize: { w: 7, h: 29 },
    minSize: { w: 6, h: 9 },
    component: Watchlist,
});

export { Watchlist };

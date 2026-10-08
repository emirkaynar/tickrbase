import {
    ArrowDown,
    ArrowDownAZ,
    ArrowUp,
    ArrowUpAZ,
    ChevronsUpDown,
    Columns3,
    Plus,
    Trash2,
} from "lucide-react";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "preact/hooks";
import { Popover as ArkPopover } from "@ark-ui/react/popover";
import { Portal } from "@ark-ui/react/portal";
import {
    Button,
    Dialog,
    Input,
    Skeleton,
    Select,
    Table,
    TickerSelector,
    type SelectItem,
    type TableColumnDef,
    type TableColumnOption,
    type TableController,
    Tooltip,
} from "../../ui";
import { api } from "../../services/api";
import {
    addSymbolToList,
    createList,
    deleteList,
    fetchListItems,
    fetchLists,
    removeSymbolFromList,
} from "../../services/watchlist";
import { fetchQuotes } from "../../services/quotes";
import { livePricesClient } from "../../services/livePrices";
import { getSettingValue } from "../../services/settings";
import { getWidgetStateFromCache } from "../../grid/useLayout";
import type {
    ListItem,
    ListRecord,
    QuoteFieldGroup,
    QuoteSnapshot,
} from "../../services/types";
import { ScrollArea as ArcScrollArea } from "@ark-ui/react/scroll-area";
import { registerWidget } from "../registry";
import { Shell } from "../Shell";
import {
    formatNumber as formatPrice,
    formatPercent,
    formatVolume,
} from "../../utils";
import styles from "./Lists.module.css";
import { listenForScroll, prunePulseCells, startQuotePolling } from "./lifecycle";

type Props = { id: string; onRemove: () => void };

type ListTableRow = ListItem & {
    price: number | null;
    previousClose: number | null;
    open: number | null;
    dayLow: number | null;
    dayHigh: number | null;
    changePercent: number | null;
    volume: number | null;
    volumeValue: number | null;
    bid: number | null;
    ask: number | null;
    isPriceLoading: boolean;
};

const LISTS_LOCKED_COLUMN_IDS = ["symbol", "actions"];
const LISTS_PINNED_COLUMNS = { left: ["symbol"], right: ["actions"] };
const SNAPSHOT_REFRESH_MS = 15_000;
const PRICE_FLUSH_INTERVAL_MS = 1000;
const MAX_PULSE_KEYS_PER_FRAME = 8;
const PULSABLE_COLUMN_IDS = ["price", "changePercent"] as const;
const PULSE_HOST_SELECTOR = '[data-pulse-host="true"]';

type PulsableColumnId = (typeof PULSABLE_COLUMN_IDS)[number];

const SNAPSHOT_GROUP_BY_COLUMN_ID: Partial<Record<string, QuoteFieldGroup>> = {
    previousClose: "session",
    open: "session",
    dayLow: "session",
    dayHigh: "session",
    changePercent: "session",
    volume: "volume",
    volumeValue: "volume",
    bid: "quote",
    ask: "quote",
};

function toFiniteNumber(value: number | null | undefined): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pruneTickerMap<T>(
    source: Record<string, T>,
    allowedSymbols: Set<string>,
): Record<string, T> | null {
    let didPrune = false;
    const next: Record<string, T> = {};

    for (const [symbol, value] of Object.entries(source)) {
        if (!allowedSymbols.has(symbol)) {
            didPrune = true;
            continue;
        }
        next[symbol] = value;
    }

    return didPrune ? next : null;
}

function createCellPulseKey(
    ticker: string,
    columnId: PulsableColumnId,
): string {
    return `${ticker}|${columnId}`;
}

function detectWidgetInteraction(root: HTMLElement | null): boolean {
    if (!root) return false;

    const gridItem = root.closest(".react-grid-item");
    const resizable = root.closest(".react-resizable");

    const gridInteracting =
        gridItem instanceof HTMLElement &&
        (gridItem.classList.contains("react-grid-item-resizing") ||
            gridItem.classList.contains("react-grid-item-dragging") ||
            gridItem.classList.contains("react-draggable-dragging"));

    const resizing =
        resizable instanceof HTMLElement &&
        resizable.classList.contains("resizing");

    return gridInteracting || resizing;
}

function toPulseSignatureValue(value: number | null): number | null {
    if (value === null) return null;
    return Math.round(value * 100);
}

function getPulseSignatures(
    ticker: string,
    priceByTicker: Record<string, number>,
    quotesByTicker: Record<string, QuoteSnapshot>,
): Record<PulsableColumnId, number | null> {
    const livePrice = toFiniteNumber(priceByTicker[ticker]);
    const quote = quotesByTicker[ticker];
    const quotePrice = toFiniteNumber(quote?.current_price);
    const resolvedPrice = livePrice ?? quotePrice;

    const previousClose = toFiniteNumber(quote?.previous_close);
    const derivedChangePercent =
        resolvedPrice !== null && previousClose !== null && previousClose !== 0
            ? ((resolvedPrice - previousClose) / previousClose) * 100
            : null;

    const changePercent =
        derivedChangePercent ?? toFiniteNumber(quote?.change_percent);

    return {
        price: toPulseSignatureValue(resolvedPrice),
        changePercent: toPulseSignatureValue(changePercent),
    };
}

function areQuoteSnapshotsEqual(
    left: QuoteSnapshot | undefined,
    right: QuoteSnapshot | undefined,
): boolean {
    if (left === right) return true;
    if (!left || !right) return false;

    return (
        left.symbol === right.symbol &&
        left.current_price === right.current_price &&
        left.previous_close === right.previous_close &&
        left.open === right.open &&
        left.day_low === right.day_low &&
        left.day_high === right.day_high &&
        left.change === right.change &&
        left.change_percent === right.change_percent &&
        left.volume === right.volume &&
        left.volume_value === right.volume_value &&
        left.bid === right.bid &&
        left.ask === right.ask
    );
}

function areQuoteMapsEqual(
    left: Record<string, QuoteSnapshot>,
    right: Record<string, QuoteSnapshot>,
): boolean {
    if (left === right) return true;

    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;

    for (const key of rightKeys) {
        if (!areQuoteSnapshotsEqual(left[key], right[key])) return false;
    }

    return true;
}

function toRowSignature(
    values: Array<number | null | boolean | string>,
): string {
    return values.map((value) => String(value)).join("\u001f");
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
    const rootRef = useRef<HTMLDivElement | null>(null);
    const listTriggerRef = useRef<HTMLButtonElement | null>(null);
    const addGroupTriggerRef = useRef<HTMLButtonElement | null>(null);
    const [lists, setLists] = useState<ListRecord[]>([]);
    const [activeListId, setActiveListId] = useState("");
    const lastSavedActiveListIdRef = useRef("");
    const [isListSwitching, setIsListSwitching] = useState(false);
    const [items, setItems] = useState<ListItem[]>([]);
    const [disablePulse, setDisablePulse] = useState(false);
    const [priceByTicker, setPriceByTicker] = useState<Record<string, number>>(
        {},
    );

    useEffect(() => {
        const load = async () => {
            const value = await getSettingValue<boolean>(
                "watchlist.disablePulse",
            );
            setDisablePulse(value);
        };
        void load();
    }, []);
    const [quotesByTicker, setQuotesByTicker] = useState<
        Record<string, QuoteSnapshot>
    >({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const tableControllerRef = useRef<TableController | null>(null);
    const [hasController, setHasController] = useState(false);
    const [columnOptions, setColumnOptions] = useState<TableColumnOption[]>([]);
    const pulseCellElementByKeyRef = useRef<
        Record<string, HTMLDivElement | null>
    >({});
    const pulseCellRefCallbackByKeyRef = useRef<
        Record<string, (element: HTMLSpanElement | null) => void>
    >({});
    const pendingPulseByKeyRef = useRef<Record<string, true>>({});
    const pendingPulseElementsRef = useRef<Set<HTMLElement>>(new Set());
    const pulseDispatchRafRef = useRef<number | null>(null);
    const pulseApplyRafRef = useRef<number | null>(null);
    const priceFlushTimerRef = useRef<number | null>(null);
    const pendingPriceByTickerRef = useRef<Record<string, number>>({});
    const activeSymbolsRef = useRef<Set<string>>(new Set());
    const priceByTickerStateRef = useRef<Record<string, number>>({});
    const quotesByTickerStateRef = useRef<Record<string, QuoteSnapshot>>({});
    const rowCacheByTickerRef = useRef<
        Record<string, { signature: string; row: ListTableRow }>
    >({});
    const unmountedRef = useRef(false);
    const [listPopoverOpen, setListPopoverOpen] = useState(false);
    const [newListName, setNewListName] = useState("");
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [addGroupPopoverOpen, setAddGroupPopoverOpen] = useState(false);
    const [newGroupLabel, setNewGroupLabel] = useState("");
    const [isPageVisible, setIsPageVisible] = useState(
        () => document.visibilityState === "visible",
    );
    const [isWidgetInteracting, setIsWidgetInteracting] = useState(false);
    const isWidgetInteractingRef = useRef(false);

    useEffect(() => {
        isWidgetInteractingRef.current = isWidgetInteracting;
    }, [isWidgetInteracting]);

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        const updateInteraction = () => {
            setIsWidgetInteracting(detectWidgetInteraction(root));
        };

        const observedElements = new Set<HTMLElement>();
        const observer = new MutationObserver(() => {
            updateInteraction();
        });

        const gridItem = root.closest(".react-grid-item");
        if (gridItem instanceof HTMLElement) {
            observedElements.add(gridItem);
        }

        const resizable = root.closest(".react-resizable");
        if (resizable instanceof HTMLElement) {
            observedElements.add(resizable);
        }

        if (observedElements.size === 0) {
            updateInteraction();
            return;
        }

        for (const element of observedElements) {
            observer.observe(element, {
                attributes: true,
                attributeFilter: ["class"],
            });
        }

        updateInteraction();

        return () => {
            observer.disconnect();
        };
    }, []);

    const refreshLists = useCallback(async (preferredListId?: string) => {
        const nextLists = await fetchLists();
        setLists(nextLists);
        setActiveListId((prev) => {
            const candidate = preferredListId ?? prev;
            if (candidate && nextLists.some((list) => list.id === candidate)) {
                return candidate;
            }
            return nextLists[0]?.id ?? "";
        });
    }, []);

    useEffect(() => {
        const controller = new AbortController();

        const load = async () => {
            try {
                const cached = getWidgetStateFromCache(id);
                const saved =
                    cached !== undefined
                        ? cached
                        : await api.get<any>(`/user/widgets/${id}/state`);
                const savedActiveListId = saved?.symbol ?? "";
                lastSavedActiveListIdRef.current = savedActiveListId;

                setError("");
                await refreshLists(savedActiveListId);
            } catch {
                if (!controller.signal.aborted) {
                    setError("Could not load lists.");
                    setLoading(false);
                }
            }
        };

        setLoading(true);
        void load();

        return () => {
            controller.abort();
        };
    }, [id, refreshLists]);

    useEffect(() => {
        if (!activeListId) {
            setItems([]);
            setIsListSwitching(false);
            if (lists.length === 0 && !loading) {
                setLoading(false);
            }
            return;
        }

        const controller = new AbortController();
        setIsListSwitching(true);

        const loadItems = async () => {
            try {
                setError("");
                const nextItems = await fetchListItems(
                    activeListId,
                    controller.signal,
                );
                if (controller.signal.aborted) return;

                setItems(nextItems);
                if (lastSavedActiveListIdRef.current !== activeListId) {
                    lastSavedActiveListIdRef.current = activeListId;
                    await api.put(`/user/widgets/${id}/state`, {
                        symbol: activeListId,
                    });
                }
            } catch {
                if (!controller.signal.aborted) {
                    setError("Could not load list items.");
                }
            } finally {
                if (!controller.signal.aborted) {
                    setIsListSwitching(false);
                    setLoading(false);
                }
            }
        };

        void loadItems();

        return () => {
            controller.abort();
        };
    }, [id, activeListId, lists.length, loading]);

    useEffect(() => {
        const handleVisibilityChange = () => {
            setIsPageVisible(document.visibilityState === "visible");
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => {
            document.removeEventListener(
                "visibilitychange",
                handleVisibilityChange,
            );
        };
    }, []);

    useEffect(() => {
        const subscriptionId = `lists:${id}`;
        const symbols: string[] = [];
        const seen = new Set<string>();

        for (const item of items) {
            const symbol = item.ticker.trim().toUpperCase();
            if (!symbol || seen.has(symbol)) continue;
            seen.add(symbol);
            symbols.push(symbol);
        }

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
        priceByTickerStateRef.current = priceByTicker;
    }, [priceByTicker]);

    useEffect(() => {
        quotesByTickerStateRef.current = quotesByTicker;
    }, [quotesByTicker]);

    useEffect(() => {
        const nextSymbols = new Set<string>();
        for (const item of items) {
            const symbol = item.ticker.trim().toUpperCase();
            if (!symbol) continue;
            nextSymbols.add(symbol);
        }

        activeSymbolsRef.current = nextSymbols;

        for (const symbol of Object.keys(pendingPriceByTickerRef.current)) {
            if (nextSymbols.has(symbol)) continue;
            delete pendingPriceByTickerRef.current[symbol];
        }

        setPriceByTicker((prev) => pruneTickerMap(prev, nextSymbols) ?? prev);
        setQuotesByTicker((prev) => pruneTickerMap(prev, nextSymbols) ?? prev);

        const activePulseKeys = new Set<string>();
        for (const symbol of nextSymbols) {
            for (const columnId of PULSABLE_COLUMN_IDS) {
                activePulseKeys.add(createCellPulseKey(symbol, columnId));
            }
        }

        prunePulseCells(
            pulseCellElementByKeyRef.current,
            pulseCellRefCallbackByKeyRef.current,
            pendingPulseByKeyRef.current,
            activePulseKeys,
            (element) => {
                element.removeEventListener(
                    "animationend",
                    handlePulseAnimationEnd,
                );
                element.classList.remove(styles.cellPulseActive);
                element.classList.remove(styles.cellPulseBase);
            },
        );

        for (const ticker of Object.keys(rowCacheByTickerRef.current)) {
            if (nextSymbols.has(ticker)) continue;
            delete rowCacheByTickerRef.current[ticker];
        }
    }, [items]);

    const ensurePulseCellBaseClass = useCallback((element: HTMLElement) => {
        element.classList.add(styles.cellPulseBase);
    }, []);

    const clearPulseClasses = useCallback((element: HTMLElement) => {
        element.classList.remove(styles.cellPulseActive);
    }, []);

    const handlePulseAnimationEnd = useCallback(
        (event: Event) => {
            clearPulseClasses(event.currentTarget as HTMLElement);
        },
        [clearPulseClasses],
    );

    const dispatchQueuedPulses = useCallback(() => {
        pulseDispatchRafRef.current = null;
        if (unmountedRef.current) return;
        if (isWidgetInteractingRef.current || isScrollingRef.current) return;

        const queued = Object.keys(pendingPulseByKeyRef.current);
        if (queued.length === 0) return;

        const batchSize = Math.min(MAX_PULSE_KEYS_PER_FRAME, queued.length);
        const batch = queued.slice(0, batchSize);
        const hasMoreQueued = queued.length > batchSize;

        if (hasMoreQueued) {
            const remaining: Record<string, true> = {};
            for (let i = batchSize; i < queued.length; i += 1) {
                remaining[queued[i]] = true;
            }
            pendingPulseByKeyRef.current = remaining;
        } else {
            pendingPulseByKeyRef.current = {};
        }

        let hasElements = false;

        for (const key of batch) {
            const element = pulseCellElementByKeyRef.current[key];
            if (!element) continue;

            ensurePulseCellBaseClass(element);
            clearPulseClasses(element);
            pendingPulseElementsRef.current.add(element);
            hasElements = true;
        }

        if (!hasElements) {
            if (hasMoreQueued && pulseDispatchRafRef.current == null) {
                pulseDispatchRafRef.current =
                    window.requestAnimationFrame(dispatchQueuedPulses);
            }
            return;
        }

        if (pulseApplyRafRef.current != null) {
            window.cancelAnimationFrame(pulseApplyRafRef.current);
            pulseApplyRafRef.current = null;
        }

        pulseApplyRafRef.current = window.requestAnimationFrame(() => {
            pulseApplyRafRef.current = null;
            if (unmountedRef.current) return;

            const elements = Array.from(pendingPulseElementsRef.current);
            pendingPulseElementsRef.current.clear();

            for (const element of elements) {
                element.classList.add(styles.cellPulseActive);
            }

            if (hasMoreQueued && pulseDispatchRafRef.current == null) {
                pulseDispatchRafRef.current =
                    window.requestAnimationFrame(dispatchQueuedPulses);
            }
        });
    }, [clearPulseClasses, ensurePulseCellBaseClass]);

    const queueCellPulse = useCallback(
        (key: string) => {
            if (disablePulse) return;
            pendingPulseByKeyRef.current[key] = true;
            if (pulseDispatchRafRef.current != null) return;

            pulseDispatchRafRef.current =
                window.requestAnimationFrame(dispatchQueuedPulses);
        },
        [dispatchQueuedPulses, disablePulse],
    );

    const isScrollingRef = useRef(false);
    const scrollTimeoutRef = useRef<number | null>(null);
    const flushPendingPricesRef = useRef<() => void>(() => {});

    const schedulePriceFlush = useCallback(() => {
        if (isWidgetInteractingRef.current) return;
        if (priceFlushTimerRef.current != null) return;

        priceFlushTimerRef.current = window.setTimeout(
            () => flushPendingPricesRef.current(),
            PRICE_FLUSH_INTERVAL_MS,
        );
    }, []);

    const flushPendingPrices = useCallback(() => {
        priceFlushTimerRef.current = null;
        if (unmountedRef.current) return;
        if (isWidgetInteractingRef.current) return;
        if (isScrollingRef.current) {
            schedulePriceFlush();
            return;
        }

        const pendingEntries = Object.entries(pendingPriceByTickerRef.current);
        if (pendingEntries.length === 0) return;
        pendingPriceByTickerRef.current = {};

        const activeSymbols = activeSymbolsRef.current;
        const previousPrices = priceByTickerStateRef.current;
        const previousQuotes = quotesByTickerStateRef.current;
        const pruned = pruneTickerMap(previousPrices, activeSymbols);
        const current = pruned ?? previousPrices;
        let next = current;
        const changedSymbols: string[] = [];

        for (const [symbol, value] of pendingEntries) {
            if (!activeSymbols.has(symbol)) continue;
            if (current[symbol] === value) continue;

            if (next === current) {
                next = { ...current };
            }
            next[symbol] = value;
            changedSymbols.push(symbol);
        }

        if (next !== previousPrices) {
            priceByTickerStateRef.current = next;
            setPriceByTicker(next);
        }

        if (disablePulse || !isPageVisible || changedSymbols.length === 0)
            return;

        for (const symbol of changedSymbols) {
            const previousSignatures = getPulseSignatures(
                symbol,
                previousPrices,
                previousQuotes,
            );
            const nextSignatures = getPulseSignatures(
                symbol,
                next,
                previousQuotes,
            );

            if (previousSignatures.price !== nextSignatures.price) {
                queueCellPulse(createCellPulseKey(symbol, "price"));
            }
            if (
                previousSignatures.changePercent !==
                nextSignatures.changePercent
            ) {
                queueCellPulse(createCellPulseKey(symbol, "changePercent"));
            }
        }
    }, [isPageVisible, queueCellPulse, disablePulse, schedulePriceFlush]);

    useEffect(() => {
        flushPendingPricesRef.current = flushPendingPrices;
    }, [flushPendingPrices]);

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        const scrollViewport = root.querySelector(`.${styles.scrollViewport}`);
        if (!scrollViewport) return;

        return listenForScroll(
            scrollViewport,
            isScrollingRef,
            scrollTimeoutRef,
            flushPendingPrices,
        );
    }, [flushPendingPrices]);

    useEffect(() => {
        if (!disablePulse) return;

        if (pulseDispatchRafRef.current != null) {
            window.cancelAnimationFrame(pulseDispatchRafRef.current);
            pulseDispatchRafRef.current = null;
        }
        if (pulseApplyRafRef.current != null) {
            window.cancelAnimationFrame(pulseApplyRafRef.current);
            pulseApplyRafRef.current = null;
        }
        pendingPulseByKeyRef.current = {};
        pendingPulseElementsRef.current.clear();

        for (const element of Object.values(pulseCellElementByKeyRef.current)) {
            if (!element) continue;
            element.classList.remove(styles.cellPulseActive);
        }
    }, [disablePulse]);

    useEffect(() => {
        const unsubscribe = livePricesClient.onTick((tick) => {
            if (isWidgetInteractingRef.current) return;
            if (!Number.isFinite(tick.price)) return;
            if (!activeSymbolsRef.current.has(tick.symbol)) return;

            pendingPriceByTickerRef.current[tick.symbol] = tick.price;
            schedulePriceFlush();
        });

        return () => {
            unsubscribe();
        };
    }, [schedulePriceFlush]);

    useEffect(() => {
        if (!isWidgetInteracting) return;

        if (priceFlushTimerRef.current != null) {
            window.clearTimeout(priceFlushTimerRef.current);
            priceFlushTimerRef.current = null;
        }

        pendingPriceByTickerRef.current = {};

        if (pulseDispatchRafRef.current != null) {
            window.cancelAnimationFrame(pulseDispatchRafRef.current);
            pulseDispatchRafRef.current = null;
        }
        if (pulseApplyRafRef.current != null) {
            window.cancelAnimationFrame(pulseApplyRafRef.current);
            pulseApplyRafRef.current = null;
        }
        pendingPulseByKeyRef.current = {};
        pendingPulseElementsRef.current.clear();
    }, [isWidgetInteracting]);

    const getPulseCellRef = useCallback(
        (ticker: string, columnId: PulsableColumnId) => {
            const key = createCellPulseKey(ticker, columnId);
            const cached = pulseCellRefCallbackByKeyRef.current[key];
            if (cached) return cached;

            const callback = (element: HTMLSpanElement | null) => {
                const previous = pulseCellElementByKeyRef.current[key];
                const hostCandidate = element?.closest(PULSE_HOST_SELECTOR);
                const next =
                    hostCandidate instanceof HTMLDivElement
                        ? hostCandidate
                        : null;

                if (previous && previous !== next) {
                    previous.removeEventListener(
                        "animationend",
                        handlePulseAnimationEnd,
                    );
                    previous.classList.remove(styles.cellPulseActive);
                    previous.classList.remove(styles.cellPulseBase);
                }

                if (next) {
                    ensurePulseCellBaseClass(next);
                    if (previous !== next) {
                        next.addEventListener(
                            "animationend",
                            handlePulseAnimationEnd,
                        );
                    }
                    pulseCellElementByKeyRef.current[key] = next;
                } else {
                    delete pulseCellElementByKeyRef.current[key];
                }
            };

            pulseCellRefCallbackByKeyRef.current[key] = callback;
            return callback;
        },
        [ensurePulseCellBaseClass, handlePulseAnimationEnd],
    );

    useEffect(() => {
        return () => {
            unmountedRef.current = true;

            if (priceFlushTimerRef.current != null) {
                window.clearTimeout(priceFlushTimerRef.current);
                priceFlushTimerRef.current = null;
            }
            pendingPriceByTickerRef.current = {};
            priceByTickerStateRef.current = {};
            quotesByTickerStateRef.current = {};
            rowCacheByTickerRef.current = {};

            if (pulseDispatchRafRef.current != null) {
                window.cancelAnimationFrame(pulseDispatchRafRef.current);
                pulseDispatchRafRef.current = null;
            }
            if (pulseApplyRafRef.current != null) {
                window.cancelAnimationFrame(pulseApplyRafRef.current);
                pulseApplyRafRef.current = null;
            }
            pendingPulseElementsRef.current.clear();
            pendingPulseByKeyRef.current = {};
            for (const element of Object.values(
                pulseCellElementByKeyRef.current,
            )) {
                if (!element) continue;
                element.removeEventListener(
                    "animationend",
                    handlePulseAnimationEnd,
                );
                element.classList.remove(styles.cellPulseActive);
                element.classList.remove(styles.cellPulseBase);
            }
            pulseCellElementByKeyRef.current = {};
            pulseCellRefCallbackByKeyRef.current = {};
        };
    }, [handlePulseAnimationEnd]);

    const rows = useMemo<ListTableRow[]>(() => {
        const cache = rowCacheByTickerRef.current;
        const activeTickers = new Set<string>();
        const visibleSet = new Set<string>();

        for (const option of columnOptions) {
            if (!option.visible) continue;
            visibleSet.add(option.id);
        }

        const resolvePreviousClose = visibleSet.has("previousClose");
        const resolveOpen = visibleSet.has("open");
        const resolveDayLow = visibleSet.has("dayLow");
        const resolveDayHigh = visibleSet.has("dayHigh");
        const resolveBid = visibleSet.has("bid");
        const resolveAsk = visibleSet.has("ask");
        const resolveVolume =
            visibleSet.has("volume") || visibleSet.has("volumeValue");
        const resolveVolumeValue = visibleSet.has("volumeValue");

        const nextRows = items.map((item) => {
            const ticker = item.ticker;
            activeTickers.add(ticker);

            const cached = cache[ticker]?.row;

            const livePrice = toFiniteNumber(priceByTicker[ticker]);
            const quote = quotesByTicker[ticker];
            const quotePrice = toFiniteNumber(quote?.current_price);
            const resolvedPrice = livePrice ?? quotePrice;

            const previousCloseForChange = toFiniteNumber(
                quote?.previous_close,
            );
            const previousClose = resolvePreviousClose
                ? previousCloseForChange
                : (cached?.previousClose ?? null);
            const open = resolveOpen
                ? toFiniteNumber(quote?.open)
                : (cached?.open ?? null);
            const dayLow = resolveDayLow
                ? toFiniteNumber(quote?.day_low)
                : (cached?.dayLow ?? null);
            const dayHigh = resolveDayHigh
                ? toFiniteNumber(quote?.day_high)
                : (cached?.dayHigh ?? null);
            const bid = resolveBid
                ? toFiniteNumber(quote?.bid)
                : (cached?.bid ?? null);
            const ask = resolveAsk
                ? toFiniteNumber(quote?.ask)
                : (cached?.ask ?? null);

            const resolvedVolume = resolveVolume
                ? toFiniteNumber(quote?.volume)
                : (cached?.volume ?? null);
            const volume = visibleSet.has("volume")
                ? resolvedVolume
                : (cached?.volume ?? null);

            const derivedChangePercent =
                resolvedPrice !== null &&
                previousCloseForChange !== null &&
                previousCloseForChange !== 0
                    ? ((resolvedPrice - previousCloseForChange) /
                          previousCloseForChange) *
                      100
                    : null;

            const changePercent =
                derivedChangePercent ?? toFiniteNumber(quote?.change_percent);

            const volumeValue = resolveVolumeValue
                ? (toFiniteNumber(quote?.volume_value) ??
                  (resolvedPrice !== null && resolvedVolume !== null
                      ? resolvedPrice * resolvedVolume
                      : null))
                : (cached?.volumeValue ?? null);

            const isPriceLoading = resolvedPrice === null;
            const signature = toRowSignature([
                resolvedPrice,
                changePercent,
                isPriceLoading,
                resolvePreviousClose ? previousClose : "hidden",
                resolveOpen ? open : "hidden",
                resolveDayLow ? dayLow : "hidden",
                resolveDayHigh ? dayHigh : "hidden",
                visibleSet.has("volume") ? volume : "hidden",
                resolveVolumeValue ? volumeValue : "hidden",
                resolveBid ? bid : "hidden",
                resolveAsk ? ask : "hidden",
            ]);

            const cachedEntry = cache[ticker];
            if (cachedEntry && cachedEntry.signature === signature) {
                return cachedEntry.row;
            }

            const nextRow: ListTableRow = {
                ...item,
                price: resolvedPrice,
                previousClose,
                open,
                dayLow,
                dayHigh,
                changePercent,
                volume,
                volumeValue,
                bid,
                ask,
                isPriceLoading,
            };

            cache[ticker] = {
                signature,
                row: nextRow,
            };

            return nextRow;
        });

        for (const ticker of Object.keys(cache)) {
            if (activeTickers.has(ticker)) continue;
            delete cache[ticker];
        }

        return nextRows;
    }, [items, priceByTicker, quotesByTicker, columnOptions]);

    const handleRemoveSymbol = useCallback(
        async (ticker: string) => {
            if (!activeListId) return;

            try {
                await removeSymbolFromList(activeListId, ticker);
                setItems((prev) =>
                    prev.filter((item) => item.ticker !== ticker),
                );
                setPriceByTicker((prev) => {
                    if (!(ticker in prev)) return prev;
                    const next = { ...prev };
                    delete next[ticker];
                    return next;
                });
                setQuotesByTicker((prev) => {
                    if (!(ticker in prev)) return prev;
                    const next = { ...prev };
                    delete next[ticker];
                    return next;
                });
                delete rowCacheByTickerRef.current[ticker];
            } catch {
                setError("Could not remove symbol from list.");
            }
        },
        [activeListId],
    );

    const columns = useMemo<TableColumnDef<ListTableRow>[]>(
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
                    sortIcon: (direction) =>
                        direction === "desc" ? (
                            <ArrowUpAZ size={14} />
                        ) : (
                            <ArrowDownAZ size={14} />
                        ),
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
                meta: {
                    label: "Price",
                    align: "right",
                    sortable: true,
                    sortIcon: (direction) =>
                        direction === "desc" ? (
                            <ArrowDown size={14} />
                        ) : (
                            <ArrowUp size={14} />
                        ),
                },
                size: 100,
                minSize: 60,
                cell: ({ row }) => (
                    <span
                        ref={getPulseCellRef(row.original.ticker, "price")}
                        className={styles.priceCell}
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
            {
                id: "changePercent",
                accessorFn: (row) => row.changePercent,
                header: "Change %",
                meta: {
                    label: "Change %",
                    align: "right",
                    sortable: true,
                    sortIcon: (direction) =>
                        direction === "desc" ? (
                            <ArrowDown size={14} />
                        ) : (
                            <ArrowUp size={14} />
                        ),
                },
                size: 96,
                minSize: 84,
                cell: ({ row }) => {
                    const value = row.original.changePercent;
                    const className =
                        value === null
                            ? styles.mutedValue
                            : value >= 0
                              ? styles.positiveValue
                              : styles.negativeValue;

                    return (
                        <span
                            ref={getPulseCellRef(
                                row.original.ticker,
                                "changePercent",
                            )}
                            className={className}
                        >
                            {formatPercent(value)}
                        </span>
                    );
                },
            },
            {
                id: "previousClose",
                accessorFn: (row) => row.previousClose,
                header: "Previous Close",
                meta: {
                    label: "Previous Close",
                    align: "right",
                    sortable: true,
                    sortIcon: (direction) =>
                        direction === "desc" ? (
                            <ArrowDown size={14} />
                        ) : (
                            <ArrowUp size={14} />
                        ),
                },
                size: 120,
                minSize: 96,
                cell: ({ row }) => (
                    <span className={styles.mutedValue}>
                        {formatPrice(row.original.previousClose)}
                    </span>
                ),
            },
            {
                id: "open",
                accessorFn: (row) => row.open,
                header: "Open",
                meta: {
                    label: "Open",
                    align: "right",
                    sortable: true,
                    sortIcon: (direction) =>
                        direction === "desc" ? (
                            <ArrowDown size={14} />
                        ) : (
                            <ArrowUp size={14} />
                        ),
                },
                size: 100,
                minSize: 88,
                cell: ({ row }) => (
                    <span className={styles.mutedValue}>
                        {formatPrice(row.original.open)}
                    </span>
                ),
            },
            {
                id: "dayLow",
                accessorFn: (row) => row.dayLow,
                header: "Day Low",
                meta: {
                    label: "Day Low",
                    align: "right",
                    sortable: true,
                    sortIcon: (direction) =>
                        direction === "desc" ? (
                            <ArrowDown size={14} />
                        ) : (
                            <ArrowUp size={14} />
                        ),
                },
                size: 100,
                minSize: 88,
                cell: ({ row }) => (
                    <span className={styles.mutedValue}>
                        {formatPrice(row.original.dayLow)}
                    </span>
                ),
            },
            {
                id: "dayHigh",
                accessorFn: (row) => row.dayHigh,
                header: "Day High",
                meta: {
                    label: "Day High",
                    align: "right",
                    sortable: true,
                    sortIcon: (direction) =>
                        direction === "desc" ? (
                            <ArrowDown size={14} />
                        ) : (
                            <ArrowUp size={14} />
                        ),
                },
                size: 100,
                minSize: 88,
                cell: ({ row }) => (
                    <span className={styles.mutedValue}>
                        {formatPrice(row.original.dayHigh)}
                    </span>
                ),
            },
            {
                id: "volume",
                accessorFn: (row) => row.volume,
                header: "Volume",
                meta: {
                    label: "Volume",
                    align: "right",
                    sortable: true,
                    sortIcon: (direction) =>
                        direction === "desc" ? (
                            <ArrowDown size={14} />
                        ) : (
                            <ArrowUp size={14} />
                        ),
                },
                size: 120,
                minSize: 50,
                cell: ({ row }) => (
                    <span className={styles.mutedValue}>
                        {formatVolume(row.original.volume)}
                    </span>
                ),
            },
            {
                id: "volumeValue",
                accessorFn: (row) => row.volumeValue,
                header: "Volume($)",
                meta: {
                    label: "Volume($)",
                    align: "right",
                    sortable: true,
                    sortIcon: (direction) =>
                        direction === "desc" ? (
                            <ArrowDown size={14} />
                        ) : (
                            <ArrowUp size={14} />
                        ),
                },
                size: 132,
                minSize: 50,
                cell: ({ row }) => (
                    <span className={styles.mutedValue}>
                        {formatVolume(row.original.volumeValue)}
                    </span>
                ),
            },
            {
                id: "bid",
                accessorFn: (row) => row.bid,
                header: "Bid",
                meta: {
                    label: "Bid",
                    align: "right",
                    sortable: true,
                    sortIcon: (direction) =>
                        direction === "desc" ? (
                            <ArrowDown size={14} />
                        ) : (
                            <ArrowUp size={14} />
                        ),
                },
                size: 96,
                minSize: 84,
                cell: ({ row }) => (
                    <span className={styles.mutedValue}>
                        {formatPrice(row.original.bid)}
                    </span>
                ),
            },
            {
                id: "ask",
                accessorFn: (row) => row.ask,
                header: "Ask",
                meta: {
                    label: "Ask",
                    align: "right",
                    sortable: true,
                    sortIcon: (direction) =>
                        direction === "desc" ? (
                            <ArrowDown/>
                        ) : (
                            <ArrowUp/>
                        ),
                },
                size: 96,
                minSize: 84,
                cell: ({ row }) => (
                    <span className={styles.mutedValue}>
                        {formatPrice(row.original.ask)}
                    </span>
                ),
            },
            {
                id: "actions",
                header: "",
                meta: {
                    label: "Actions",
                    align: "right",
                    locked: true,
                    removable: false,
                },
                size: 32,
                minSize: 32,
                cell: ({ row }) => (
                    <Tooltip content="Remove">
                        <button
                            type="button"
                            className={styles.rowDeleteButton}
                            onClick={() =>
                                handleRemoveSymbol(row.original.ticker)
                            }
                            aria-label="Remove symbol"
                        >
                            <Trash2 size={14} />
                        </button>
                    </Tooltip>
                ),
            },
        ],
        [getPulseCellRef, handleRemoveSymbol],
    );

    const selectedList = useMemo(
        () => lists.find((list) => list.id === activeListId) ?? null,
        [lists, activeListId],
    );

    const selectorOrderByColumnId = useMemo(() => {
        const order = new Map<string, number>();

        for (const [index, column] of columns.entries()) {
            const columnId = column.id;
            if (!columnId) continue;
            order.set(columnId, index);
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

    const handleCreateList = useCallback(async () => {
        try {
            const created = await createList(newListName);
            setNewListName("");
            await refreshLists(created.id);
            setActiveListId(created.id);
            setListPopoverOpen(false);
        } catch (cause) {
            const message =
                cause instanceof Error
                    ? cause.message
                    : "Could not create list.";
            setError(message);
        }
    }, [newListName, refreshLists]);

    const handleDeleteList = useCallback(async () => {
        if (!activeListId) return;

        try {
            const result = await deleteList(activeListId);
            setDeleteDialogOpen(false);

            if (!result.deleted) {
                if (result.reason === "last-list") {
                    setError("At least one list must remain.");
                }
                await refreshLists(result.activeListId);
                setActiveListId(result.activeListId);
                return;
            }

            await refreshLists(result.activeListId);
            setActiveListId(result.activeListId);
        } catch {
            setError("Could not delete list.");
        }
    }, [activeListId, refreshLists]);

    const handleAddSymbol = useCallback(
        async (symbol: string) => {
            const cleaned = symbol.trim().toUpperCase();
            if (!activeListId || !cleaned) return;
            if (items.some((item) => item.ticker === cleaned)) return;

            setItems((prev) => [...prev, { ticker: cleaned }]);

            try {
                await addSymbolToList(activeListId, cleaned);
            } catch {
                setItems((prev) =>
                    prev.filter((item) => item.ticker !== cleaned),
                );
                setError("Could not add symbol to list.");
            }
        },
        [activeListId, items],
    );

    const handleAddGroup = useCallback(() => {
        const label = newGroupLabel.trim();
        if (!label) return;

        const controller = tableControllerRef.current;
        if (!controller) return;

        controller.addSpacer({ label });
        setNewGroupLabel("");
        setAddGroupPopoverOpen(false);
    }, [newGroupLabel]);

    const setColumnOptionsIfChanged = useCallback(
        (next: TableColumnOption[]) => {
            const ordered = toSelectorOrderedOptions(next);
            setColumnOptions((prev) =>
                areColumnOptionsEqual(prev, ordered) ? prev : ordered,
            );
        },
        [toSelectorOrderedOptions],
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

    const listSymbols = useMemo(() => {
        const seen = new Set<string>();
        const ordered: string[] = [];

        for (const item of items) {
            const symbol = item.ticker.trim().toUpperCase();
            if (!symbol || seen.has(symbol)) continue;
            seen.add(symbol);
            ordered.push(symbol);
        }

        return ordered;
    }, [items]);

    const requestedQuoteGroups = useMemo<QuoteFieldGroup[]>(() => {
        const groups = new Set<QuoteFieldGroup>();

        for (const columnId of visibleColumnIds) {
            const group = SNAPSHOT_GROUP_BY_COLUMN_ID[columnId];
            if (!group) continue;
            groups.add(group);
        }

        return Array.from(groups).sort();
    }, [visibleColumnIds]);

    const listSymbolsKey = useMemo(() => listSymbols.join("|"), [listSymbols]);
    const requestedQuoteGroupsKey = useMemo(
        () => requestedQuoteGroups.join(","),
        [requestedQuoteGroups],
    );

    useEffect(() => {
        if (!activeListId) return;
        if (!isPageVisible) return;
        if (isWidgetInteracting) return;
        if (requestedQuoteGroups.length === 0) return;
        if (listSymbols.length === 0) return;

        const quoteSymbols = listSymbols;
        const quoteGroups = requestedQuoteGroups;

        return startQuotePolling(
            (signal) => fetchQuotes(quoteSymbols, quoteGroups, signal),
            (payload) => {
                if (isWidgetInteractingRef.current) return;

                const nextMap: Record<string, QuoteSnapshot> = {};
                for (const quote of payload.quotes) {
                    const symbol = quote.symbol.trim().toUpperCase();
                    if (!activeSymbolsRef.current.has(symbol)) continue;
                    nextMap[symbol] = quote;
                }

                const previousQuotes = quotesByTickerStateRef.current;
                const currentPrices = priceByTickerStateRef.current;
                if (areQuoteMapsEqual(previousQuotes, nextMap)) return;

                const pulseKeys: string[] = [];

                for (const symbol of activeSymbolsRef.current) {
                    const previousSignatures = getPulseSignatures(
                        symbol,
                        currentPrices,
                        previousQuotes,
                    );
                    const nextSignatures = getPulseSignatures(
                        symbol,
                        currentPrices,
                        nextMap,
                    );

                    if (previousSignatures.price !== nextSignatures.price) {
                        pulseKeys.push(createCellPulseKey(symbol, "price"));
                    }
                    if (
                        previousSignatures.changePercent !==
                        nextSignatures.changePercent
                    ) {
                        pulseKeys.push(
                            createCellPulseKey(symbol, "changePercent"),
                        );
                    }
                }

                quotesByTickerStateRef.current = nextMap;
                setQuotesByTicker(nextMap);

                if (!isPageVisible || pulseKeys.length === 0) return;
                for (const key of pulseKeys) {
                    queueCellPulse(key);
                }
            },
            SNAPSHOT_REFRESH_MS,
        );
    }, [
        activeListId,
        isPageVisible,
        isWidgetInteracting,
        listSymbolsKey,
        requestedQuoteGroupsKey,
        queueCellPulse,
    ]);

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

    const listPopoverPositioning = useMemo(
        () => ({
            placement: "bottom-start" as const,
            strategy: "fixed" as const,
            gutter: 6,
            shift: 8,
            flip: true,
            hideWhenDetached: true,
            getAnchorElement: () => listTriggerRef.current,
        }),
        [],
    );

    const addGroupPopoverPositioning = useMemo(
        () => ({
            placement: "top-start" as const,
            strategy: "fixed" as const,
            gutter: 8,
            shift: 8,
            flip: true,
            hideWhenDetached: true,
            getAnchorElement: () => addGroupTriggerRef.current,
        }),
        [],
    );

    return (
        <Shell
            id={id}
            className={styles.root}
            headerLeft={
                <div className={styles.widgetTitle}>
                    <ArkPopover.Root
                        open={listPopoverOpen}
                        onOpenChange={(details) => {
                            setListPopoverOpen(details.open);
                            if (details.open) {
                                setAddGroupPopoverOpen(false);
                            }
                        }}
                        closeOnInteractOutside
                        closeOnEscape
                        onInteractOutside={() => {
                            setListPopoverOpen(false);
                        }}
                        onEscapeKeyDown={() => {
                            setListPopoverOpen(false);
                        }}
                        positioning={listPopoverPositioning}
                        lazyMount
                    >
                        <ArkPopover.Trigger asChild>
                            <button
                                ref={listTriggerRef}
                                type="button"
                                className={styles.listTitleButton}
                            >
                                <span className={styles.heading}>
                                    {selectedList?.name ?? "Lists"}
                                </span>
                                {!loading && !error && (
                                    <span className={styles.count}>
                                        ({items.length})
                                    </span>
                                )}
                                <ChevronsUpDown size={12} />
                            </button>
                        </ArkPopover.Trigger>
                        <Portal>
                            <ArkPopover.Positioner>
                                <ArkPopover.Content className={styles.listMenu}>
                                    <div
                                        className={styles.listMenuSectionTitle}
                                    >
                                        Lists
                                    </div>
                                    <div className={styles.listMenuItems}>
                                        {lists.map((list) => (
                                            <button
                                                key={list.id}
                                                type="button"
                                                className={
                                                    list.id === activeListId
                                                        ? styles.listMenuItemActive
                                                        : styles.listMenuItem
                                                }
                                                onClick={() => {
                                                    setActiveListId(list.id);
                                                    setListPopoverOpen(false);
                                                }}
                                            >
                                                {list.name}
                                            </button>
                                        ))}
                                    </div>

                                    <form
                                        className={styles.listMenuCreateRow}
                                        onSubmit={(event) => {
                                            event.preventDefault();
                                            void handleCreateList();
                                        }}
                                    >
                                        <Input
                                            value={newListName}
                                            onChange={setNewListName}
                                            placeholder="New list name"
                                            className={styles.listInput}
                                        />
                                        <Button
                                            type="submit"
                                            variant="outline"
                                            className={styles.listMenuAction}
                                        >
                                            Create
                                        </Button>
                                    </form>

                                    <button
                                        type="button"
                                        className={styles.deleteListButton}
                                        onClick={() => {
                                            setDeleteDialogOpen(true);
                                            setListPopoverOpen(false);
                                        }}
                                    >
                                        Delete Current List
                                    </button>
                                </ArkPopover.Content>
                            </ArkPopover.Positioner>
                        </Portal>
                    </ArkPopover.Root>
                </div>
            }
            headerRight={
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
                </div>
            }
            loading={loading}
            error={error}
            onRemove={onRemove}
        >
            <div ref={rootRef} className={styles.bodyWrapper}>
                <ArcScrollArea.Root className={styles.scrollRoot}>
                    <ArcScrollArea.Viewport className={styles.scrollViewport}>
                        <ArcScrollArea.Content className={styles.scrollContent}>
                            <div className={styles.content}>
                                <Table
                                    className={styles.table}
                                    rows={rows}
                                    columns={columns}
                                    getRowId={(row) => row.ticker}
                                    scopeType="widget"
                                    scopeId={id}
                                    tableId="watchlist-v3"
                                    variant="widget"
                                    pinnedColumns={LISTS_PINNED_COLUMNS}
                                    lockedColumnIds={LISTS_LOCKED_COLUMN_IDS}
                                    rowStateId={activeListId || undefined}
                                    isHydrating={isListSwitching}
                                    emptyMessage="No symbols in this list yet."
                                    onControllerReady={handleControllerReady}
                                />
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
                <div className={styles.bottomActions}>
                    <TickerSelector
                        value=""
                        placeholder="Search symbol to add..."
                        onChange={(selectedSymbol) => {
                            if (selectedSymbol) {
                                void handleAddSymbol(selectedSymbol);
                            }
                        }}
                        trigger={
                            <button
                                type="button"
                                className={styles.bottomActionButton}
                            >
                                <Plus size={12} /> Add Symbol
                            </button>
                        }
                    />

                    <ArkPopover.Root
                        open={addGroupPopoverOpen}
                        onOpenChange={(details) => {
                            setAddGroupPopoverOpen(details.open);
                            if (details.open) {
                                setListPopoverOpen(false);
                            }
                            if (!details.open) {
                                setNewGroupLabel("");
                            }
                        }}
                        positioning={addGroupPopoverPositioning}
                        lazyMount
                    >
                        <ArkPopover.Trigger asChild>
                            <button
                                ref={addGroupTriggerRef}
                                type="button"
                                className={styles.bottomActionButton}
                            >
                                <Plus size={12} /> Add Group
                            </button>
                        </ArkPopover.Trigger>
                        <Portal>
                            <ArkPopover.Positioner>
                                <ArkPopover.Content
                                    className={styles.bottomActionPopover}
                                >
                                    <form
                                        className={styles.bottomActionEditor}
                                        onSubmit={(event) => {
                                            event.preventDefault();
                                            handleAddGroup();
                                        }}
                                    >
                                        <Input
                                            value={newGroupLabel}
                                            onChange={setNewGroupLabel}
                                            placeholder="Group label"
                                            className={styles.groupInput}
                                        />
                                        <Button type="submit" variant="outline">
                                            Create
                                        </Button>
                                        <Button
                                            onClick={() => {
                                                setAddGroupPopoverOpen(false);
                                                setNewGroupLabel("");
                                            }}
                                        >
                                            Cancel
                                        </Button>
                                    </form>
                                </ArkPopover.Content>
                            </ArkPopover.Positioner>
                        </Portal>
                    </ArkPopover.Root>
                </div>
            </div>

            <Dialog
                open={deleteDialogOpen}
                onClose={() => setDeleteDialogOpen(false)}
                title="Delete List"
                description="This list will be removed from all Lists widgets."
            >
                <div className={styles.deleteDialogActions}>
                    <Button onClick={() => setDeleteDialogOpen(false)}>
                        Cancel
                    </Button>
                    <Button
                        variant="solid"
                        onClick={() => void handleDeleteList()}
                    >
                        Delete
                    </Button>
                </div>
            </Dialog>
        </Shell>
    );
}

registerWidget({
    type: "watchlist",
    label: "Lists",
    defaultSize: { w: 5, h: 24 },
    minSize: { w: 4, h: 6 },
    component: Watchlist,
});

export { Watchlist };

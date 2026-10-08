import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Combobox, useListCollection } from "@ark-ui/react/combobox";
import { Portal } from "@ark-ui/react/portal";
import { ScrollArea } from "@ark-ui/react/scroll-area";
import {
    CheckIcon,
    Loader2Icon,
    SearchIcon,
    TrendingUpIcon,
} from "lucide-react";
import { API_BASE } from "../../services/api";
import { fetchLookup } from "../../services/lookup";
import type { LookupItem } from "../../services/types";
import styles from "./TickerSelector.module.css";

export type TickerSelectorItem = LookupItem;

export type TickerSelectorProps = {
    value: string;
    onChange: (value: string) => void;
    trigger?: ComponentChildren;
    placeholder?: string;
    className?: string;
    popularTickers?: TickerSelectorItem[];
};

const DEFAULT_POPULAR_TICKERS: TickerSelectorItem[] = [
    {
        symbol: "THYAO.IS",
        company_name: "Türk Hava Yolları",
        exchange: "IST",
        instrument_type: "stock",
    },
    {
        symbol: "ASELS.IS",
        company_name: "Aselsan Elektronik",
        exchange: "IST",
        instrument_type: "stock",
    },
    {
        symbol: "GARAN.IS",
        company_name: "Garanti BBVA",
        exchange: "IST",
        instrument_type: "stock",
    },
    {
        symbol: "EREGL.IS",
        company_name: "Ereğli Demir Çelik",
        exchange: "IST",
        instrument_type: "stock",
    },
    {
        symbol: "TUPRS.IS",
        company_name: "Tüpraş",
        exchange: "IST",
        instrument_type: "stock",
    },
    {
        symbol: "KCHOL.IS",
        company_name: "Koç Holding",
        exchange: "IST",
        instrument_type: "stock",
    },
    {
        symbol: "AKBNK.IS",
        company_name: "Akbank",
        exchange: "IST",
        instrument_type: "stock",
    },
    {
        symbol: "SISE.IS",
        company_name: "Şişecam",
        exchange: "IST",
        instrument_type: "stock",
    },
];

function TickerAvatar({ symbol }: { symbol: string }) {
    const [loaded, setLoaded] = useState(false);
    const [imgError, setImgError] = useState(false);
    const imgRef = useRef<HTMLImageElement>(null);

    useEffect(() => {
        setLoaded(false);
        setImgError(false);
    }, [symbol]);

    useEffect(() => {
        const img = imgRef.current;
        if (img && img.complete) {
            if (img.naturalWidth > 0) {
                setLoaded(true);
            } else if (img.naturalWidth === 0 && img.src) {
                setImgError(true);
            }
        }
    }, [symbol]);

    const initials = symbol.slice(0, 2).toUpperCase();

    return (
        <div className={styles.avatar}>
            <span>{initials}</span>
            {!imgError && (
                <img
                    ref={imgRef}
                    src={`${API_BASE}/logo/${encodeURIComponent(symbol)}`}
                    alt={symbol}
                    className={styles.avatarImg}
                    data-loaded={loaded ? "true" : "false"}
                    onLoad={() => setLoaded(true)}
                    onError={() => setImgError(true)}
                />
            )}
        </div>
    );
}



function formatSubtitle(item: TickerSelectorItem): string {
    if (item.exchange && item.company_name) {
        return `${item.exchange} · ${item.company_name}`;
    }
    return item.company_name || item.exchange || "";
}

export function TickerSelector({
    value,
    onChange,
    trigger,
    placeholder = "Search ticker...",
    className,
    popularTickers = DEFAULT_POPULAR_TICKERS,
}: TickerSelectorProps) {
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [searchResults, setSearchResults] = useState<TickerSelectorItem[]>(
        [],
    );
    const requestTokenRef = useRef(0);

    useEffect(() => {
        const normalized = query.trim();
        if (normalized.length < 2) {
            setLoading(false);
            setError("");
            setSearchResults([]);
            return;
        }

        const token = requestTokenRef.current + 1;
        requestTokenRef.current = token;
        const ctrl = new AbortController();

        const timerId = window.setTimeout(() => {
            setLoading(true);
            setError("");
            fetchLookup(normalized, ctrl.signal)
                .then((nextItems) => {
                    if (requestTokenRef.current !== token) return;
                    setSearchResults(nextItems);
                })
                .catch((err: unknown) => {
                    if (requestTokenRef.current !== token) return;
                    if (
                        err instanceof DOMException &&
                        err.name === "AbortError"
                    )
                        return;
                    setError(
                        err instanceof Error ? err.message : "Lookup failed",
                    );
                    setSearchResults([]);
                })
                .finally(() => {
                    if (requestTokenRef.current !== token) return;
                    setLoading(false);
                });
        }, 250);

        return () => {
            ctrl.abort();
            clearTimeout(timerId);
        };
    }, [query]);

    const activeItems = useMemo(() => {
        if (query.trim().length >= 2) {
            return searchResults;
        }
        return popularTickers;
    }, [query, searchResults, popularTickers]);

    const { collection, set } = useListCollection<TickerSelectorItem>({
        initialItems: activeItems,
        itemToString: (item) => item.symbol,
        itemToValue: (item) => item.symbol,
    });

    useEffect(() => {
        set(activeItems);
    }, [activeItems, set]);

    const viewportRef = useRef<HTMLDivElement>(null);

    const handleScrollToIndex = useCallback((details: { index: number; immediate?: boolean }) => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const itemElements = viewport.querySelectorAll('[data-part="item"]');
        const target = itemElements[details.index] as HTMLElement | undefined;
        if (target) {
            target.scrollIntoView({ block: "center", behavior: "smooth" });
        }
    }, []);

    return (
        <Combobox.Root<TickerSelectorItem>
            collection={collection}
            value={value ? [value] : []}
            open={open}
            onOpenChange={(details) => {
                setOpen(details.open);
                if (!details.open) {
                    setQuery("");
                }
            }}
            onValueChange={(details) => {
                const selected = details.value[0];
                if (selected) {
                    onChange(selected);
                    setOpen(false);
                }
            }}
            onInputValueChange={(details) => {
                setQuery(details.inputValue);
            }}
            scrollToIndexFn={handleScrollToIndex}
            closeOnSelect
            selectionBehavior="replace"
            positioning={{ placement: "bottom-start", gutter: 6 }}
            className={[styles.root, className].filter(Boolean).join(" ")}
        >
            <Combobox.Control className={styles.control}>
                <Combobox.Trigger asChild tabIndex={0}>
                    {trigger ? (
                        trigger
                    ) : (
                        <button type="button" className={styles.defaultTrigger}>
                            <span className={styles.triggerSymbol}>
                                {value || "Select Ticker"}
                            </span>
                        </button>
                    )}
                </Combobox.Trigger>
            </Combobox.Control>

            <Portal>
                <Combobox.Positioner>
                    <Combobox.Content className={styles.popoverContent}>
                        <div className={styles.searchHeader}>
                            <SearchIcon className={styles.searchIcon} />
                            <Combobox.Input
                                className={styles.searchInput}  
                                placeholder={placeholder}
                            />
                            {loading && (
                                <Loader2Icon className={styles.spinner} />
                            )}
                        </div>

                        {error ? (
                            <div className={styles.statusMsg}>{error}</div>
                        ) : activeItems.length === 0 &&
                          query.trim().length >= 2 &&
                          !loading ? (
                            <Combobox.Empty className={styles.statusMsg}>
                                No tickers found for "{query}"
                            </Combobox.Empty>
                        ) : (
                            <ScrollArea.Root className={styles.scrollRoot}>
                                <ScrollArea.Viewport ref={viewportRef} className={styles.scrollViewport}>
                                    <ScrollArea.Content className={styles.scrollContent}>
                                        <Combobox.ItemGroup
                                            className={styles.itemGroup}
                                        >
                                            {query.trim().length < 2 && (
                                                <Combobox.ItemGroupLabel
                                                    className={styles.sectionHeader}
                                                >
                                                    <TrendingUpIcon size={12} />
                                                    <span>Popular</span>
                                                </Combobox.ItemGroupLabel>
                                            )}
                                            {collection.items.map((item) => (
                                                <Combobox.Item
                                                    key={item.symbol}
                                                    item={item}
                                                    className={styles.itemRow}
                                                >
                                                    <TickerAvatar
                                                        symbol={item.symbol}
                                                    />
                                                    <Combobox.ItemText
                                                        className={styles.itemText}
                                                    >
                                                        <span
                                                            className={styles.itemTitle}
                                                        >
                                                            {item.symbol}
                                                        </span>
                                                        <span
                                                            className={
                                                                styles.itemSubtitle
                                                            }
                                                        >
                                                            {formatSubtitle(item)}
                                                        </span>
                                                    </Combobox.ItemText>
                                                    <Combobox.ItemIndicator
                                                        className={styles.itemCheck}
                                                    >
                                                        <CheckIcon size={14} />
                                                    </Combobox.ItemIndicator>
                                                </Combobox.Item>
                                            ))}
                                        </Combobox.ItemGroup>
                                    </ScrollArea.Content>
                                </ScrollArea.Viewport>
                                <ScrollArea.Scrollbar className={styles.scrollbar} orientation="vertical">
                                    <ScrollArea.Thumb className={styles.scrollThumb} />
                                </ScrollArea.Scrollbar>
                                <ScrollArea.Corner className={styles.corner} />
                            </ScrollArea.Root>
                        )}
                    </Combobox.Content>
                </Combobox.Positioner>
            </Portal>
        </Combobox.Root>
    );
}

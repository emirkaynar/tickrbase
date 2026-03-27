import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
    Combobox as ArkCombobox,
    useListCollection,
} from "@ark-ui/react/combobox";
import { Portal } from "@ark-ui/react/portal";
import { CheckIcon, ChevronsUpDownIcon, Loader2Icon } from "lucide-react";
import { fetchLookup } from "../../services/lookup";
import type { LookupItem } from "../../services/types";
import styles from "./TickerSelector.module.css";

type TickerSelectorItem = LookupItem;

type Props = {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
    minQueryLength?: number;
    debounceMs?: number;
};

const DEFAULT_MIN_QUERY_LENGTH = 2;
const DEFAULT_DEBOUNCE_MS = 250;

function formatSubtitle(item: TickerSelectorItem): string {
    if (item.exchange && item.company_name) {
        return `${item.exchange} · ${item.company_name}`;
    }
    return item.company_name || item.exchange || "";
}

export function TickerSelector({
    value,
    onChange,
    placeholder,
    className,
    minQueryLength = DEFAULT_MIN_QUERY_LENGTH,
    debounceMs = DEFAULT_DEBOUNCE_MS,
}: Props) {
    const [inputValue, setInputValue] = useState(value);
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [results, setResults] = useState<TickerSelectorItem[]>([]);
    const [cachedMetadata, setCachedMetadata] =
        useState<TickerSelectorItem | null>(null);
    const [isOpen, setIsOpen] = useState(false);

    const didSelectRef = useRef(false);
    const requestTokenRef = useRef(0);
    const metadataTokenRef = useRef(0);

    const fallbackItem = useMemo<TickerSelectorItem | null>(() => {
        if (!value) return null;
        const exists = results.some((item) => item.symbol === value);
        if (exists) return null;
        if (cachedMetadata?.symbol === value) {
            return cachedMetadata;
        }
        return {
            symbol: value,
            exchange: "",
            company_name: "",
            instrument_type: "saved",
        };
    }, [value, results, cachedMetadata]);

    const items = useMemo<TickerSelectorItem[]>(() => {
        if (!fallbackItem) return results;
        return [fallbackItem, ...results];
    }, [fallbackItem, results]);

    const { collection, set } = useListCollection<TickerSelectorItem>({
        initialItems: items,
        itemToString: (item) => item.symbol,
        itemToValue: (item) => item.symbol,
    });

    useEffect(() => {
        set(items);
    }, [items, set]);

    useEffect(() => {
        setInputValue(value);
    }, [value]);

    useEffect(() => {
        if (!value) {
            setCachedMetadata(null);
            return;
        }

        const exists = results.some((item) => item.symbol === value);
        if (exists) {
            setCachedMetadata(null);
            return;
        }

        const token = metadataTokenRef.current + 1;
        metadataTokenRef.current = token;
        const ctrl = new AbortController();

        // Extract the base symbol (before any exchange suffix like .IS)
        const baseSymbol = value.split(".")[0];
        const timerId = window.setTimeout(() => {
            fetchLookup(baseSymbol, ctrl.signal)
                .then((nextItems) => {
                    if (metadataTokenRef.current !== token) return;
                    const match = nextItems.find(
                        (item) => item.symbol === value,
                    );
                    if (match) {
                        setCachedMetadata(match);
                    }
                })
                .catch(() => {
                    if (metadataTokenRef.current !== token) return;
                    // Silently fail - just don't show metadata
                    setCachedMetadata(null);
                });
        }, 300);

        return () => {
            ctrl.abort();
            clearTimeout(timerId);
        };
    }, [value, results]);

    useEffect(() => {
        const normalized = query.trim();
        if (normalized.length < minQueryLength) {
            setLoading(false);
            setError("");
            setResults([]);
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
                    setResults(nextItems);
                })
                .catch((err: unknown) => {
                    if (requestTokenRef.current !== token) return;
                    if (
                        err instanceof DOMException &&
                        err.name === "AbortError"
                    ) {
                        return;
                    }
                    setError(
                        err instanceof Error
                            ? err.message
                            : "Lookup request failed",
                    );
                    setResults([]);
                })
                .finally(() => {
                    if (requestTokenRef.current !== token) return;
                    setLoading(false);
                });
        }, debounceMs);

        return () => {
            ctrl.abort();
            clearTimeout(timerId);
        };
    }, [query, minQueryLength, debounceMs]);

    return (
        <ArkCombobox.Root
            collection={collection}
            value={value ? [value] : []}
            inputValue={inputValue}
            open={isOpen}
            onValueChange={(details) => {
                const next = details.value[0] ?? "";
                if (!next) return;
                onChange(next);
                didSelectRef.current = true;
            }}
            onInputValueChange={(details) => {
                setInputValue(details.inputValue);
                if (details.reason === "input-change") {
                    setQuery(details.inputValue);
                    setIsOpen(true);
                }
            }}
            onOpenChange={(details) => {
                setIsOpen(details.open);
                if (!details.open) {
                    if (!didSelectRef.current) {
                        setInputValue(value);
                    }
                    didSelectRef.current = false;
                    setQuery("");
                    setError("");
                    setLoading(false);
                }
            }}
            positioning={{ placement: "bottom-start" }}
            loopFocus
            className={[styles.root, className].filter(Boolean).join(" ")}
        >
            <ArkCombobox.Control className={styles.control}>
                <ArkCombobox.Input
                    className={styles.input}
                    placeholder={placeholder}
                    onFocus={() => setIsOpen(true)}
                />
                <div className={styles.indicators}>
                    <ArkCombobox.Trigger className={styles.trigger}>
                        <ChevronsUpDownIcon />
                    </ArkCombobox.Trigger>
                </div>
            </ArkCombobox.Control>
            <Portal>
                <ArkCombobox.Positioner>
                    <ArkCombobox.Content className={styles.content}>
                        {loading ? (
                            <div className={styles.status}>
                                <Loader2Icon className={styles.spinner} />
                                <span>Searching...</span>
                            </div>
                        ) : error ? (
                            <div className={styles.status}>{error}</div>
                        ) : items.length === 0 ? (
                            <ArkCombobox.Empty className={styles.empty}>
                                Start typing to search tickers...
                            </ArkCombobox.Empty>
                        ) : (
                            items.map((item) => (
                                <ArkCombobox.Item
                                    key={item.symbol}
                                    item={item}
                                    className={styles.item}
                                >
                                    <ArkCombobox.ItemText
                                        className={styles.itemText}
                                    >
                                        <span className={styles.itemTitle}>
                                            {item.symbol}
                                        </span>
                                        <span className={styles.itemSubtitle}>
                                            {formatSubtitle(item)}
                                        </span>
                                    </ArkCombobox.ItemText>
                                    <ArkCombobox.ItemIndicator
                                        className={styles.itemIndicator}
                                    >
                                        <CheckIcon />
                                    </ArkCombobox.ItemIndicator>
                                </ArkCombobox.Item>
                            ))
                        )}
                    </ArkCombobox.Content>
                </ArkCombobox.Positioner>
            </Portal>
        </ArkCombobox.Root>
    );
}

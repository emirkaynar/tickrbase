import { useEffect, useRef, useState } from "preact/hooks";
import {
    Combobox as ArkCombobox,
    useListCollection,
} from "@ark-ui/react/combobox";
import { useFilter } from "@ark-ui/react/locale";
import { Portal } from "@ark-ui/react/portal";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import styles from "./Combobox.module.css";

export type ComboboxItem = { label: string; value: string };

type Props = {
    items: ComboboxItem[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    limit?: number;
    className?: string;
    disabled?: boolean;
    "aria-label"?: string;
    "aria-labelledby"?: string;
    "aria-describedby"?: string;
    invalid?: boolean;
};

export function Combobox({
    items,
    value,
    onChange,
    placeholder,
    limit = 10,
    className,
    disabled,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    "aria-describedby": ariaDescribedBy,
    invalid,
}: Props) {
    const { contains } = useFilter({ sensitivity: "base" });
    const { collection, filter, set } = useListCollection({
        initialItems: items,
        limit,
        filter: contains,
    });

    useEffect(() => {
        set(items);
    }, [items, set]);

    const getLabel = (v: string) =>
        items.find((i) => i.value === v)?.label ?? v;

    // Fully controlled input text — Ark UI only syncs the input on user-driven
    // selections, not on external `value` prop changes, so we own it ourselves.
    const [inputValue, setInputValue] = useState(() => getLabel(value));

    // Keep input in sync whenever the external value or items list changes
    // (covers Dexie rehydration on refresh and backend fetch completing).
    useEffect(() => {
        setInputValue(getLabel(value));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, items]);

    // Distinguish a real selection from a dismiss so onOpenChange doesn't
    // overwrite the input with a stale label after the user picks an item.
    const didSelectRef = useRef(false);

    return (
        <ArkCombobox.Root
            collection={collection}
            disabled={disabled}
            invalid={invalid}
            value={[value]}
            inputValue={inputValue}
            onValueChange={(d) => {
                if (d.value[0] !== undefined) {
                    onChange(d.value[0]);
                    didSelectRef.current = true;
                }
            }}
            onInputValueChange={(d) => {
                setInputValue(d.inputValue);
                filter(d.inputValue);
            }}
            onOpenChange={(d) => {
                if (!d.open) {
                    if (!didSelectRef.current) {
                        // Dismissed without selecting — restore input to current label
                        setInputValue(getLabel(value));
                    }
                    didSelectRef.current = false;
                    filter("");
                }
            }}
            openOnChange={(d) => d.reason === "input-change"}
            positioning={{ placement: "bottom-start" }}
            loopFocus
            className={[styles.root, className].filter(Boolean).join(" ")}
        >
            <ArkCombobox.Control className={styles.control}>
                <ArkCombobox.Input
                    className={styles.input}
                    placeholder={placeholder}
                    aria-label={ariaLabel}
                    aria-labelledby={ariaLabelledBy}
                    aria-describedby={ariaDescribedBy}
                    aria-invalid={invalid}
                />
                <div className={styles.indicators}>
                    <ArkCombobox.Trigger
                        className={styles.trigger}
                        aria-label={ariaLabel ? `Show options for ${ariaLabel}` : "Show options"}
                    >
                        <ChevronsUpDownIcon />
                    </ArkCombobox.Trigger>
                </div>
            </ArkCombobox.Control>
            <Portal>
                <ArkCombobox.Positioner>
                    <ArkCombobox.Content className={styles.content}>
                        <ArkCombobox.Empty className={styles.empty}>
                            No results
                        </ArkCombobox.Empty>
                        {collection.items.map((item) => (
                            <ArkCombobox.Item
                                key={item.value}
                                item={item}
                                className={styles.item}
                            >
                                <ArkCombobox.ItemText>
                                    {item.label}
                                </ArkCombobox.ItemText>
                                <ArkCombobox.ItemIndicator
                                    className={styles.itemIndicator}
                                >
                                    <CheckIcon />
                                </ArkCombobox.ItemIndicator>
                            </ArkCombobox.Item>
                        ))}
                    </ArkCombobox.Content>
                </ArkCombobox.Positioner>
            </Portal>
        </ArkCombobox.Root>
    );
}

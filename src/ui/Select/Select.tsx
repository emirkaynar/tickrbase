import {
    Select as ArkSelect,
    createListCollection,
} from "@ark-ui/react/select";
import { Portal } from "@ark-ui/react/portal";
import type { ComponentChildren } from "preact";
import { useMemo, useRef } from "preact/hooks";
import { CheckIcon, ChevronsUpDownIcon, Lock } from "lucide-react";
import styles from "./Select.module.css";

export type SelectItem = {
    label: string;
    value: string;
    disabled?: boolean;
    locked?: boolean;
};

export type SelectTriggerVariant = "default" | "icon";

export type SelectVariant = "widget" | "full";

function hasSameValues(left: string[], right: string[]): boolean {
    if (left === right) return true;
    if (left.length !== right.length) return false;

    for (let i = 0; i < left.length; i += 1) {
        if (left[i] !== right[i]) return false;
    }

    return true;
}

type Props = {
    items: SelectItem[];
    value?: string;
    onChange?: (value: string) => void;
    values?: string[];
    onValuesChange?: (values: string[]) => void;
    multiple?: boolean;
    placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end";
    className?: string;
    variant?: SelectVariant;
    triggerVariant?: SelectTriggerVariant;
    triggerIcon?: ComponentChildren;
    triggerLabel?: string;
    disabled?: boolean;
    closeOnSelect?: boolean;
    onOpenChange?: (open: boolean) => void;
};

export function Select({
    items,
    value,
    onChange,
    values,
    onValuesChange,
    multiple = false,
    placement = "bottom-start",
    className,
    variant = "widget",
    triggerVariant = "default",
    triggerIcon,
    triggerLabel = "Select",
    disabled = false,
    closeOnSelect,
    onOpenChange,
}: Props) {
    const collection = useMemo(
        () =>
            createListCollection({
                items,
                itemToString: (item) => item.label,
                itemToValue: (item) => item.value,
                isItemDisabled: (item) => Boolean(item.disabled),
            }),
        [items],
    );

    const selectedValues = useMemo(
        () => (multiple ? (values ?? []) : value ? [value] : []),
        [multiple, value, values],
    );

    const shouldCloseOnSelect = closeOnSelect ?? !multiple;
    const previousOpenRef = useRef<boolean | null>(null);

    const triggerClassName = [
        styles.trigger,
        styles[variant],
        triggerVariant === "icon" ? styles.iconTrigger : styles.defaultTrigger,
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <ArkSelect.Root
            collection={collection}
            value={selectedValues}
            multiple={multiple}
            closeOnSelect={shouldCloseOnSelect}
            disabled={disabled}
            onValueChange={(d) => {
                if (multiple) {
                    if (hasSameValues(d.value, selectedValues)) return;
                    onValuesChange?.(d.value);
                    return;
                }

                const next = d.value[0];
                if (next === value) return;
                if (next !== undefined) onChange?.(next);
            }}
            onOpenChange={(details) => {
                if (previousOpenRef.current === details.open) return;
                previousOpenRef.current = details.open;
                onOpenChange?.(details.open);
            }}
            positioning={{ placement }}
            className={[styles.root, className].filter(Boolean).join(" ")}
        >
            <ArkSelect.Control>
                {triggerVariant === "icon" ? (
                    <ArkSelect.Trigger
                        className={triggerClassName}
                        aria-label={triggerLabel}
                    >
                        <span className={styles.iconSlot}>
                            {triggerIcon ?? <ChevronsUpDownIcon />}
                        </span>
                    </ArkSelect.Trigger>
                ) : (
                    <ArkSelect.Trigger className={triggerClassName}>
                        <ArkSelect.ValueText />
                        <ArkSelect.Indicator className={styles.indicator}>
                            <ChevronsUpDownIcon />
                        </ArkSelect.Indicator>
                    </ArkSelect.Trigger>
                )}
            </ArkSelect.Control>
            <Portal>
                <ArkSelect.Positioner>
                    <ArkSelect.Content
                        className={[
                            styles.content,
                            triggerVariant === "icon" && styles.iconContent,
                        ]
                            .filter(Boolean)
                            .join(" ")}
                    >
                        {items.map((item) => (
                            <ArkSelect.Item
                                key={item.value}
                                item={item}
                                className={styles.item}
                            >
                                <ArkSelect.ItemText className={styles.itemText}>
                                    {item.label}
                                </ArkSelect.ItemText>

                                <span className={styles.itemMeta}>
                                    {item.locked && (
                                        <Lock className={styles.lockIcon} />
                                    )}
                                    <ArkSelect.ItemIndicator
                                        className={styles.itemIndicator}
                                    >
                                        <CheckIcon />
                                    </ArkSelect.ItemIndicator>
                                </span>
                            </ArkSelect.Item>
                        ))}
                    </ArkSelect.Content>
                </ArkSelect.Positioner>
            </Portal>
            <ArkSelect.HiddenSelect />
        </ArkSelect.Root>
    );
}

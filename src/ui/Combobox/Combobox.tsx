import { useEffect } from "preact/hooks";
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
};

export function Combobox({
    items,
    value,
    onChange,
    placeholder,
    limit = 10,
    className,
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

    return (
        <ArkCombobox.Root
            collection={collection}
            value={[value]}
            onValueChange={(d) => {
                if (d.value[0]) onChange(d.value[0]);
                filter("");
            }}
            onInputValueChange={(d) => filter(d.inputValue)}
            onOpenChange={(d) => {
                if (!d.open) filter("");
            }}
            inputBehavior="autohighlight"
            positioning={{ placement: "bottom-start" }}
            loopFocus
            className={[styles.root, className].filter(Boolean).join(" ")}
        >
            <ArkCombobox.Control className={styles.control}>
                <ArkCombobox.Input
                    className={styles.input}
                    placeholder={placeholder}
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

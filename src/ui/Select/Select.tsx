import {
    Select as ArkSelect,
    createListCollection,
} from "@ark-ui/react/select";
import { Portal } from "@ark-ui/react/portal";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import styles from "./Select.module.css";

export type SelectItem = { label: string; value: string };

type Props = {
    items: SelectItem[];
    value: string;
    onChange: (value: string) => void;
    placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end";
    className?: string;
};

export function Select({
    items,
    value,
    onChange,
    placement = "bottom-start",
    className,
}: Props) {
    const collection = createListCollection({ items });

    return (
        <ArkSelect.Root
            collection={collection}
            value={[value]}
            onValueChange={(d) => {
                const v = d.value[0];
                if (v !== undefined) onChange(v);
            }}
            positioning={{ placement }}
            className={[styles.root, className].filter(Boolean).join(" ")}
        >
            <ArkSelect.Control>
                <ArkSelect.Trigger className={styles.trigger}>
                    <ArkSelect.ValueText />
                    <ArkSelect.Indicator className={styles.indicator}>
                        <ChevronsUpDownIcon />
                    </ArkSelect.Indicator>
                </ArkSelect.Trigger>
            </ArkSelect.Control>
            <Portal>
                <ArkSelect.Positioner>
                    <ArkSelect.Content className={styles.content}>
                        {items.map((item) => (
                            <ArkSelect.Item
                                key={item.value}
                                item={item}
                                className={styles.item}
                            >
                                <ArkSelect.ItemText>
                                    {item.label}
                                </ArkSelect.ItemText>
                                <ArkSelect.ItemIndicator
                                    className={styles.itemIndicator}
                                >
                                    <CheckIcon />
                                </ArkSelect.ItemIndicator>
                            </ArkSelect.Item>
                        ))}
                    </ArkSelect.Content>
                </ArkSelect.Positioner>
            </Portal>
            <ArkSelect.HiddenSelect />
        </ArkSelect.Root>
    );
}

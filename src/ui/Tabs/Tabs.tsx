import type { ComponentChildren } from "preact";
import { Tabs as ArkTabs } from "@ark-ui/react/tabs";
import styles from "./Tabs.module.css";

export type TabItem = { value: string; label: ComponentChildren };

type Props = {
    items: TabItem[];
    value: string;
    onChange: (value: string) => void;
    className?: string;
};

export function Tabs({ items, value, onChange, className }: Props) {
    return (
        <ArkTabs.Root
            value={value}
            onValueChange={(d) => onChange(d.value)}
            className={[styles.root, className].filter(Boolean).join(" ")}
        >
            <ArkTabs.List className={styles.list}>
                {items.map((item) => (
                    <ArkTabs.Trigger
                        key={item.value}
                        value={item.value}
                        className={styles.trigger}
                    >
                        {item.label}
                    </ArkTabs.Trigger>
                ))}
                <ArkTabs.Indicator className={styles.indicator} />
            </ArkTabs.List>
        </ArkTabs.Root>
    );
}

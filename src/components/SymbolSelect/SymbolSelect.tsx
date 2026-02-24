import { Combobox, useListCollection } from "@ark-ui/react/combobox";
import { useFilter } from "@ark-ui/react/locale";
import { Portal } from "@ark-ui/react/portal";
import { useEffect } from "preact/hooks";
import "./SymbolSelect.css";
import type { SymbolItem } from "../../data/symbols";

export type { SymbolItem };

type Props = {
    items: SymbolItem[];
    value: string;
    onChange: (value: string) => void;
};

export function SymbolSelect({ items, value, onChange }: Props) {
    const { contains } = useFilter({ sensitivity: "base" });
    const { collection, filter, set } = useListCollection({
        initialItems: items,
        filter: contains,
    });

    // Sync collection when items prop updates (e.g. after async fetch)
    useEffect(() => {
        set(items);
    }, [items]);

    return (
        <Combobox.Root
            collection={collection}
            className="sc-combobox-root"
            value={[value]}
            onValueChange={(d) => {
                if (d.value[0]) onChange(d.value[0]);
                filter(""); // reset list so next open shows everything
            }}
            onInputValueChange={(d) => filter(d.inputValue)}
            onOpenChange={(d) => {
                if (!d.open) filter(""); // reset on dismiss (Esc, outside click, etc.)
            }}
            inputBehavior="autohighlight"
            positioning={{ placement: "bottom-start" }}
            loopFocus
        >
            <Combobox.Control className="sc-combobox-control">
                <Combobox.Input className="sc-combobox-input" />
                <div className="sc-combobox-indicators">
                    <Combobox.ClearTrigger className="sc-combobox-clear">
                        ✕
                    </Combobox.ClearTrigger>
                    <Combobox.Trigger className="sc-combobox-trigger">
                        ▾
                    </Combobox.Trigger>
                </div>
            </Combobox.Control>
            <Portal>
                <Combobox.Positioner>
                    <Combobox.Content className="sc-combobox-content">
                        <Combobox.Empty className="sc-combobox-empty">
                            No results
                        </Combobox.Empty>
                        {collection.items.map((item) => (
                            <Combobox.Item
                                key={item.value}
                                item={item}
                                className="sc-combobox-item"
                            >
                                <Combobox.ItemText>
                                    {item.label}
                                </Combobox.ItemText>
                                <Combobox.ItemIndicator className="sc-combobox-item-indicator">
                                    ✓
                                </Combobox.ItemIndicator>
                            </Combobox.Item>
                        ))}
                    </Combobox.Content>
                </Combobox.Positioner>
            </Portal>
        </Combobox.Root>
    );
}

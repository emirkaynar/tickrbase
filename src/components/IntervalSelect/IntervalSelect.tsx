import { Select, createListCollection } from "@ark-ui/react/select";
import { Portal } from "@ark-ui/react/portal";
import type { Interval } from "../../data/types";
import { INTERVALS, INTERVAL_CONFIG } from "../../data/types";
import "./IntervalSelect.css";

const collection = createListCollection({
    items: INTERVALS.map((iv) => ({
        label: INTERVAL_CONFIG[iv].label,
        value: iv,
    })),
});

type Props = {
    value: Interval;
    onChange: (value: Interval) => void;
};

export function IntervalSelect({ value, onChange }: Props) {
    return (
        <Select.Root
            collection={collection}
            className="sc-interval-root"
            value={[value]}
            onValueChange={(d) => {
                const v = d.value[0] as Interval | undefined;
                if (v) onChange(v);
            }}
            positioning={{ placement: "bottom-end" }}
        >
            <Select.Control>
                <Select.Trigger className="sc-interval-trigger">
                    <Select.ValueText />▾
                </Select.Trigger>
            </Select.Control>
            <Portal>
                <Select.Positioner>
                    <Select.Content className="sc-interval-content">
                        {collection.items.map((item) => (
                            <Select.Item
                                key={item.value}
                                item={item}
                                className="sc-interval-item"
                            >
                                <Select.ItemText>{item.label}</Select.ItemText>
                                <Select.ItemIndicator className="sc-interval-indicator">
                                    ✓
                                </Select.ItemIndicator>
                            </Select.Item>
                        ))}
                    </Select.Content>
                </Select.Positioner>
            </Portal>
            <Select.HiddenSelect />
        </Select.Root>
    );
}

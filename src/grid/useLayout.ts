import { useEffect, useRef, useState } from "preact/hooks";
import type { LayoutItem } from "react-grid-layout";
import { db } from "../db";

const LAYOUT_KEY = "main";

const ALL_HANDLES: LayoutItem["resizeHandles"] = [
    "s",
    "w",
    "e",
    "n",
    "sw",
    "nw",
    "se",
    "ne",
];

const DEFAULT_LAYOUT: LayoutItem[] = [
    {
        i: "stock-chart-0",
        x: 0,
        y: 0,
        w: 7,
        h: 9,
        minW: 3,
        minH: 4,
        resizeHandles: ALL_HANDLES,
    },
];

// Ensure every loaded item has resizeHandles (items saved before this feature won't)
function withHandles(items: LayoutItem[]): LayoutItem[] {
    return items.map((item) =>
        item.resizeHandles ? item : { ...item, resizeHandles: ALL_HANDLES },
    );
}

// Simple debounce — avoids IndexedDB writes on every px drag
function debounce<T extends unknown[]>(
    fn: (...args: T) => void,
    delay: number,
) {
    let timer: ReturnType<typeof setTimeout>;
    return (...args: T) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

export function useLayout() {
    const [layout, setLayout] = useState<LayoutItem[]>(DEFAULT_LAYOUT);
    const [ready, setReady] = useState(false);

    // Load persisted layout on mount
    useEffect(() => {
        db.layout.get(LAYOUT_KEY).then((record) => {
            if (record?.items?.length) {
                setLayout(withHandles(record.items));
            }
            setReady(true);
        });
    }, []);

    // Debounced write — fires 500 ms after last drag/resize event
    const persist = useRef(
        debounce((items: LayoutItem[]) => {
            db.layout.put({ id: LAYOUT_KEY, items });
        }, 500),
    );

    const onLayoutChange = (items: LayoutItem[]) => {
        setLayout(items);
        persist.current(items);
    };

    return { layout, onLayoutChange, ready } as const;
}

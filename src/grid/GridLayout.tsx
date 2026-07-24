import { useState, useEffect } from "preact/hooks";
import {
    GridLayout as RGL,
    getCompactor,
    useContainerWidth,
} from "react-grid-layout";
import type { Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { getWidgetDefinition, type WidgetInstance } from "../widgets/registry";
import { calculateGridConstraints, GRID_COLS, GRID_MARGIN } from "./constraints";
import styles from "./GridLayout.module.css";

type Props = {
    layout: Layout;
    widgets: WidgetInstance[];
    onLayoutChange: (layout: Layout) => void;
    onRemoveWidget: (id: string) => void;
};

export function GridLayout({
    layout,
    widgets,
    onLayoutChange,
    onRemoveWidget,
}: Props) {
    const { width, containerRef, mounted } = useContainerWidth();
    const [showGuide, setShowGuide] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const [containerHeight, setContainerHeight] = useState(() => window.innerHeight);

    useEffect(() => {
        const onResize = () => setContainerHeight(window.innerHeight);
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    if (!mounted) {
        return <div ref={containerRef as never} class={styles.shell} />;
    }

    const constraints = calculateGridConstraints(containerHeight);
    const stableWidth = Math.floor(width);

    return (
        <div
            ref={containerRef as never}
            class={[
                styles.shell,
                showGuide ? styles.guided : "",
                isResizing ? styles.resizing : "",
            ]
                .filter(Boolean)
                .join(" ")}
        >
            <div
                class={styles.guide}
                style={{
                    backgroundSize: `${stableWidth / GRID_COLS}px ${constraints.rowHeight + GRID_MARGIN[1]}px`,
                }}
            />
            <RGL
                layout={layout}
                onLayoutChange={(l) => onLayoutChange([...l])}
                width={stableWidth}
                style={{ minHeight: `calc(100vh - var(--topbar-height))` }}
                gridConfig={{
                    cols: GRID_COLS,
                    rowHeight: constraints.rowHeight,
                    margin: GRID_MARGIN,
                }}
                dragConfig={{ handle: ".sc-drag-grip", bounded: true }}
                compactor={getCompactor(null, false, true)}
                onDragStart={() => setShowGuide(true)}
                onDragStop={() => setShowGuide(false)}
                onResizeStart={() => {
                    setShowGuide(true);
                    setIsResizing(true);
                }}
                onResizeStop={() => {
                    setShowGuide(false);
                    setIsResizing(false);
                }}
            >
                {widgets.map((widget) => {
                    const def = getWidgetDefinition(widget.type);
                    const WidgetComponent = def.component;
                    return (
                        <div
                            key={widget.id}
                            class={styles.slot}
                            style={{ "--w": widget.w, "--h": widget.h } as any}
                        >
                            <div style={{ height: "100%" }}>
                                <WidgetComponent
                                    id={widget.id}
                                    onRemove={() => onRemoveWidget(widget.id)}
                                />
                            </div>
                        </div>
                    );
                })}
            </RGL>
        </div>
    );
}

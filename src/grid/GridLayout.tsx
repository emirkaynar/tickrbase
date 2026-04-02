import { useState } from "preact/hooks";
import {
    GridLayout as RGL,
    getCompactor,
    useContainerWidth,
} from "react-grid-layout";
import type { Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { getWidgetDefinition, type WidgetInstance } from "../widgets/registry";
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

    if (!mounted) {
        return <div ref={containerRef as never} class={styles.shell} />;
    }

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
            {showGuide && (
                <div
                    class={styles.guide}
                    style={{ backgroundSize: `${width / 30}px 30px` }}
                />
            )}
            <RGL
                layout={layout}
                onLayoutChange={(l) => onLayoutChange([...l])}
                width={width}
                gridConfig={{
                    cols: 30,
                    rowHeight: 24,
                    margin: [6, 6] as [number, number],
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
                        <div key={widget.id} class={styles.slot}>
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

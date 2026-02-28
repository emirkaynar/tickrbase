import {
    GridLayout as RGL,
    getCompactor,
    useContainerWidth,
} from "react-grid-layout";
import type { Layout } from "react-grid-layout";
import { useState, useEffect } from "preact/hooks";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { WidgetInstance } from "../widgets/registry";
import { getWidgetDefinition } from "../widgets/registry";

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
    const [maxRows, setMaxRows] = useState(Infinity);

    // Calculate max rows based on container height
    useEffect(() => {
        if (mounted && containerRef.current) {
            const height = (containerRef.current as HTMLElement).offsetHeight;
            const rowHeight = 24;
            const margin = 6;
            const calculatedMaxRows = Math.floor(
                (height + margin) / (rowHeight + margin),
            );
            setMaxRows(calculatedMaxRows);
        }
    }, [mounted, containerRef]);

    if (!mounted)
        return <div ref={containerRef as never} style={{ width: "100%" }} />;

    return (
        <div
            ref={containerRef as never}
            class={`grid-shell ${showGuide ? "grid-shell-guided" : ""} ${isResizing ? "grid-shell-resizing" : ""}`}
        >
            {showGuide ? (
                <div
                    class="grid-guide"
                    style={{
                        backgroundSize: `${width / 30}px 30px`,
                    }}
                />
            ) : null}
            <RGL
                layout={layout as Layout}
                onLayoutChange={(l) => onLayoutChange([...l])}
                width={width}
                gridConfig={{
                    cols: 30,
                    rowHeight: 24,
                    margin: [6, 6] as [number, number],
                    maxRows,
                }}
                dragConfig={{ handle: ".sc-drag-grip" }}
                compactor={getCompactor("wrap", false, true)}
                autoSize={false}
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
                        <div key={widget.id} class="grid-widget-slot">
                            <button
                                type="button"
                                class="grid-widget-remove"
                                onClick={() => onRemoveWidget(widget.id)}
                            >
                                ×
                            </button>
                            <div style={{ height: "100%" }}>
                                <WidgetComponent id={widget.id} />
                            </div>
                        </div>
                    );
                })}
            </RGL>
        </div>
    );
}

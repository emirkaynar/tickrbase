import { GridLayout as RGL, useContainerWidth } from "react-grid-layout";
import type { Layout } from "react-grid-layout";
import type { ComponentChildren } from "preact";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useLayout } from "./useLayout";

type Props = {
    children: ComponentChildren;
};

export function GridLayout({ children }: Props) {
    const { layout, onLayoutChange, ready } = useLayout();
    const { width, containerRef, mounted } = useContainerWidth();

    // Wait for persisted layout and container measurement before rendering
    if (!ready || !mounted)
        return <div ref={containerRef as never} style={{ width: "100%" }} />;

    return (
        <div ref={containerRef as never}>
            <RGL
                layout={layout as Layout}
                onLayoutChange={(l) => onLayoutChange([...l])}
                width={width}
                gridConfig={{
                    cols: 12,
                    rowHeight: 60,
                    margin: [8, 8] as [number, number],
                }}
                dragConfig={{ handle: ".sc-drag-grip" }}
            >
                {children}
            </RGL>
        </div>
    );
}

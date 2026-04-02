import type { WidgetInstance } from "../widgets/registry";

export type GridConstraints = {
    maxRows: number;
    maxCols: number;
    availableHeight: number;
    rowHeight: number;
};

/**
 * Calculate grid constraints based on container height
 * Accounts for topbar (36px) and margins
 */
export function calculateGridConstraints(
    containerHeight: number,
): GridConstraints {
    const TOPBAR_HEIGHT = 36;
    const MARGIN = 6;
    const ROW_HEIGHT = 24;

    const availableHeight = Math.max(
        containerHeight - TOPBAR_HEIGHT,
        ROW_HEIGHT,
    );

    // RGL row stack uses rowHeight + vertical margin per row.
    const maxRows = Math.floor(
        (availableHeight + MARGIN) / (ROW_HEIGHT + MARGIN),
    );

    return {
        maxRows,
        maxCols: 30,
        availableHeight,
        rowHeight: ROW_HEIGHT,
    };
}

export function findBottomPlacement(
    widgets: WidgetInstance[],
    size: { w: number; h: number },
    constraints: GridConstraints,
): { x: number; y: number } | null {
    if (size.w > constraints.maxCols || size.h > constraints.maxRows) {
        return null;
    }

    const maxY =
        widgets.length === 0 ? 0 : Math.max(...widgets.map((w) => w.y + w.h));
    if (maxY + size.h > constraints.maxRows) return null;
    return { x: 0, y: maxY };
}

/**
 * Find all available non-overlapping positions for a given size.
 */
function findAvailablePositions(
    widgets: WidgetInstance[],
    size: { w: number; h: number },
    constraints: GridConstraints,
): Array<{ x: number; y: number }> {
    if (size.w > constraints.maxCols || size.h > constraints.maxRows) {
        return [];
    }

    const matches: Array<{ x: number; y: number }> = [];

    for (let y = 0; y <= constraints.maxRows - size.h; y++) {
        for (let x = 0; x <= constraints.maxCols - size.w; x++) {
            const overlaps = widgets.some((widget) => {
                const right = x + size.w;
                const bottom = y + size.h;
                const widgetRight = widget.x + widget.w;
                const widgetBottom = widget.y + widget.h;

                return !(
                    right <= widget.x ||
                    x >= widgetRight ||
                    bottom <= widget.y ||
                    y >= widgetBottom
                );
            });

            if (!overlaps) matches.push({ x, y });
        }
    }

    return matches;
}

function findFirstAvailablePosition(
    widgets: WidgetInstance[],
    size: { w: number; h: number },
    constraints: GridConstraints,
): { x: number; y: number } | null {
    const positions = findAvailablePositions(widgets, size, constraints);
    if (positions.length === 0) return null;

    return positions.reduce((best, pos) =>
        pos.y < best.y || (pos.y === best.y && pos.x < best.x) ? pos : best,
    );
}

/**
 * Free-placement size fallback (no compaction, no layout mutation).
 * Priority: default size -> shrink width -> shrink height.
 */
export function findFittingSize(
    widgets: WidgetInstance[],
    defaultSize: { w: number; h: number },
    minSize: { w: number; h: number },
    constraints: GridConstraints,
): {
    size: { w: number; h: number };
    position: { x: number; y: number };
} | null {
    let pos = findFirstAvailablePosition(widgets, defaultSize, constraints);
    if (pos) {
        return { size: defaultSize, position: pos };
    }

    for (let w = defaultSize.w - 1; w >= minSize.w; w--) {
        const size = { w, h: defaultSize.h };
        pos = findFirstAvailablePosition(widgets, size, constraints);
        if (pos) {
            return { size, position: pos };
        }
    }

    for (let h = defaultSize.h - 1; h >= minSize.h; h--) {
        const size = { w: minSize.w, h };
        pos = findFirstAvailablePosition(widgets, size, constraints);
        if (pos) {
            return { size, position: pos };
        }
    }

    return null;
}

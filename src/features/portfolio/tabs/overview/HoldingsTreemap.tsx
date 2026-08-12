import { useMemo } from "preact/hooks";
import { Group } from "@visx/group";
import { Treemap, treemapSquarify } from "@visx/hierarchy";
import { ParentSize } from "@visx/responsive";
import { defaultStyles, TooltipWithBounds, useTooltip } from "@visx/tooltip";
import { hierarchy } from "d3-hierarchy";
import type { PositionResponse } from "../../../../services/types";
import { Skeleton } from "../../../../ui";
import { formatCurrency, formatPercent } from "../../../../utils";
import styles from "./overview.module.css";

interface Props {
    positions: PositionResponse[];
    loading?: boolean;
    baseCurrency: string;
}

interface TreemapDatum {
    id: string;
    size?: number;
    pos?: PositionResponse;
    color?: string;
    children?: TreemapDatum[];
}

function VisxTreemapInner({
    sortedPositions,
    baseCurrency,
}: {
    sortedPositions: PositionResponse[];
    baseCurrency: string;
}) {
    const {
        tooltipOpen,
        tooltipLeft,
        tooltipTop,
        tooltipData,
        showTooltip,
        hideTooltip,
    } = useTooltip<PositionResponse>();

    const rootData: TreemapDatum = useMemo(() => {
        return {
            id: "root",
            children: sortedPositions.map((pos) => {
                const isPos = pos.pnl_percent >= 0;
                const absPct = Math.min(Math.abs(pos.pnl_percent), 50) / 50;
                const color = isPos
                    ? `color-mix(in srgb, var(--color-bull) ${Math.round(45 + absPct * 55)}%, var(--color-bg-surface))`
                    : `color-mix(in srgb, var(--color-bear) ${Math.round(45 + absPct * 55)}%, var(--color-bg-surface))`;

                return {
                    id: pos.ticker,
                    size: Math.max(1, pos.market_value || 1),
                    pos,
                    color,
                };
            }),
        };
    }, [sortedPositions]);

    const hierarchyRoot = useMemo(() => {
        return hierarchy<TreemapDatum>(rootData)
            .sum((d) => d.size || 0)
            .sort((a, b) => (b.value || 0) - (a.value || 0));
    }, [rootData]);

    return (
        <ParentSize>
            {({ width, height }) => {
                if (width <= 0 || height <= 0) return null;

                return (
                    <div style={{ position: "relative", width: "100%", height: "100%" }}>
                        <svg width={width} height={height}>
                            <Treemap<TreemapDatum>
                                root={hierarchyRoot}
                                size={[width, height]}
                                tile={treemapSquarify}
                                round
                                paddingInner={2}
                            >
                                {(treemap) => {
                                    return (
                                        <Group>
                                            {treemap.descendants().map((node, i) => {
                                                if (node.depth === 0) return null; // skip root node

                                                const nodeWidth = node.x1 - node.x0;
                                                const nodeHeight = node.y1 - node.y0;
                                                if (nodeWidth <= 0 || nodeHeight <= 0) return null;

                                                const pos = node.data.pos;
                                                const color = node.data.color || "var(--color-bg-surface)";

                                                return (
                                                    <Group key={`treemap-node-${i}`} top={node.y0} left={node.x0}>
                                                        <rect
                                                            width={nodeWidth}
                                                            height={nodeHeight}
                                                            fill={color}
                                                            stroke="var(--color-bg)"
                                                            strokeWidth={1}
                                                            rx={4}
                                                            ry={4}
                                                            style={{ cursor: "pointer", transition: "opacity 0.15s ease" }}
                                                            onPointerMove={(event) => {
                                                                if (!pos) return;
                                                                const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
                                                                showTooltip({
                                                                    tooltipData: pos,
                                                                    tooltipLeft: event.clientX - rect.left + node.x0,
                                                                    tooltipTop: event.clientY - rect.top + node.y0,
                                                                });
                                                            }}
                                                            onPointerLeave={() => hideTooltip()}
                                                        />
                                                        {nodeWidth > 32 && nodeHeight > 18 && (
                                                            <text
                                                                x={nodeWidth / 2}
                                                                y={nodeHeight / 2}
                                                                textAnchor="middle"
                                                                dominantBaseline="central"
                                                                fill="#ffffff"
                                                                fontSize={11}
                                                                fontWeight="bold"
                                                                pointerEvents="none"
                                                            >
                                                                {node.data.id}
                                                            </text>
                                                        )}
                                                    </Group>
                                                );
                                            })}
                                        </Group>
                                    );
                                }}
                            </Treemap>
                        </svg>

                        {tooltipOpen && tooltipData && (
                            <TooltipWithBounds
                                top={tooltipTop}
                                left={tooltipLeft}
                                style={{
                                    ...defaultStyles,
                                    background: "var(--color-bg-surface)",
                                    color: "var(--color-text)",
                                    border: "1px solid var(--color-border)",
                                    borderRadius: "var(--radius-sm)",
                                    padding: "6px 10px",
                                    fontSize: "var(--font-size-xs)",
                                    fontFamily: "var(--font-family-mono)",
                                    boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
                                    zIndex: 100,
                                }}
                            >
                                <div style={{ fontWeight: "bold" }}>
                                    {tooltipData.ticker} ({tooltipData.asset_class})
                                </div>
                                <div>
                                    Value: <strong>{formatCurrency(tooltipData.market_value, baseCurrency)}</strong>
                                </div>
                                <div>
                                    Weight: <strong>{formatPercent(tooltipData.weight_percent)}</strong>
                                </div>
                                <div
                                    style={{
                                        color: tooltipData.pnl_percent >= 0 ? "var(--color-bull)" : "var(--color-bear)",
                                        fontWeight: "bold",
                                    }}
                                >
                                    P/L: {formatCurrency(tooltipData.pnl, baseCurrency)} ({formatPercent(tooltipData.pnl_percent)})
                                </div>
                            </TooltipWithBounds>
                        )}
                    </div>
                );
            }}
        </ParentSize>
    );
}

export function HoldingsTreemap({ positions, loading, baseCurrency }: Props) {
    const sortedPositions = useMemo(() => {
        if (!positions.length) return [];
        return [...positions].sort((a, b) => b.weight_percent - a.weight_percent);
    }, [positions]);

    return (
        <div className={styles.card}>
            <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>Holdings Treemap</h3>
            </div>

            {loading ? (
                <Skeleton height="200px" width="100%" />
            ) : !positions.length ? (
                <div className={styles.xrayPlaceholder}>
                    Add positions to view holdings treemap.
                </div>
            ) : (
                <div className={styles.treemapWrapper}>
                    <div className={styles.treemapChartBox}>
                        <VisxTreemapInner sortedPositions={sortedPositions} baseCurrency={baseCurrency} />
                    </div>
                </div>
            )}
        </div>
    );
}

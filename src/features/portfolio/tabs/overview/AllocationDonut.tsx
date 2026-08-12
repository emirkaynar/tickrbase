import { useMemo, useState } from "preact/hooks";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { Pie } from "@visx/shape";
import { defaultStyles, TooltipWithBounds, useTooltip } from "@visx/tooltip";
import type { PositionResponse } from "../../../../services/types";
import { Select, Skeleton } from "../../../../ui";
import { formatCurrency, formatPercent } from "../../../../utils";
import styles from "./overview.module.css";

interface Props {
    positions: PositionResponse[];
    loading?: boolean;
    baseCurrency: string;
}

export type GroupByDimension =
    | "asset_class"
    | "currency"
    | "exchange"
    | "sector"
    | "country"
    | "ticker";

export const GROUP_BY_OPTIONS: { value: GroupByDimension; label: string }[] = [
    { value: "asset_class", label: "Asset Class" },
    { value: "currency", label: "Currency" },
    { value: "exchange", label: "Exchange / Market" },
    { value: "sector", label: "Sector" },
    { value: "country", label: "Country / Region" },
    { value: "ticker", label: "Top Symbols" },
];

const CATEGORY_COLORS: Record<string, string> = {
    Equity: "#3b82f6",
    ETF: "#06b6d4",
    Crypto: "#f59e0b",
    Forex: "#10b981",
    "Mutual Fund": "#8b5cf6",
    Commodity: "#ec4899",
    Index: "#64748b",

    TRY: "#ef4444",
    USD: "#10b981",
    EUR: "#3b82f6",
    GBP: "#8b5cf6",

    BIST: "#ef4444",
    "US Equities": "#3b82f6",
    "Crypto Market": "#f59e0b",
    "TEFAS / Fund": "#8b5cf6",

    Turkey: "#ef4444",
    "United States": "#3b82f6",
    Europe: "#06b6d4",
    "Global / Crypto": "#f59e0b",
};

const FALLBACK_PALETTE = [
    "#3b82f6",
    "#10b981",
    "#f59e0b",
    "#8b5cf6",
    "#ef4444",
    "#06b6d4",
    "#ec4899",
    "#64748b",
];

interface DonutItem {
    label: string;
    value: number;
    pct: number;
    color: string;
}

function resolveGroupKey(p: PositionResponse, dimension: GroupByDimension): string {
    switch (dimension) {
        case "asset_class":
            return p.asset_class || "Equity";
        case "currency":
            return p.currency || "USD";
        case "exchange": {
            if (p.ticker.endsWith(".IS")) return "BIST";
            if (p.asset_class === "Crypto" || p.ticker.includes("-USD") || p.ticker.includes("-EUR"))
                return "Crypto Market";
            if (p.currency === "USD") return "US Equities";
            return "Other Exchange";
        }
        case "sector":
            return p.sector || "Unassigned";
        case "country": {
            if (p.ticker.endsWith(".IS")) return "Turkey";
            if (p.currency === "USD" && p.asset_class !== "Crypto") return "United States";
            if (p.currency === "EUR") return "Europe";
            if (p.asset_class === "Crypto") return "Global / Crypto";
            return "Other";
        }
        case "ticker":
            return p.ticker;
        default:
            return p.asset_class || "Equity";
    }
}

function VisxDonutInner({
    items,
    baseCurrency,
}: {
    items: DonutItem[];
    baseCurrency: string;
}) {
    const {
        tooltipOpen,
        tooltipLeft,
        tooltipTop,
        tooltipData,
        showTooltip,
        hideTooltip,
    } = useTooltip<DonutItem>();

    return (
        <ParentSize>
            {({ width, height }) => {
                const size = Math.min(width, height);
                const radius = size / 2;
                const innerRadius = radius * 0.65;
                const centerX = width / 2;
                const centerY = height / 2;

                return (
                    <div style={{ position: "relative", width: "100%", height: "100%" }}>
                        <svg width={width} height={height}>
                            <Group top={centerY} left={centerX}>
                                <Pie
                                    data={items}
                                    pieValue={(d) => d.value}
                                    outerRadius={radius - 4}
                                    innerRadius={innerRadius}
                                    padAngle={0.02}
                                    cornerRadius={4}
                                >
                                    {(pie) => {
                                        return pie.arcs.map((arc, index) => {
                                            const path = pie.path(arc) || "";
                                            const item = arc.data;

                                            return (
                                                <g key={`arc-${item.label}-${index}`}>
                                                    <path
                                                        d={path}
                                                        fill={item.color}
                                                        style={{ cursor: "pointer", transition: "opacity 0.15s ease" }}
                                                        onPointerMove={(event) => {
                                                            const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
                                                            showTooltip({
                                                                tooltipData: item,
                                                                tooltipLeft: event.clientX - rect.left,
                                                                tooltipTop: event.clientY - rect.top,
                                                            });
                                                        }}
                                                        onPointerLeave={() => hideTooltip()}
                                                    />
                                                </g>
                                            );
                                        });
                                    }}
                                </Pie>
                            </Group>
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
                                <div style={{ fontWeight: "bold" }}>{tooltipData.label}</div>
                                <div>{formatCurrency(tooltipData.value, baseCurrency)}</div>
                                <div style={{ color: "var(--color-text-muted)" }}>{formatPercent(tooltipData.pct)} share</div>
                            </TooltipWithBounds>
                        )}
                    </div>
                );
            }}
        </ParentSize>
    );
}

export function AllocationDonut({ positions, loading, baseCurrency }: Props) {
    const [dimension, setDimension] = useState<GroupByDimension>("asset_class");

    const { items, totalValue } = useMemo(() => {
        if (!positions.length) return { items: [], totalValue: 0 };

        const grouped = new Map<string, number>();
        let sumVal = 0;

        for (const p of positions) {
            const val = p.market_value || 0;
            sumVal += val;
            const key = resolveGroupKey(p, dimension);
            grouped.set(key, (grouped.get(key) || 0) + val);
        }

        let rawList = Array.from(grouped.entries()).map(([label, value]) => ({
            label,
            value,
            pct: sumVal > 0 ? (value / sumVal) * 100 : 0,
        }));

        rawList.sort((a, b) => b.value - a.value);

        let list = rawList;
        if (rawList.length > 6) {
            const top5 = rawList.slice(0, 5);
            const tail = rawList.slice(5);
            const tailVal = tail.reduce((acc, x) => acc + x.value, 0);
            const tailPct = sumVal > 0 ? (tailVal / sumVal) * 100 : 0;
            if (tailVal > 0) {
                list = [...top5, { label: "Others", value: tailVal, pct: tailPct }];
            }
        }

        const itemsWithColors: DonutItem[] = list.map((item, idx) => ({
            ...item,
            color:
                CATEGORY_COLORS[item.label] ||
                FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length],
        }));

        return { items: itemsWithColors, totalValue: sumVal };
    }, [positions, dimension]);

    return (
        <div className={styles.card}>
            <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>Asset Allocation</h3>
                <div className={styles.controlsGroup}>
                    <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", fontWeight: "bold" }}>
                        Group By
                    </span>
                    <Select
                        value={dimension}
                        onChange={(val) => setDimension(val as GroupByDimension)}
                        items={GROUP_BY_OPTIONS}
                    />
                </div>
            </div>

            {loading ? (
                <div style={{ height: "200px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Skeleton height="160px" width="160px" variant="circle" />
                </div>
            ) : !positions.length ? (
                <div className={styles.xrayPlaceholder}>
                    No position data available for allocation donut.
                </div>
            ) : (
                <div className={styles.donutWrapper}>
                    <div className={styles.donutChartBox}>
                        <VisxDonutInner items={items} baseCurrency={baseCurrency} />
                        <div className={styles.donutCenterOverlay}>
                            <span className={styles.donutCenterLabel}>Total Value</span>
                            <span className={styles.donutCenterValue}>
                                {formatCurrency(totalValue, baseCurrency, { compact: true })}
                            </span>
                        </div>
                    </div>

                    <div className={styles.legendGrid}>
                        {items.map((item) => (
                            <div key={item.label} className={styles.legendItem}>
                                <span className={styles.legendDot} style={{ background: item.color }} />
                                <span className={styles.legendLabel} title={item.label}>
                                    {item.label}
                                </span>
                                <span className={styles.legendPct}>{formatPercent(item.pct)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

import type { IChartApi, ISeriesPrimitive, IPrimitivePaneView, IPrimitivePaneRenderer, SeriesAttachedParameter, Time, UTCTimestamp } from "lightweight-charts";
import type { MarketContext } from "../../services/types";
import type { ObservationGap } from "./observationGaps";
import { getChartColors } from "../../styles/tokens";

/** Boundary timestamps live on a separate whitespace series, never on prices. */
export class SessionLines implements ISeriesPrimitive<Time> {
    private chart: IChartApi | null = null;
    private requestUpdate: (() => void) | null = null;
    private boundaries: { time: number }[] = [];
    private positions: { x: number }[] = [];
    private gaps: ObservationGap[] = [];
    private gapPositions: { left: number; right: number }[] = [];
    private renderer: IPrimitivePaneRenderer = {
        draw: target => this.draw(target),
    };
    // Keep the canvas API's use* method outside callbacks that Prefresh scans for hooks.
    private draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0]): void {
        target.useMediaCoordinateSpace(({ context, mediaSize }) => {
            context.save();
            const colors = getChartColors();
            context.globalAlpha = 0.8;
            context.lineWidth = 1;
            for (const { x } of this.positions) {
                if (x < 0 || x > mediaSize.width) continue;
                context.strokeStyle = colors.amber;
                context.setLineDash([1, 4]);
                context.beginPath();
                context.moveTo(Math.round(x) + 0.5, 0);
                context.lineTo(Math.round(x) + 0.5, mediaSize.height);
                context.stroke();
            }
            context.globalAlpha = 0.08;
            context.fillStyle = getChartColors().warning;
            for (const { left, right } of this.gapPositions) {
                context.fillRect(left, 0, right - left, mediaSize.height);
            }
            context.globalAlpha = 0.8;
            context.fillStyle = getChartColors().textMuted;
            context.font = "10px monospace";
            for (const { left, right } of this.gapPositions) {
                if (right - left > 100) context.fillText("No data", Math.max(0, left) + 4, mediaSize.height - 8);
            }
            context.restore();
        });
    }
    private view: IPrimitivePaneView = { zOrder: () => "bottom", renderer: () => this.renderer };
    attached({ chart, requestUpdate }: SeriesAttachedParameter<Time>): void { this.chart = chart; this.requestUpdate = requestUpdate; }
    detached(): void { this.chart = null; this.requestUpdate = null; }
    setContext(context: MarketContext | null, gaps: ObservationGap[], latestBarTime: number | null): void {
        this.gaps = gaps;
        this.boundaries = latestBarTime === null ? [] : context?.sessions
                    .filter(s => s.regular_close <= latestBarTime)
                    .map(s => ({ time: s.regular_close })) ?? [];
        this.requestUpdate?.();
    }
    updateAllViews(): void {
        this.gapPositions = this.gaps.flatMap(gap => {
            const left = this.chart?.timeScale().timeToCoordinate(gap.start as UTCTimestamp);
            const right = this.chart?.timeScale().timeToCoordinate(gap.end as UTCTimestamp);
            return left == null || right == null ? [] : [{ left, right }];
        });
        this.positions = this.boundaries.flatMap(b => {
            const x = this.chart?.timeScale().timeToCoordinate(b.time as UTCTimestamp);
            return x == null ? [] : [{ x }];
        });
    }
    paneViews(): readonly IPrimitivePaneView[] { return [this.view]; }
}

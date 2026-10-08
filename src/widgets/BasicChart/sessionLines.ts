import type { IChartApi, ISeriesPrimitive, IPrimitivePaneView, IPrimitivePaneRenderer, SeriesAttachedParameter, Time, UTCTimestamp } from "lightweight-charts";
import type { MarketContext } from "../../services/types";
import type { ObservationGap } from "./observationGaps";
import { getChartColors } from "../../styles/tokens";

/** Boundary timestamps live on a separate whitespace series, never on prices. */
export class SessionLines implements ISeriesPrimitive<Time> {
    private chart: IChartApi | null = null;
    private requestUpdate: (() => void) | null = null;
    private boundaries: { time: number; open: boolean }[] = [];
    private positions: { x: number; open: boolean }[] = [];
    private gaps: ObservationGap[] = [];
    private gapPositions: { left: number; right: number }[] = [];
    private renderer: IPrimitivePaneRenderer = {
        draw: target => this.draw(target),
    };
    // Keep the canvas API's use* method outside callbacks that Prefresh scans for hooks.
    private draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0]): void {
        target.useMediaCoordinateSpace(({ context, mediaSize }) => {
            context.save();
            context.strokeStyle = getChartColors().textSubtle;
            context.globalAlpha = 0.45;
            context.lineWidth = 1;
            for (const { x, open } of this.positions) {
                if (x < 0 || x > mediaSize.width) continue;
                context.setLineDash(open ? [4, 4] : [1, 4]);
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
                if (right - left > 100) context.fillText("No observations", Math.max(0, left) + 4, mediaSize.height - 8);
            }
            context.restore();
        });
    }
    private view: IPrimitivePaneView = { zOrder: () => "bottom", renderer: () => this.renderer };
    attached({ chart, requestUpdate }: SeriesAttachedParameter<Time>): void { this.chart = chart; this.requestUpdate = requestUpdate; }
    detached(): void { this.chart = null; this.requestUpdate = null; }
    setContext(context: MarketContext | null, gaps: ObservationGap[] = []): void {
        this.gaps = gaps;
        this.boundaries = context?.sessions.flatMap(s => [{ time: s.regular_open, open: true }, { time: s.regular_close, open: false }]) ?? [];
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
            return x == null ? [] : [{ x, open: b.open }];
        });
    }
    paneViews(): readonly IPrimitivePaneView[] { return [this.view]; }
}

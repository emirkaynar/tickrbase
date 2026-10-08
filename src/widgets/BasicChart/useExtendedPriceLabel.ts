import { useEffect, useRef } from "preact/hooks";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { ChartType, Interval, ScaleMode } from "../../services/types";
import { livePricesClient } from "../../services/livePrices";
import type { useChartData } from "./useChartData";
import { extendedQuote } from "./sessionPolicy";
import { QuotePriceLabel } from "./quotePriceLabel";

export function useExtendedPriceLabel(
    chartRef: { current: IChartApi | null }, seriesRef: { current: ISeriesApi<any> | null },
    symbol: string, interval: Interval, chartType: ChartType, scaleMode: ScaleMode, data: ReturnType<typeof useChartData>,
) {
    const dataRef = useRef(data);
    dataRef.current = data;
    const refreshRef = useRef<(() => void) | null>(null);
    useEffect(() => {
        const chart = chartRef.current, series = seriesRef.current;
        if (!chart || !series) return;
        const label = new QuotePriceLabel(chart, series);
        const refresh = () => {
            const snapshot = dataRef.current;
            const tick = snapshot.lastTick;
            label.update(snapshot.marketContext?.ticker === symbol && tick?.source === snapshot.source
                ? extendedQuote(snapshot.marketContext, tick, livePricesClient.now()) : null);
        };
        refreshRef.current = refresh;
        refresh();
        const timer = window.setInterval(refresh, 1000);
        return () => {
            window.clearInterval(timer);
            refreshRef.current = null;
            // BasicChart may already have removed the old series/chart during recreation.
            label.dispose(chartRef.current === chart && seriesRef.current === series);
        };
    }, [chartRef, seriesRef, symbol, interval, chartType, scaleMode]);
    useEffect(() => { refreshRef.current?.(); }, [data.lastTick, data.marketContext, data.source]);
}

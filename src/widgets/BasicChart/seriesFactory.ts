import type { IChartApi, ISeriesApi } from "lightweight-charts";
import {
    CandlestickSeries,
    LineSeries,
    AreaSeries,
    BarSeries,
    BaselineSeries,
} from "lightweight-charts";
import type { ChartType } from "../../services/types";
import { getSeriesColors } from "./chartConfig";

export function addChartSeries(
    chart: IChartApi,
    type: ChartType = "candlestick",
): ISeriesApi<any> {
    const colors = getSeriesColors(type);

    switch (type) {
        case "line":
            return chart.addSeries(LineSeries, colors as any);
        case "area":
            return chart.addSeries(AreaSeries, colors as any);
        case "bar":
            return chart.addSeries(BarSeries, colors as any);
        case "baseline":
            return chart.addSeries(BaselineSeries, colors as any);
        case "heikin_ashi":
        case "candlestick":
        default:
            return chart.addSeries(CandlestickSeries, colors as any);
    }
}

import { api } from "./api";
import type { OkResponse, PortfolioCreate, PortfolioPosition } from "./types";

export function listPortfolio(
    signal?: AbortSignal,
): Promise<PortfolioPosition[]> {
    return api.get<PortfolioPosition[]>("/portfolio", signal);
}

export function upsertPosition(
    payload: PortfolioCreate,
    signal?: AbortSignal,
): Promise<OkResponse> {
    return api.post<OkResponse>("/portfolio", payload, signal);
}

export function deletePosition(
    ticker: string,
    signal?: AbortSignal,
): Promise<OkResponse> {
    return api.delete<OkResponse>(
        `/portfolio/${encodeURIComponent(ticker)}`,
        signal,
    );
}

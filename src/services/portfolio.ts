import { api } from "./api";
import type {
    OkResponse,
    PortfolioCreatePayload,
    PortfolioOverviewResponse,
    PortfolioSummary,
    PositionResponse,
    TransactionCreatePayload,
    TransactionResponse,
    PortfolioHistoryResponse,
} from "./types";

export function listPortfolios(
    signal?: AbortSignal,
): Promise<PortfolioSummary[]> {
    return api.get<PortfolioSummary[]>("/portfolio/portfolios", signal);
}

export function createPortfolio(
    payload: PortfolioCreatePayload,
    signal?: AbortSignal,
): Promise<PortfolioSummary> {
    return api.post<PortfolioSummary>("/portfolio/portfolios", payload, signal);
}

export function getPortfolioOverview(
    portfolioId?: string,
    signal?: AbortSignal,
    pnlPeriod: string = "all",
): Promise<PortfolioOverviewResponse> {
    const params = new URLSearchParams();
    if (portfolioId) params.append("portfolio_id", portfolioId);
    params.append("pnl_period", pnlPeriod);
    return api.get<PortfolioOverviewResponse>(`/portfolio/overview?${params.toString()}`, signal);
}

export function listPositions(
    portfolioId?: string,
    signal?: AbortSignal,
): Promise<PositionResponse[]> {
    const query = portfolioId ? `?portfolio_id=${encodeURIComponent(portfolioId)}` : "";
    return api.get<PositionResponse[]>(`/portfolio/positions${query}`, signal);
}

export function listTransactions(
    portfolioId?: string,
    signal?: AbortSignal,
): Promise<TransactionResponse[]> {
    const query = portfolioId ? `?portfolio_id=${encodeURIComponent(portfolioId)}` : "";
    return api.get<TransactionResponse[]>(`/portfolio/transactions${query}`, signal);
}

export function addTransaction(
    payload: TransactionCreatePayload,
    signal?: AbortSignal,
): Promise<TransactionResponse> {
    return api.post<TransactionResponse>("/portfolio/transactions", payload, signal);
}

export function updateTransaction(
    transactionId: string,
    payload: TransactionCreatePayload,
    signal?: AbortSignal,
): Promise<TransactionResponse> {
    return api.put<TransactionResponse>(
        `/portfolio/transactions/${encodeURIComponent(transactionId)}`,
        payload,
        signal,
    );
}

export function deleteTransaction(
    transactionId: string,
    signal?: AbortSignal,
): Promise<OkResponse> {
    return api.delete<OkResponse>(
        `/portfolio/transactions/${encodeURIComponent(transactionId)}`,
        signal,
    );
}

export function getPortfolioHistory(
    portfolioId?: string,
    timeframe: string = "all",
    interval: string = "1d",
    benchmark: string = "^GSPC",
    signal?: AbortSignal,
): Promise<PortfolioHistoryResponse> {
    const params = new URLSearchParams();
    if (portfolioId) params.append("portfolio_id", portfolioId);
    params.append("timeframe", timeframe);
    params.append("interval", interval);
    params.append("benchmark", benchmark);
    return api.get<PortfolioHistoryResponse>(`/portfolio/history?${params.toString()}`, signal);
}

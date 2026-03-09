import { api } from "./api";
import type { AlertCreate, AlertRecord, OkResponse } from "./types";

export function listAlerts(signal?: AbortSignal): Promise<AlertRecord[]> {
    return api.get<AlertRecord[]>("/alerts", signal);
}

export function createAlert(
    payload: AlertCreate,
    signal?: AbortSignal,
): Promise<OkResponse> {
    return api.post<OkResponse>("/alerts", payload, signal);
}

export function deleteAlert(
    alertId: number,
    signal?: AbortSignal,
): Promise<OkResponse> {
    return api.delete<OkResponse>(`/alerts/${alertId}`, signal);
}

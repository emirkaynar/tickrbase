import { API_BASE } from "./api";

export type LiveTick = {
    symbol: string;
    price: number;
    ts: number;
    raw?: unknown;
};

export type LiveStatus =
    | "idle"
    | "connecting"
    | "open"
    | "reconnecting"
    | "closed"
    | "error";

type TickListener = (tick: LiveTick) => void;
type StatusListener = (status: LiveStatus) => void;

type ReplaceMessage = {
    type: "replace";
    requestId: string;
    symbols: string[];
    debug?: boolean;
};

type PingMessage = {
    type: "ping";
    requestId: string;
};

function toWsUrl(apiBase: string): string {
    if (apiBase.startsWith("https://")) {
        return apiBase.replace("https://", "wss://") + "/ws/prices";
    }
    if (apiBase.startsWith("http://")) {
        return apiBase.replace("http://", "ws://") + "/ws/prices";
    }
    return "ws://127.0.0.1:8000/ws/prices";
}

function normalize(symbol: string): string {
    return symbol.trim().toUpperCase();
}

class LivePricesClient {
    private ws: WebSocket | null = null;
    private status: LiveStatus = "idle";
    private shouldRun = false;
    private reconnectTimer: number | null = null;
    private reconnectDelayMs = 1000;
    private readonly maxReconnectDelayMs = 30_000;
    private requestSeq = 0;
    private desiredSymbols = new Set<string>();
    private symbolsByWidget = new Map<string, string>();
    private debug = false;
    private readonly tickListeners = new Set<TickListener>();
    private readonly statusListeners = new Set<StatusListener>();

    getStatus(): LiveStatus {
        return this.status;
    }

    connect(): void {
        if (this.shouldRun) return;
        this.shouldRun = true;
        this.openSocket(false);
    }

    disconnect(): void {
        this.shouldRun = false;
        if (this.reconnectTimer !== null) {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.setStatus("closed");
            this.ws.close();
            this.ws = null;
        }
    }

    setDesiredSymbols(symbols: string[], options?: { debug?: boolean }): void {
        this.debug = Boolean(options?.debug);
        this.desiredSymbols = new Set(
            symbols.map(normalize).filter((s) => s.length > 0),
        );
        this.sendReplace();
    }

    updateSymbol(widgetId: string, symbol: string): void {
        const normalized = normalize(symbol);
        if (normalized.length > 0) {
            this.symbolsByWidget.set(widgetId, normalized);
        } else {
            this.symbolsByWidget.delete(widgetId);
        }
        this.rebuildDesiredSymbols();
    }

    removeWidget(widgetId: string): void {
        this.symbolsByWidget.delete(widgetId);
        this.rebuildDesiredSymbols();
    }

    private rebuildDesiredSymbols(): void {
        this.desiredSymbols = new Set(this.symbolsByWidget.values());
        this.sendReplace();
    }

    onTick(listener: TickListener): () => void {
        this.tickListeners.add(listener);
        return () => this.tickListeners.delete(listener);
    }

    onStatus(listener: StatusListener): () => void {
        this.statusListeners.add(listener);
        listener(this.status);
        return () => this.statusListeners.delete(listener);
    }

    ping(): void {
        this.send({
            type: "ping",
            requestId: this.nextRequestId("ping"),
        });
    }

    private openSocket(isReconnect: boolean): void {
        if (!this.shouldRun) return;
        if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;

        this.setStatus(isReconnect ? "reconnecting" : "connecting");
        const ws = new WebSocket(toWsUrl(API_BASE));
        this.ws = ws;

        ws.onopen = () => {
            this.reconnectDelayMs = 1000;
            this.setStatus("open");
            this.sendReplace();
        };

        ws.onmessage = (event) => {
            let data: unknown;
            try {
                data = JSON.parse(String(event.data));
            } catch {
                return;
            }
            if (!data || typeof data !== "object") return;

            const payload = data as Record<string, unknown>;
            if (payload.type === "tick") {
                const symbol = String(payload.symbol ?? "");
                const price = Number(payload.price);
                const ts = Number(payload.ts);
                if (
                    !symbol ||
                    !Number.isFinite(price) ||
                    !Number.isFinite(ts)
                ) {
                    return;
                }
                const tick: LiveTick = {
                    symbol: normalize(symbol),
                    price,
                    ts,
                };
                if ("raw" in payload) tick.raw = payload.raw;
                for (const listener of this.tickListeners) listener(tick);
                return;
            }

            if (payload.type === "shutdown") {
                this.setStatus("closed");
            }
        };

        ws.onerror = () => {
            this.setStatus("error");
        };

        ws.onclose = () => {
            if (this.ws === ws) this.ws = null;
            if (!this.shouldRun) {
                this.setStatus("closed");
                return;
            }
            this.scheduleReconnect();
        };
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer !== null) return;
        const delay = this.reconnectDelayMs;
        this.reconnectDelayMs = Math.min(
            this.reconnectDelayMs * 2,
            this.maxReconnectDelayMs,
        );
        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            this.openSocket(true);
        }, delay);
    }

    private sendReplace(): void {
        this.send({
            type: "replace",
            requestId: this.nextRequestId("replace"),
            symbols: Array.from(this.desiredSymbols).sort(),
            debug: this.debug,
        });
    }

    private send(message: ReplaceMessage | PingMessage): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify(message));
    }

    private nextRequestId(prefix: "replace" | "ping"): string {
        this.requestSeq += 1;
        return `${prefix}-${Date.now()}-${this.requestSeq}`;
    }

    private setStatus(next: LiveStatus): void {
        if (this.status === next) return;
        this.status = next;
        for (const listener of this.statusListeners) listener(next);
    }
}

export const livePricesClient = new LivePricesClient();

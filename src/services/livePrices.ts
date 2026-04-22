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

const REPLACE_SEND_DEBOUNCE_MS = 120;

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

function areStringSetsEqual(left: Set<string>, right: Set<string>): boolean {
    if (left === right) return true;
    if (left.size !== right.size) return false;

    for (const value of left) {
        if (!right.has(value)) return false;
    }

    return true;
}

function buildReplaceKey(symbols: string[], debug: boolean): string {
    return `${debug ? "1" : "0"}|${symbols.join("\u001f")}`;
}

class LivePricesClient {
    private ws: WebSocket | null = null;
    private status: LiveStatus = "idle";
    private shouldRun = false;
    private reconnectTimer: number | null = null;
    private reconnectDelayMs = 1000;
    private readonly maxReconnectDelayMs = 30_000;
    private replaceSendTimer: number | null = null;
    private requestSeq = 0;
    private desiredSymbols = new Set<string>();
    private manualSymbols = new Set<string>();
    private lastSentReplaceKey = "";
    private symbolsByWidget = new Map<string, Set<string>>();
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
        if (this.replaceSendTimer !== null) {
            window.clearTimeout(this.replaceSendTimer);
            this.replaceSendTimer = null;
        }
        if (this.ws) {
            this.setStatus("closed");
            this.ws.close();
            this.ws = null;
        }
    }

    setDesiredSymbols(symbols: string[], options?: { debug?: boolean }): void {
        const nextDebug = Boolean(options?.debug);
        const nextManualSymbols = new Set(
            symbols.map(normalize).filter((s) => s.length > 0),
        );

        const debugChanged = this.debug !== nextDebug;
        const manualChanged = !areStringSetsEqual(
            this.manualSymbols,
            nextManualSymbols,
        );
        if (!debugChanged && !manualChanged) return;

        this.debug = nextDebug;
        this.manualSymbols = nextManualSymbols;
        this.rebuildDesiredSymbols(debugChanged);
    }

    updateSymbol(widgetId: string, symbol: string): void {
        this.updateSymbols(widgetId, [symbol]);
    }

    updateSymbols(widgetId: string, symbols: string[]): void {
        const normalized = symbols
            .map(normalize)
            .filter((symbol) => symbol.length > 0);

        if (normalized.length === 0) {
            if (!this.symbolsByWidget.has(widgetId)) return;
            this.symbolsByWidget.delete(widgetId);
        } else {
            const nextSymbols = new Set(normalized);
            const previousSymbols = this.symbolsByWidget.get(widgetId);
            if (
                previousSymbols != null &&
                areStringSetsEqual(previousSymbols, nextSymbols)
            ) {
                return;
            }

            this.symbolsByWidget.set(widgetId, nextSymbols);
        }
        this.rebuildDesiredSymbols();
    }

    removeWidget(widgetId: string): void {
        if (!this.symbolsByWidget.has(widgetId)) return;
        this.symbolsByWidget.delete(widgetId);
        this.rebuildDesiredSymbols();
    }

    private rebuildDesiredSymbols(forceSend = false): void {
        const next = new Set<string>(this.manualSymbols);
        for (const symbols of this.symbolsByWidget.values()) {
            for (const symbol of symbols) {
                next.add(symbol);
            }
        }

        if (!forceSend && areStringSetsEqual(this.desiredSymbols, next)) {
            return;
        }

        this.desiredSymbols = next;
        this.scheduleReplace();
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
            this.lastSentReplaceKey = "";
            this.scheduleReplace({ immediate: true, force: true });
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

    private scheduleReplace(options?: {
        immediate?: boolean;
        force?: boolean;
    }): void {
        const immediate = options?.immediate === true;

        if (immediate) {
            if (this.replaceSendTimer !== null) {
                window.clearTimeout(this.replaceSendTimer);
                this.replaceSendTimer = null;
            }

            this.sendReplaceIfNeeded(options?.force === true);
            return;
        }

        if (this.replaceSendTimer !== null) return;

        this.replaceSendTimer = window.setTimeout(() => {
            this.replaceSendTimer = null;
            this.sendReplaceIfNeeded(false);
        }, REPLACE_SEND_DEBOUNCE_MS);
    }

    private sendReplaceIfNeeded(force: boolean): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const symbols = Array.from(this.desiredSymbols).sort();
        const replaceKey = buildReplaceKey(symbols, this.debug);
        if (!force && replaceKey === this.lastSentReplaceKey) return;

        this.send({
            type: "replace",
            requestId: this.nextRequestId("replace"),
            symbols,
            debug: this.debug,
        });

        this.lastSentReplaceKey = replaceKey;
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

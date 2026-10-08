export function prunePulseCells<Element, Callback>(
    elements: Record<string, Element | null>,
    callbacks: Record<string, Callback>,
    pending: Record<string, true>,
    activeKeys: Set<string>,
    cleanElement: (element: Element) => void,
): void {
    for (const key of Object.keys(elements)) {
        if (activeKeys.has(key)) continue;
        const element = elements[key];
        if (element) cleanElement(element);
        delete elements[key];
    }

    // Detached virtualized cells retain callbacks but have no element entry.
    for (const key of Object.keys(callbacks)) {
        if (activeKeys.has(key)) continue;
        delete callbacks[key];
    }

    for (const key of Object.keys(pending)) {
        if (activeKeys.has(key)) continue;
        delete pending[key];
    }
}

export function listenForScroll(
    viewport: EventTarget,
    isScrolling: { current: boolean },
    timeout: { current: number | null },
    flushPendingPrices: () => void,
): () => void {
    const handleScroll = () => {
        isScrolling.current = true;
        if (timeout.current !== null) {
            window.clearTimeout(timeout.current);
        }
        timeout.current = window.setTimeout(() => {
            isScrolling.current = false;
            timeout.current = null;
            flushPendingPrices();
        }, 150);
    };

    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
        viewport.removeEventListener("scroll", handleScroll);
        if (timeout.current !== null) {
            window.clearTimeout(timeout.current);
        }
        timeout.current = null;
        isScrolling.current = false;
    };
}

export function startQuotePolling<T>(
    load: (signal: AbortSignal) => Promise<T>,
    apply: (payload: T) => void,
    refreshMs: number,
): () => void {
    let cancelled = false;
    let inFlight = false;
    const controller = new AbortController();

    const loadQuotes = async () => {
        if (cancelled || controller.signal.aborted || inFlight) return;
        inFlight = true;
        try {
            const payload = await load(controller.signal);
            if (cancelled || controller.signal.aborted) return;
            apply(payload);
        } catch {
            if (controller.signal.aborted) return;
        } finally {
            inFlight = false;
        }
    };

    void loadQuotes();
    const timer = window.setInterval(() => {
        void loadQuotes();
    }, refreshMs);

    return () => {
        cancelled = true;
        controller.abort();
        window.clearInterval(timer);
    };
}

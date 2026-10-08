import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listenForScroll, prunePulseCells, startQuotePolling } from "./lifecycle";

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

beforeEach(() => {
    vi.useFakeTimers();
    // Only timers are used; EventTarget supplies the scroll events in Node.
    vi.stubGlobal("window", globalThis);
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("pulse cell symbol/list pruning", () => {
    it("removes detached callbacks for symbols that leave the list", () => {
        const callbacks = {
            "AAPL|price": vi.fn(),
            "AAPL|changePercent": vi.fn(),
            "MSFT|price": vi.fn(),
        };
        const retained = callbacks["MSFT|price"];
        prunePulseCells({}, callbacks, {}, new Set(["MSFT|price"]), vi.fn());
        expect(Object.keys(callbacks)).toEqual(["MSFT|price"]);
        expect(callbacks["MSFT|price"]).toBe(retained);
    });

    it("retains active detached callbacks for virtualized ref reattachment", () => {
        const callback = vi.fn();
        const callbacks = { "AAPL|price": callback };
        const elements = {};
        prunePulseCells(elements, callbacks, {}, new Set(["AAPL|price"]), vi.fn());
        expect(callbacks["AAPL|price"]).toBe(callback);
        expect(elements).toEqual({});
    });

    it("cleans mounted cells without disturbing active cells or pulses", () => {
        const removed = {};
        const retained = {};
        const elements = { "AAPL|price": removed, "MSFT|price": retained };
        const callbacks = { "AAPL|price": vi.fn(), "MSFT|price": vi.fn() };
        const pending: Record<string, true> = { "AAPL|price": true, "MSFT|price": true };
        const cleaned: object[] = [];
        prunePulseCells(elements, callbacks, pending, new Set(["MSFT|price"]), (element) => cleaned.push(element));
        expect(cleaned).toEqual([removed]);
        expect(elements).toEqual({ "MSFT|price": retained });
        expect(Object.keys(callbacks)).toEqual(["MSFT|price"]);
        expect(pending).toEqual({ "MSFT|price": true });
    });

    it("prunes obsolete detached pending pulses while preserving active ones", () => {
        const retainedCallback = vi.fn();
        const callbacks = {
            "AAPL|price": vi.fn(),
            "MSFT|price": retainedCallback,
        };
        const pending: Record<string, true> = {
            "AAPL|price": true,
            "AAPL|changePercent": true,
            "MSFT|price": true,
        };

        prunePulseCells({}, callbacks, pending, new Set(["MSFT|price"]), vi.fn());

        expect(pending).toEqual({ "MSFT|price": true });
        expect(callbacks).toEqual({ "MSFT|price": retainedCallback });
    });

    it("clears orphan callbacks when switching to an empty list", () => {
        const callbacks = { "AAPL|price": vi.fn(), "MSFT|changePercent": vi.fn() };
        prunePulseCells({}, callbacks, {}, new Set(), vi.fn());
        expect(callbacks).toEqual({});
        prunePulseCells({}, callbacks, {}, new Set(), vi.fn());
        expect(callbacks).toEqual({});
    });
});

describe("scroll listener lifecycle", () => {
    it("resets scrolling when cleanup cancels a pending settle", async () => {
        const viewport = new EventTarget();
        const scrolling = { current: false };
        const timeout = { current: null as number | null };
        const flush = vi.fn();
        const cleanup = listenForScroll(viewport, scrolling, timeout, flush);
        viewport.dispatchEvent(new Event("scroll"));
        expect(scrolling.current).toBe(true);
        cleanup();
        expect(scrolling.current).toBe(false);
        await vi.advanceTimersByTimeAsync(150);
        expect(flush).not.toHaveBeenCalled();
    });

    it("clears the timeout ref and detaches the old listener on cleanup", async () => {
        const viewport = new EventTarget();
        const scrolling = { current: false };
        const timeout = { current: null as number | null };
        const flush = vi.fn();
        const cleanup = listenForScroll(viewport, scrolling, timeout, flush);
        viewport.dispatchEvent(new Event("scroll"));
        cleanup();
        expect(timeout.current).toBeNull();
        viewport.dispatchEvent(new Event("scroll"));
        await vi.advanceTimersByTimeAsync(150);
        expect(flush).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("debounces settling at 150ms and flushes after the last scroll", async () => {
        const viewport = new EventTarget();
        const scrolling = { current: false };
        const timeout = { current: null as number | null };
        const flush = vi.fn();
        const cleanup = listenForScroll(viewport, scrolling, timeout, flush);
        viewport.dispatchEvent(new Event("scroll"));
        await vi.advanceTimersByTimeAsync(100);
        viewport.dispatchEvent(new Event("scroll"));
        await vi.advanceTimersByTimeAsync(149);
        expect(scrolling.current).toBe(true);
        expect(flush).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(scrolling.current).toBe(false);
        expect(timeout.current).toBeNull();
        expect(flush).toHaveBeenCalledOnce();
        cleanup();
    });

    it("allows a replacement effect to resume updates without another scroll", () => {
        const viewport = new EventTarget();
        const scrolling = { current: false };
        const timeout = { current: null as number | null };
        const cleanup = listenForScroll(viewport, scrolling, timeout, vi.fn());
        viewport.dispatchEvent(new Event("scroll"));
        cleanup();
        const nextCleanup = listenForScroll(viewport, scrolling, timeout, vi.fn());
        expect(scrolling.current).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
        nextCleanup();
    });
});

describe("quotes polling lifecycle", () => {
    it("starts immediately but skips interval ticks while a request is stalled", async () => {
        const request = deferred<number>();
        const load = vi.fn(() => request.promise);
        const apply = vi.fn();
        const cleanup = startQuotePolling(load, apply, 15_000);
        expect(load).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(45_000);
        expect(load).toHaveBeenCalledOnce();
        expect(apply).not.toHaveBeenCalled();
        cleanup();
        request.resolve(1);
        await request.promise;
    });

    it("releases the flight after success without changing the interval cadence", async () => {
        const request = deferred<number>();
        const load = vi.fn().mockReturnValueOnce(request.promise).mockResolvedValue(2);
        const values: number[] = [];
        const cleanup = startQuotePolling(load, (value: number) => values.push(value), 15_000);
        await vi.advanceTimersByTimeAsync(10_000);
        request.resolve(1);
        await vi.advanceTimersByTimeAsync(0);
        expect(values).toEqual([1]);
        await vi.advanceTimersByTimeAsync(4_999);
        expect(load).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        expect(load).toHaveBeenCalledTimes(2);
        expect(values).toEqual([1, 2]);
        cleanup();
    });

    it("releases the flight after rejection so the next interval can retry", async () => {
        const request = deferred<number>();
        const load = vi.fn().mockReturnValueOnce(request.promise).mockResolvedValue(2);
        const apply = vi.fn();
        const cleanup = startQuotePolling(load, apply, 15_000);
        request.reject(new Error("request failed"));
        await vi.advanceTimersByTimeAsync(0);
        expect(apply).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(15_000);
        expect(load).toHaveBeenCalledTimes(2);
        expect(apply).toHaveBeenCalledWith(2);
        cleanup();
    });

    it("releases the flight even if applying a snapshot throws", async () => {
        const load = vi.fn().mockResolvedValue(1);
        const apply = vi.fn().mockImplementationOnce(() => { throw new Error("update failed"); });
        const cleanup = startQuotePolling(load, apply, 15_000);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(15_000);
        expect(load).toHaveBeenCalledTimes(2);
        expect(apply).toHaveBeenCalledTimes(2);
        cleanup();
    });

    it("aborts and discards a late result on cleanup, with no further polling", async () => {
        const request = deferred<number>();
        let signal!: AbortSignal;
        const load = vi.fn((nextSignal: AbortSignal) => {
            signal = nextSignal;
            return request.promise;
        });
        const apply = vi.fn();
        const cleanup = startQuotePolling(load, apply, 15_000);
        cleanup();
        expect(signal.aborted).toBe(true);
        request.resolve(1);
        await vi.advanceTimersByTimeAsync(45_000);
        expect(apply).not.toHaveBeenCalled();
        expect(load).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("gives a replacement effect its own flight and ignores the old result", async () => {
        const oldRequest = deferred<number>();
        const oldApply = vi.fn();
        const oldCleanup = startQuotePolling(() => oldRequest.promise, oldApply, 15_000);
        oldCleanup();
        const newLoad = vi.fn().mockResolvedValue(2);
        const newApply = vi.fn();
        const newCleanup = startQuotePolling(newLoad, newApply, 15_000);
        await vi.advanceTimersByTimeAsync(0);
        expect(newApply).toHaveBeenCalledWith(2);
        oldRequest.resolve(1);
        await vi.advanceTimersByTimeAsync(0);
        expect(oldApply).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(15_000);
        expect(newLoad).toHaveBeenCalledTimes(2);
        newCleanup();
    });
});

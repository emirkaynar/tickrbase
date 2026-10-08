import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LookupItem } from "../../../services/types";
import { fetchLookup } from "../../../services/lookup";

const harness = vi.hoisted(() => ({
    state: undefined as unknown,
    ref: { current: undefined as unknown },
    effects: [] as Array<() => (() => void) | undefined>,
}));
vi.mock("preact/hooks", () => ({
    useState: (initial: unknown) => {
        if (harness.state === undefined) harness.state = initial;
        return [harness.state, (value: unknown) => { harness.state = value; }];
    },
    useRef: () => harness.ref,
    useEffect: (effect: () => (() => void) | undefined) => harness.effects.push(effect),
}));
vi.mock("../../../services/lookup", () => ({ fetchLookup: vi.fn() }));

let identity: typeof import("../hooks/useInstrumentIdentity");
const item = (symbol: string, company_name = "Company name", exchange = "Istanbul"):
    LookupItem => ({ symbol, company_name, exchange, instrument_type: "equity" });

async function settle() {
    for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    harness.state = undefined;
    harness.ref.current = undefined;
    harness.effects.length = 0;
    identity = await import("../hooks/useInstrumentIdentity");
});

describe("instrument identity resolution", () => {
    it("selects an exact canonical symbol rather than the first fuzzy hit", async () => {
        vi.mocked(fetchLookup).mockResolvedValue([item("ASELS"), item("asels.is", "Aselsan Elektronik", "BIST")]);
        expect(await identity.resolveInstrumentIdentity("ASELS.IS")).toEqual({ name: "Aselsan Elektronik", exchange: "BIST" });
        expect(fetchLookup).toHaveBeenCalledWith("ASELS.IS", undefined);
    });

    it("does not strip exchange suffixes or accept prefix matches", async () => {
        vi.mocked(fetchLookup).mockResolvedValue([item("ASELS"), item("ASELS.ISX"), item("ASELS.L")]);
        expect(await identity.resolveInstrumentIdentity("ASELS.IS")).toEqual({ name: "ASELS.IS", exchange: null });
    });

    it("uses truthful fallbacks for blank fields and preserves the supplied exchange label", async () => {
        vi.mocked(fetchLookup).mockResolvedValueOnce([item("AAPL", "  Apple Inc.  ", " NasdaqGS ")]);
        expect(await identity.resolveInstrumentIdentity("AAPL")).toEqual({ name: "Apple Inc.", exchange: "NasdaqGS" });
        vi.mocked(fetchLookup).mockResolvedValueOnce([item("MSFT", "  ", "  ")]);
        expect(await identity.resolveInstrumentIdentity("MSFT")).toEqual({ name: "MSFT", exchange: null });
    });

    it("caches successful exact matches but retries misses and failures", async () => {
        vi.mocked(fetchLookup).mockResolvedValueOnce([item("AAPL")]);
        await identity.resolveInstrumentIdentity("AAPL");
        await identity.resolveInstrumentIdentity("AAPL");
        expect(fetchLookup).toHaveBeenCalledTimes(1);
        vi.mocked(fetchLookup).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([item("MSFT")]);
        expect(await identity.resolveInstrumentIdentity("MSFT")).toEqual({ name: "MSFT", exchange: null });
        expect(await identity.resolveInstrumentIdentity("MSFT")).toEqual({ name: "MSFT", exchange: null });
        expect(await identity.resolveInstrumentIdentity("MSFT")).toEqual({ name: "Company name", exchange: "Istanbul" });
        expect(fetchLookup).toHaveBeenCalledTimes(4);
    });

    it("expires cached metadata after a day", async () => {
        const clock = vi.spyOn(Date, "now").mockReturnValue(0);
        try {
            vi.mocked(fetchLookup).mockResolvedValueOnce([item("AAPL", "Old name")]).mockResolvedValueOnce([item("AAPL", "New name")]);
            await identity.resolveInstrumentIdentity("AAPL");
            clock.mockReturnValue(86_400_000);
            expect(await identity.resolveInstrumentIdentity("AAPL")).toEqual({ name: "New name", exchange: "Istanbul" });
        } finally {
            clock.mockRestore();
        }
    });

    it("bounds the successful-match cache", async () => {
        vi.mocked(fetchLookup).mockImplementation(async symbol => [item(symbol)]);
        for (let i = 0; i <= 100; i++) {
            await identity.resolveInstrumentIdentity(`TEST${i}`);
        }
        await identity.resolveInstrumentIdentity("TEST100");
        expect(fetchLookup).toHaveBeenCalledTimes(101);
        await identity.resolveInstrumentIdentity("TEST0");
        expect(fetchLookup).toHaveBeenCalledTimes(102);
    });

    it("does not cache responses arriving after cancellation even if transport ignores abort", async () => {
        let resolve!: (items: LookupItem[]) => void;
        vi.mocked(fetchLookup).mockReturnValueOnce(new Promise(done => { resolve = done; }));
        const controller = new AbortController();
        const pending = identity.resolveInstrumentIdentity("AAPL", controller.signal);
        controller.abort();
        resolve([item("AAPL", "Cancelled name")]);
        expect(await pending).toEqual({ name: "AAPL", exchange: null });
        vi.mocked(fetchLookup).mockResolvedValueOnce([item("AAPL", "Fresh name")]);
        expect(await identity.resolveInstrumentIdentity("AAPL")).toEqual({ name: "Fresh name", exchange: "Istanbul" });
        expect(fetchLookup).toHaveBeenCalledTimes(2);
    });
});

describe("useInstrumentIdentity lifecycle (Node hook harness)", () => {
    it("gates lookup on readiness and resolves a persisted symbol without selection metadata", async () => {
        expect(identity.useInstrumentIdentity("ASELS.IS", false)).toEqual({ name: "ASELS.IS", exchange: null });
        harness.effects.pop()!();
        expect(fetchLookup).not.toHaveBeenCalled();
        vi.mocked(fetchLookup).mockResolvedValue([item("ASELS.IS", "Aselsan", "BIST")]);
        expect(identity.useInstrumentIdentity("ASELS.IS", true)).toEqual({ name: "ASELS.IS", exchange: null });
        const cleanup = harness.effects.pop()!()!;
        await settle();
        expect(identity.useInstrumentIdentity("ASELS.IS", true)).toEqual({ name: "Aselsan", exchange: "BIST" });
        cleanup();
    });

    it("returns the new symbol immediately before its effect runs", async () => {
        vi.mocked(fetchLookup).mockResolvedValue([item("AAPL", "Apple")]);
        identity.useInstrumentIdentity("AAPL", true);
        const cleanup = harness.effects.pop()!()!;
        await settle();
        expect(identity.useInstrumentIdentity("AAPL", true).name).toBe("Apple");
        expect(identity.useInstrumentIdentity("MSFT", true)).toEqual({ name: "MSFT", exchange: null });
        expect(identity.useInstrumentIdentity("AAPL", false)).toEqual({ name: "AAPL", exchange: null });
        cleanup();
    });

    it("ignores a pending response after unmount", async () => {
        let resolve!: (items: LookupItem[]) => void;
        vi.mocked(fetchLookup).mockReturnValueOnce(new Promise(done => { resolve = done; }));
        identity.useInstrumentIdentity("AAPL", true);
        const cleanup = harness.effects.pop()!()!;
        cleanup();
        const state = harness.state;
        resolve([item("AAPL")]);
        await settle();
        expect(harness.state).toBe(state);
        expect(vi.mocked(fetchLookup).mock.calls[0][1]!.aborted).toBe(true);
    });

    it("aborts old requests and ignores late results after switching", async () => {
        let resolveOld!: (items: LookupItem[]) => void;
        let resolveNew!: (items: LookupItem[]) => void;
        vi.mocked(fetchLookup)
            .mockReturnValueOnce(new Promise(done => { resolveOld = done; }))
            .mockReturnValueOnce(new Promise(done => { resolveNew = done; }));
        identity.useInstrumentIdentity("AAPL", true);
        const cleanupOld = harness.effects.pop()!()!;
        const oldSignal = vi.mocked(fetchLookup).mock.calls[0][1]!;
        identity.useInstrumentIdentity("MSFT", true);
        cleanupOld();
        expect(oldSignal.aborted).toBe(true);
        const cleanupNew = harness.effects.pop()!()!;
        resolveNew([item("MSFT", "Microsoft")]);
        await settle();
        resolveOld([item("AAPL", "Apple")]);
        await settle();
        expect(identity.useInstrumentIdentity("MSFT", true).name).toBe("Microsoft");
        const state = harness.state;
        cleanupNew();
        expect(harness.state).toBe(state);
    });
});

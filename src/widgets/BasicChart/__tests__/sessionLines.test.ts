import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import type { IPrimitivePaneRenderer, SeriesAttachedParameter, Time } from "lightweight-charts";
import type { MarketContext } from "../../../services/types";
import { SessionLines } from "../sessionLines";

const require = createRequire(import.meta.url);

describe("session lines", () => {
    it("constructs multiple instances under the development refresh transform", async () => {
        // Use the preset's actual transform and runtime: normal Vitest imports skip HMR.
        const presetRequire = createRequire(require.resolve("@preact/preset-vite"));
        const prefresh = presetRequire("@prefresh/vite")();
        const esbuild = createRequire(require.resolve("vite"))("esbuild");
        const filename = new URL("../sessionLines.ts", import.meta.url);
        const source = readFileSync(filename, "utf8");
        const transformed = await prefresh.transform.call({
            resolve: (id: string) => ({ id: presetRequire.resolve(id) }),
        }, source, fileURLToPath(filename));
        const compiled = esbuild.buildSync({
            stdin: {
                contents: typeof transformed === "string" ? transformed : transformed.code,
                loader: "ts",
                resolveDir: fileURLToPath(new URL(".", filename)),
            },
            bundle: true,
            write: false,
            platform: "node",
            format: "cjs",
            define: { "import.meta.hot": "hot" },
        });
        const sandbox = {
            hot: { accept: vi.fn(), dispose: vi.fn() },
            module: { exports: {} as { SessionLines: typeof SessionLines } },
        };
        runInNewContext("self = globalThis;\n" + compiled.outputFiles[0].text, sandbox);
        const instances = Array.from({ length: 3 }, () => new sandbox.module.exports.SessionLines());
        expect(instances.map(instance => instance.paneViews().length)).toEqual([1, 1, 1]);
    });

    it("draws session boundaries and observation gaps through the renderer", () => {
        const lines = new SessionLines();
        const requestUpdate = vi.fn();
        lines.attached({
            chart: { timeScale: () => ({ timeToCoordinate: (time: number) => time }) },
            requestUpdate,
        } as unknown as SeriesAttachedParameter<Time>);
        const context: MarketContext = {
            ticker: "TEST", exchange: "XNYS", instrument_type: "EQUITY",
            exchange_timezone: "America/New_York", server_time: 0,
            calendar_coverage: { from: 0, to: 1000 },
            sessions: [{ trading_date: "test", regular_open: 10, regular_close: 300, windows: [] }],
        };
        lines.setContext(context, [{ start: 50, end: 200 }]);
        lines.updateAllViews();
        const canvas = {
            save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(),
            moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(),
        };
        const target = {
            useMediaCoordinateSpace: vi.fn(callback => callback({
                context: canvas, mediaSize: { width: 400, height: 100 },
            })),
        };
        lines.paneViews()[0].renderer()!.draw(target as unknown as Parameters<IPrimitivePaneRenderer["draw"]>[0]);
        expect(requestUpdate).toHaveBeenCalledOnce();
        expect(target.useMediaCoordinateSpace).toHaveBeenCalledOnce();
        expect(canvas.setLineDash.mock.calls).toEqual([[[4, 4]], [[1, 4]]]);
        expect(canvas.moveTo.mock.calls).toEqual([[10.5, 0], [300.5, 0]]);
        expect(canvas.lineTo.mock.calls).toEqual([[10.5, 100], [300.5, 100]]);
        expect(canvas.stroke).toHaveBeenCalledTimes(2);
        expect(canvas.fillRect).toHaveBeenCalledWith(50, 0, 150, 100);
        expect(canvas.fillText).toHaveBeenCalledWith("No observations", 54, 92);
        expect(canvas.save).toHaveBeenCalledOnce();
        expect(canvas.restore).toHaveBeenCalledOnce();
    });
});

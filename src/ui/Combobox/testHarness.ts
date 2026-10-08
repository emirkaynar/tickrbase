import type { VNode } from "preact";

// Node-only component runner: retain hook state and flush passive effects explicitly.
export function createHookHarness() {
    type Slot = { value?: any; deps?: unknown[]; cleanup?: (() => void) | void };
    let index = 0;
    const slots: Slot[] = [];
    const effects: Array<() => void> = [];
    let updates = 0;
    const slot = () => slots[index++] ?? (slots[index - 1] = {});
    const changed = (previous: unknown[] | undefined, next: unknown[]) =>
        !previous || previous.length !== next.length || next.some((value, i) => !Object.is(value, previous[i]));
    const memo = (factory: () => unknown, deps: unknown[]) => {
        const current = slot();
        if (changed(current.deps, deps)) {
            current.value = factory();
            current.deps = deps;
        }
        return current.value;
    };
    return {
        hooks: {
            useState: (initial: unknown) => {
                const current = slot();
                if (!("value" in current)) current.value = typeof initial === "function" ? initial() : initial;
                return [current.value, (value: any) => {
                    updates++;
                    current.value = typeof value === "function" ? value(current.value) : value;
                }];
            },
            useRef: (initial: unknown) => {
                const current = slot();
                return current.value ?? (current.value = { current: initial });
            },
            useMemo: memo,
            useCallback: (callback: unknown, deps: unknown[]) => memo(() => callback, deps),
            useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
                const current = slot();
                if (changed(current.deps, deps)) {
                    current.deps = deps;
                    effects.push(() => { current.cleanup?.(); current.cleanup = effect(); });
                }
            },
        },
        render<T>(component: () => T): T {
            index = 0;
            const result = component();
            for (const effect of effects.splice(0)) effect();
            return result;
        },
        unmount() {
            for (const current of slots) current.cleanup?.();
        },
        reset() {
            slots.length = 0;
            effects.length = 0;
            updates = 0;
        },
        get updates() { return updates; },
    };
}

export function nodes(tree: unknown): VNode<any>[] {
    if (Array.isArray(tree)) return tree.flatMap(nodes);
    if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
    const node = tree as VNode<any>;
    return [node, ...nodes(node.props.children)];
}

export function text(tree: unknown): string {
    if (Array.isArray(tree)) return tree.map(text).join("");
    if (tree == null || typeof tree === "boolean") return "";
    if (typeof tree === "object" && "props" in tree) return text((tree as VNode<any>).props.children);
    return String(tree);
}

export function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

export async function settle() {
    for (let i = 0; i < 12; i++) await Promise.resolve();
}

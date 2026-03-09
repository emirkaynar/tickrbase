import { useRef, useCallback } from "preact/hooks";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useDebounce<T extends (...args: any[]) => void>(
    fn: T,
    delay: number,
): T {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    return useCallback(
        (...args: Parameters<T>) => {
            if (timerRef.current !== null) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => fn(...args), delay);
        },
        [fn, delay],
    ) as T;
}

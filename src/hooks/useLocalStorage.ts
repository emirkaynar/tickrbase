import { useState, useCallback } from "preact/hooks";

export function useLocalStorage<T>(
    key: string,
    initialValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
    const [stored, setStored] = useState<T>(() => {
        try {
            const item = localStorage.getItem(key);
            return item !== null ? (JSON.parse(item) as T) : initialValue;
        } catch {
            return initialValue;
        }
    });

    const setValue = useCallback(
        (value: T | ((prev: T) => T)) => {
            setStored((prev) => {
                const next =
                    typeof value === "function"
                        ? (value as (prev: T) => T)(prev)
                        : value;
                try {
                    localStorage.setItem(key, JSON.stringify(next));
                } catch {
                    /* ignore */
                }
                return next;
            });
        },
        [key],
    );

    return [stored, setValue];
}

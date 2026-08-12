import { useEffect, useRef, useState } from "preact/hooks";
import { getPortfolioHistory } from "../services/portfolio";
import type { PortfolioHistoryPoint } from "../services/types";

export function usePortfolioHistory(
    portfolioId?: string,
    interval: string = "1d",
    benchmark: string = "none",
) {
    const [points, setPoints] = useState<PortfolioHistoryPoint[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>("");
    const retryCountRef = useRef<number>(0);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError("");
        retryCountRef.current = 0;

        let timerId: any = null;

        const fetchHistory = () => {
            getPortfolioHistory(portfolioId, "all", interval, benchmark, controller.signal)
                .then((res) => {
                    const fetchedPoints = res.points || [];
                    setPoints(fetchedPoints);
                    setLoading(false);

                    // If empty and retry count < 6, poll again after 2.5s
                    if (fetchedPoints.length === 0 && retryCountRef.current < 6) {
                        retryCountRef.current += 1;
                        timerId = setTimeout(fetchHistory, 2500);
                    }
                })
                .catch((err) => {
                    if (err.name === "AbortError") return;
                    setError(err.message || "Failed to load portfolio history");
                    setLoading(false);
                });
        };

        fetchHistory();

        return () => {
            controller.abort();
            if (timerId) clearTimeout(timerId);
        };
    }, [portfolioId, interval, benchmark]);

    return { points, loading, error };
}

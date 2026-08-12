import { useEffect, useState } from "preact/hooks";
import { createPortfolio, listPortfolios } from "../services/portfolio";
import type { PortfolioSummary } from "../services/types";

export function usePortfolioState(enabled: boolean) {
    const [portfolios, setPortfolios] = useState<PortfolioSummary[]>([]);
    const [activePortfolioId, setActivePortfolioId] = useState<string>("");
    const [baseCurrency, setBaseCurrencyState] = useState<string>("TRY");
    const [loading, setLoading] = useState(false);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

    const refreshPortfolios = async () => {
        if (!enabled) return;
        try {
            setLoading(true);
            const list = await listPortfolios();
            setPortfolios(list);

            if (list.length > 0) {
                const defaultPort = list.find((p) => p.is_default) || list[0];
                setActivePortfolioId((prev) => {
                    if (!prev || prev === "all" || !list.some((p) => p.id === prev)) {
                        return defaultPort.id;
                    }
                    return prev;
                });
            }
        } catch (err) {
            console.error("Failed to load portfolios", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void refreshPortfolios();
    }, [enabled]);

    // Update currency context based on active portfolio
    useEffect(() => {
        if (!enabled) return;

        const activePort = portfolios.find((p) => p.id === activePortfolioId);
        if (activePort && activePort.base_currency) {
            setBaseCurrencyState(activePort.base_currency);
        }
    }, [enabled, activePortfolioId, portfolios]);

    const handleCreatePortfolio = async (name: string, currency: string) => {
        const created = await createPortfolio({
            name,
            base_currency: currency,
            is_default: false,
        });
        setPortfolios((prev) => [...prev, created]);
        setActivePortfolioId(created.id);
        setBaseCurrencyState(created.base_currency || "TRY");
        return created;
    };

    return {
        portfolios,
        activePortfolioId,
        setActivePortfolioId,
        baseCurrency,
        loading,
        refreshPortfolios,
        isCreateModalOpen,
        setIsCreateModalOpen,
        handleCreatePortfolio,
    };
}

export type UsePortfolioStateReturn = ReturnType<typeof usePortfolioState>;

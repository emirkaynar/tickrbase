import {
    Activity,
    Briefcase,
    Calendar,
    FlaskConical,
    History,
    LineChart,
} from "lucide-react";
import { useEffect, useState } from "preact/hooks";
import { getPortfolioOverview } from "../../services/portfolio";
import type {
    PortfolioOverviewResponse,
    PortfolioSummary,
} from "../../services/types";
import type { UsePortfolioStateReturn } from "../../hooks/usePortfolioState";
import { Tabs } from "../../ui";

import { getSettingValue } from "../../services/settings";
import { useRouter } from "../../router";
import { CreatePortfolioModal } from "./dialogs/CreatePortfolioModal";
import { TradeTransactionModal } from "./dialogs/TradeTransactionModal";
import { PortfolioSubHeader } from "./subheader/PortfolioSubHeader";
import {
    DividendsTab,
    HoldingsTab,
    OverviewTab,
    SimulatorTab,
    XRayTab,
} from "./tabs";

import { TransactionTab } from "./tabs/transactions/TransactionsTab";

import styles from "./PortfolioPage.module.css";

interface PortfolioPageProps {
    portfolioState?: UsePortfolioStateReturn;
}

const VALID_TABS = ["overview", "holdings", "transactions", "xray", "dividends", "simulator"];

export function PortfolioPage({ portfolioState }: PortfolioPageProps) {
    const activePortfolioId = portfolioState?.activePortfolioId || "";
    const baseCurrency = portfolioState?.baseCurrency || "TRY";
    const portfolios = portfolioState?.portfolios || [];

    const { subRoute, navigate } = useRouter();
    const [activeTab, setActiveTab] = useState<string>(
        subRoute && VALID_TABS.includes(subRoute) ? subRoute : "overview",
    );
    const [pnlPeriod, setPnlPeriod] = useState<string>("all");
    const [showNativeSubtitles, setShowNativeSubtitles] = useState(true);
    const [overviewData, setOverviewData] =
        useState<PortfolioOverviewResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // Load native subtitle setting
    useEffect(() => {
        getSettingValue<boolean>("portfolio.showNativeSubtitles")
            .then((val) => setShowNativeSubtitles(val ?? true))
            .catch(() => setShowNativeSubtitles(true));
    }, []);

    // Sync subRoute hash -> activeTab
    useEffect(() => {
        if (subRoute && VALID_TABS.includes(subRoute)) {
            setActiveTab(subRoute);
        }
    }, [subRoute]);

    const handleTabChange = (val: string) => {
        setActiveTab(val);
        navigate("portfolio", val);
    };

    // Modal Visibility States
    const [isTradeModalOpen, setIsTradeModalOpen] = useState(false);

    const isCreatePortOpen = portfolioState?.isCreateModalOpen || false;
    const setIsCreatePortOpen = (open: boolean) =>
        portfolioState?.setIsCreateModalOpen(open);

    const loadData = async (signal?: AbortSignal) => {
        try {
            setLoading(true);
            setError("");
            await portfolioState?.refreshPortfolios();

            const overview = await getPortfolioOverview(
                activePortfolioId || undefined,
                signal,
                pnlPeriod,
            );
            setOverviewData(overview);
        } catch {
            if (!signal?.aborted) {
                setError("Could not load portfolio data.");
            }
        } finally {
            if (!signal?.aborted) {
                setLoading(false);
            }
        }
    };

    // Re-fetch when portfolio, currency, or pnl period changes
    useEffect(() => {
        const controller = new AbortController();
        void loadData(controller.signal);
        return () => controller.abort();
    }, [activePortfolioId, baseCurrency, pnlPeriod]);

    const handlePortfolioCreated = (newPort: PortfolioSummary) => {
        void portfolioState?.refreshPortfolios();
        portfolioState?.setActivePortfolioId(newPort.id);
    };

    const tabItems = [
        {
            value: "overview",
            label: (
                <span
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                    }}
                >
                    <LineChart size={14} /> Overview & Performance
                </span>
            ),
        },
        {
            value: "holdings",
            label: (
                <span
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                    }}
                >
                    <Briefcase size={14} /> Holdings (
                    {overviewData?.positions.length || 0})
                </span>
            ),
        },
        {
            value: "transactions",
            label: (
                <span
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                    }}
                >
                    <History size={14} /> Transactions
                </span>
            ),
        },
        {
            value: "xray",
            label: (
                <span
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                    }}
                >
                    <Activity size={14} /> X-Ray & AI Doctor
                </span>
            ),
        },
        {
            value: "dividends",
            label: (
                <span
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                    }}
                >
                    <Calendar size={14} /> Dividend Calendar
                </span>
            ),
        },
        {
            value: "simulator",
            label: (
                <span
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                    }}
                >
                    <FlaskConical size={14} /> Stress Simulator
                </span>
            ),
        },
    ];

    return (
        <div className={styles.root}>
            <PortfolioSubHeader
                baseCurrency={baseCurrency}
                kpis={overviewData?.kpis || null}
                loading={loading}
                pnlPeriod={pnlPeriod}
                onPnlPeriodChange={setPnlPeriod}
                onRefresh={() => void loadData()}
                onOpenTradeModal={() => setIsTradeModalOpen(true)}
            />

            <Tabs
                items={tabItems}
                value={activeTab}
                onChange={handleTabChange}
                className={styles.tabs}
            />

            <div className={styles.content}>
                {activeTab === "overview" && (
                    <OverviewTab
                        data={overviewData}
                        loading={loading}
                        error={error}
                        baseCurrency={baseCurrency}
                    />
                )}

                {activeTab === "holdings" && (
                    <HoldingsTab
                        positions={overviewData?.positions || []}
                        loading={loading}
                        error={error}
                        baseCurrency={baseCurrency}
                        showNativeSubtitles={showNativeSubtitles}
                    />
                )}

                {activeTab === "transactions" && (
                    <TransactionTab
                        portfolioId={activePortfolioId}
                        portfolios={portfolios}
                        baseCurrency={baseCurrency}
                        showNativeSubtitles={showNativeSubtitles}
                        onRefresh={() => void loadData()}
                    />
                )}

                {activeTab === "xray" && <XRayTab />}

                {activeTab === "dividends" && <DividendsTab />}

                {activeTab === "simulator" && <SimulatorTab />}
            </div>

            {/* Modals */}
            <CreatePortfolioModal
                open={isCreatePortOpen}
                onClose={() => setIsCreatePortOpen(false)}
                onCreated={handlePortfolioCreated}
            />

            <TradeTransactionModal
                open={isTradeModalOpen}
                onClose={() => setIsTradeModalOpen(false)}
                portfolios={portfolios}
                activePortfolioId={activePortfolioId}
                onSaved={() => void loadData()}
            />
        </div>
    );
}

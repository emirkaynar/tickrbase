import { useEffect, useState } from "preact/hooks";

// Feature imports must come before registry usages so widgets self-register
import "./widgets/BasicChart/BasicChart";
import "./widgets/AdvancedChart/AdvancedChart";
import "./widgets/EconomicCalendar/EconomicCalendar";
import "./widgets/Lists/Lists";

import { useRouter } from "./router";
import { useLayout } from "./grid/useLayout";
import { useTheme } from "./hooks/useTheme";
import { AppLayout } from "./layout/AppLayout";
import { TopBar } from "./layout/TopBar/TopBar";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { PortfolioPage } from "./features/portfolio/PortfolioPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { CommandPalette, toast, ToastViewport } from "./ui";
import type { CommandPalettePage } from "./ui";
import { livePricesClient, type LiveStatus } from "./services/livePrices";

export function App() {
    const { route, navigate } = useRouter();
    const { theme, toggleTheme } = useTheme();
    const layout = useLayout();

    const [paletteOpen, setPaletteOpen] = useState(false);
    const [palettePage, setPalettePage] = useState<CommandPalettePage>("root");
    const [liveStatus, setLiveStatus] = useState<LiveStatus>(
        livePricesClient.getStatus(),
    );

    function openPalette(page: CommandPalettePage) {
        setPalettePage(page);
        setPaletteOpen(true);
    }

    useEffect(() => {
        livePricesClient.connect();
        const unsubscribe = livePricesClient.onStatus(setLiveStatus);
        return () => {
            unsubscribe();
            livePricesClient.disconnect();
        };
    }, []);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            const isEditable =
                target?.tagName === "INPUT" ||
                target?.tagName === "TEXTAREA" ||
                target?.isContentEditable;

            if (isEditable) return;

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                openPalette("root");
            }
        };

        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, []);

    function handleAddWidget() {
        openPalette("add-widget");
    }

    function manageScreens() {
        openPalette("manage-screens");
    }

    async function handlePaletteAddWidget(
        type:
            | "basic-chart"
            | "advanced-chart"
            | "economic-calendar"
            | "watchlist",
    ) {
        const result = await layout.addWidget(type);
        if (!result.success && result.noSpace) {
            setPaletteOpen(false);
            toast.warning({
                title: "No space available",
                description:
                    "This screen is full. Remove or resize a widget, then try again.",
            });
        }
    }

    function handlePaletteCreateScreen(name?: string) {
        void layout.createScreen(name);
    }

    function handlePaletteRenameScreen(screenId: string, name: string) {
        void layout.renameScreen(screenId, name);
    }

    async function handlePaletteDeleteScreen(screenId: string) {
        return layout.deleteScreen(screenId);
    }

    function handlePaletteReorderScreens(nextIds: string[]) {
        void layout.reorderScreens(nextIds);
    }

    function handlePaletteMoveScreen(screenId: string, direction: -1 | 1) {
        void layout.moveScreen(screenId, direction);
    }

    const topBar = (
        <TopBar
            screens={layout.screens}
            activeScreenId={layout.activeScreenId}
            onScreenChange={(id) => void layout.setActiveScreen(id)}
            onManageScreens={manageScreens}
            onAddWidget={handleAddWidget}
            route={route}
            onNavigate={navigate}
            theme={theme}
            onToggleTheme={toggleTheme}
        />
    );

    return (
        <>
            <AppLayout topBar={topBar} contentKey={route}>
                {route === "dashboard" && (
                    <DashboardPage
                        layout={layout}
                        onAddWidget={handleAddWidget}
                    />
                )}
                {route === "portfolio" && <PortfolioPage />}
                {route === "settings" && <SettingsPage />}
            </AppLayout>

            {import.meta.env.MODE === "debug" && (
                <div
                    style={{
                        position: "fixed",
                        right: "12px",
                        bottom: "12px",
                        zIndex: 1000,
                        border: "1px solid var(--color-border)",
                        background: "var(--color-bg-elevated)",
                        color: "var(--color-text-muted)",
                        borderRadius: "var(--radius-sm)",
                        fontSize: "11px",
                        padding: "4px 8px",
                        pointerEvents: "none",
                    }}
                >
                    WS: {liveStatus}
                </div>
            )}

            <CommandPalette
                open={paletteOpen}
                initialPage={palettePage}
                onClose={() => setPaletteOpen(false)}
                onAddWidget={handlePaletteAddWidget}
                screens={layout.screens}
                activeScreenId={layout.activeScreenId}
                onSetActiveScreen={(id) => void layout.setActiveScreen(id)}
                onCreateScreen={handlePaletteCreateScreen}
                onRenameScreen={handlePaletteRenameScreen}
                onDeleteScreen={handlePaletteDeleteScreen}
                onReorderScreens={handlePaletteReorderScreens}
                onMoveScreen={handlePaletteMoveScreen}
            />

            <ToastViewport />
        </>
    );
}

// Feature imports must come before registry usages so widgets self-register
import "./widgets/StockChart/StockChart";

import { useRouter } from "./router";
import { useLayout } from "./grid/useLayout";
import { useTheme } from "./hooks/useTheme";
import { AppLayout } from "./layout/AppLayout";
import { TopBar } from "./layout/TopBar/TopBar";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { PortfolioPage } from "./features/portfolio/PortfolioPage";
import { AlertsPage } from "./features/alerts/AlertsPage";

export function App() {
    const { route, navigate } = useRouter();
    const { theme, toggleTheme } = useTheme();
    const layout = useLayout();

    function handleAddWidget() {
        void layout.addWidget("stock-chart");
    }

    const topBar = (
        <TopBar
            screens={layout.screens}
            activeScreenId={layout.activeScreenId}
            onScreenChange={(id) => void layout.setActiveScreen(id)}
            onCreateScreen={() => void layout.createScreen()}
            onRenameScreen={(name) => void layout.renameActiveScreen(name)}
            onAddWidget={handleAddWidget}
            route={route}
            onNavigate={navigate}
            theme={theme}
            onToggleTheme={toggleTheme}
        />
    );

    return (
        <AppLayout topBar={topBar} contentKey={route}>
            {route === "dashboard" && (
                <DashboardPage layout={layout} onAddWidget={handleAddWidget} />
            )}
            {route === "portfolio" && <PortfolioPage />}
            {route === "alerts" && <AlertsPage />}
        </AppLayout>
    );
}

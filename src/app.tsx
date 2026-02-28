import "./app.css";
import { Fieldset } from "@ark-ui/react/fieldset";
import { TopBar } from "./components/TopBar";
import { GridLayout } from "./grid/GridLayout";
import { useLayout } from "./grid/useLayout";

export function App() {
    const {
        screens,
        activeScreenId,
        widgets,
        layout,
        onLayoutChange,
        setActiveScreen,
        createScreen,
        renameActiveScreen,
        addWidget,
        removeWidget,
        ready,
    } = useLayout();

    if (!ready) {
        return <div class="grid-area" />;
    }

    const hasWidgets = widgets.length > 0;

    return (
        <>
            <TopBar
                screens={screens}
                activeScreenId={activeScreenId}
                onScreenChange={setActiveScreen}
                onCreateScreen={createScreen}
                onRenameScreen={renameActiveScreen}
                onAddWidget={() => addWidget("stock-chart")}
            />
            <div class="grid-area" key={activeScreenId}>
                {hasWidgets ? (
                    <GridLayout
                        layout={layout}
                        widgets={widgets}
                        onLayoutChange={onLayoutChange}
                        onRemoveWidget={removeWidget}
                    />
                ) : (
                    <div class="empty-state-wrap">
                        <Fieldset.Root className="empty-state-card">
                            <Fieldset.Legend className="empty-state-title">
                                Start with your first widget
                            </Fieldset.Legend>
                            <Fieldset.HelperText className="empty-state-subtitle">
                                Add a stock chart to begin building this screen.
                            </Fieldset.HelperText>
                            <button
                                type="button"
                                class="topbar-btn empty-state-cta"
                                onClick={() => addWidget("stock-chart")}
                            >
                                + Add Widget
                            </button>
                        </Fieldset.Root>
                    </div>
                )}
            </div>
        </>
    );
}

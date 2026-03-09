import { PlusIcon } from "lucide-react";
import { GridLayout } from "../../grid/GridLayout";
import { Button } from "../../ui";
import type { UseLayoutReturn } from "../../grid/useLayout";
import styles from "./DashboardPage.module.css";

type Props = {
    layout: UseLayoutReturn;
    onAddWidget: () => void;
};

export function DashboardPage({ layout, onAddWidget }: Props) {
    const {
        ready,
        widgets,
        layout: rglLayout,
        onLayoutChange,
        removeWidget,
        activeScreenId,
    } = layout;

    if (!ready) {
        return <div class={styles.loading} />;
    }

    if (widgets.length === 0) {
        return (
            <div
                key={activeScreenId}
                class={`${styles.empty} ${styles.screenFade}`}
            >
                <div class={styles.emptyCard}>
                    <p class={styles.emptyTitle}>No widgets yet</p>
                    <p class={styles.emptyHint}>Add a chart to get started.</p>
                    <Button variant="solid" size="md" onClick={onAddWidget}>
                        <PlusIcon />
                        Add widget
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div key={activeScreenId} class={`${styles.root} ${styles.screenFade}`}>
            <GridLayout
                layout={rglLayout}
                widgets={widgets}
                onLayoutChange={onLayoutChange}
                onRemoveWidget={removeWidget}
            />
        </div>
    );
}

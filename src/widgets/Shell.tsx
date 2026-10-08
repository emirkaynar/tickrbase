import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";
import { Skeleton, WidgetRemoveButton } from "../ui";
import { WidgetSettingsPopover } from "./settings/WidgetSettingsPopover";
import type { WidgetSettingsProps } from "./settings/types";
import styles from "./Shell.module.css";

type Props = {
    id?: string;
    className?: string;
    headerLeft?: ComponentChildren;
    headerRight?: ComponentChildren;
    settings?: WidgetSettingsProps;
    draggableHeaderLeft?: boolean;
    loading?: boolean;
    error?: string | null;
    onRemove?: () => void;
    children: ComponentChildren;
};

export function Shell({
    id,
    className,
    headerLeft,
    headerRight,
    settings,
    draggableHeaderLeft = false,
    loading = false,
    error,
    onRemove,
    children,
}: Props) {
    const fallbackId = useId();
    const hasSettings = settings?.definition.tabs.some(tab => tab.groups.some(group => group.settings.length > 0));

    return (
        <div className={[styles.root, className].filter(Boolean).join(" ")}>
            {(headerLeft || headerRight || hasSettings || onRemove) && (
                <div className={`${styles.handle} widget-handle`}>
                    <div
                        className={[
                            styles.headerLeft,
                            draggableHeaderLeft
                                ? `sc-drag-grip ${styles.draggableHeaderLeft}`
                                : "",
                        ]
                            .filter(Boolean)
                            .join(" ")}
                    >
                        {headerLeft}
                    </div>
                    <div className={`${styles.dragGrip} sc-drag-grip`} />
                    <div className={styles.headerRight}>
                        {headerRight}
                        {hasSettings && settings && (
                            <WidgetSettingsPopover {...settings} id={id ?? fallbackId} />
                        )}
                        {onRemove && (
                            <WidgetRemoveButton
                                class={styles.removeBtn}
                                onClick={onRemove}
                            />
                        )}
                    </div>
                </div>
            )}

            <div className={styles.body}>
                {children}
                {loading && (
                    <div className={styles.skeletonOverlay}>
                        <Skeleton variant="rect" />
                    </div>
                )}
                {error && (
                    <div className={styles.errorOverlay}>
                        <div className={styles.errorText}>{error}</div>
                    </div>
                )}
            </div>
        </div>
    );
}

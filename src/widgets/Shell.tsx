import type { ComponentChildren } from "preact";
import { Skeleton, WidgetRemoveButton } from "../ui";
import styles from "./Shell.module.css";

type Props = {
    id?: string;
    className?: string;
    headerLeft?: ComponentChildren;
    headerRight?: ComponentChildren;
    loading?: boolean;
    error?: string | null;
    onRemove?: () => void;
    children: ComponentChildren;
};

export function Shell({
    className,
    headerLeft,
    headerRight,
    loading = false,
    error,
    onRemove,
    children,
}: Props) {
    return (
        <div className={[styles.root, className].filter(Boolean).join(" ")}>
            {(headerLeft || headerRight || onRemove) && (
                <div className={`${styles.handle} widget-handle`}>
                    <div className={styles.headerLeft}>{headerLeft}</div>
                    <div className={`${styles.dragGrip} sc-drag-grip`} />
                    <div className={styles.headerRight}>
                        {headerRight}
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

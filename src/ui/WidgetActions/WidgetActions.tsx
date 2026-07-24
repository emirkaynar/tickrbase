import { Move, XIcon } from "lucide-react";
import styles from "./WidgetActions.module.css";
import { Tooltip } from "../Tooltip/Tooltip";

type BaseProps = {
    class?: string;
    title?: string;
};

type RemoveProps = BaseProps & {
    onClick: () => void;
};

export function WidgetRemoveButton({
    onClick,
    class: className,
    title = "Remove widget",
}: RemoveProps) {
    return (
        <Tooltip content="Remove widget">
            <button
                type="button"
                class={[styles.button, styles.remove, className]
                    .filter(Boolean)
                    .join(" ")}
                onClick={onClick}
                aria-label={title}
            >
                <span class={styles.iconSlot}>
                    <XIcon />
                </span>
            </button>
        </Tooltip>
    );
}

export function WidgetDragButton({
    class: className,
    title = "Drag widget",
}: BaseProps) {
    return (
        <Tooltip content="Move widget">
            <button
                type="button"
                class={[styles.button, styles.drag, "sc-drag-grip", className]
                    .filter(Boolean)
                    .join(" ")}
                aria-label={title}
            >
                <span class={styles.iconSlot}>
                    <Move />
                </span>
            </button>
        </Tooltip>
    );
}

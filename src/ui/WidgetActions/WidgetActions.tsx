import { Move, XIcon } from "lucide-react";
import styles from "./WidgetActions.module.css";

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
        <button
            type="button"
            class={[styles.button, styles.remove, className]
                .filter(Boolean)
                .join(" ")}
            onClick={onClick}
            title={title}
            aria-label={title}
        >
            <XIcon />
        </button>
    );
}

export function WidgetDragButton({
    class: className,
    title = "Drag widget",
}: BaseProps) {
    return (
        <button
            type="button"
            class={[styles.button, styles.drag, "sc-drag-grip", className]
                .filter(Boolean)
                .join(" ")}
            title={title}
            aria-label={title}
        >
            <Move />
        </button>
    );
}

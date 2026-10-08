import { Move, Ellipsis, XIcon } from "lucide-react";
import { forwardRef } from "preact/compat";
import { useCallback, useRef } from "preact/hooks";
import type { JSX } from "preact";
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

type OptionsProps = Omit<JSX.HTMLAttributes<HTMLButtonElement>, "title"> & BaseProps;

export const WidgetOptionsButton = forwardRef<HTMLButtonElement, OptionsProps>(
  ({ class: className, className: nativeClass, title = "Widget details and options", ...props }, ref) => {
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const setButtonRef = useCallback((button: HTMLButtonElement | null) => {
        buttonRef.current = button;
        if (typeof ref === "function") ref(button);
        else if (ref) ref.current = button;
    }, [ref]);
    const getAnchorElement = useCallback(() => buttonRef.current, []);

    return (
    <Tooltip content={title} getAnchorElement={getAnchorElement}>
        <button
            {...props}
            ref={setButtonRef}
            type="button"
            class={[styles.button, styles.options, className, nativeClass].filter(Boolean).join(" ")}
            aria-label={props["aria-label"] ?? title}
        >
            <span class={styles.iconSlot} aria-hidden="true">
                <Ellipsis />
            </span>
        </button>
    </Tooltip>
    );
  },
);

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

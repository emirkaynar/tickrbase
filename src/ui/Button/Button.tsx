import type { ComponentChildren } from "preact";
import styles from "./Button.module.css";

type ButtonVariant = "solid" | "ghost" | "outline";
type ButtonSize = "sm" | "md";

type Props = {
    variant?: ButtonVariant;
    size?: ButtonSize;
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
    onClick?: () => void;
    className?: string;
    children: ComponentChildren;
    title?: string;
};

export function Button({
    variant = "ghost",
    size = "sm",
    type = "button",
    disabled,
    onClick,
    className,
    children,
    title,
}: Props) {
    return (
        <button
            type={type}
            disabled={disabled}
            onClick={onClick}
            title={title}
            class={[styles.btn, styles[variant], styles[size], className]
                .filter(Boolean)
                .join(" ")}
        >
            {children}
        </button>
    );
}

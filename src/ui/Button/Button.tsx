import type { ComponentChildren, JSX } from "preact";
import styles from "./Button.module.css";

type ButtonVariant = "solid" | "ghost" | "outline";
type ButtonSize = "sm" | "md" | "icon";

type Props = JSX.HTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
    onClick?: (e: any) => void;
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
    ...rest
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
            {...rest}
        >
            {children}
        </button>
    );
}

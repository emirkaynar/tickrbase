import type { ComponentChildren } from "preact";
import styles from "./Badge.module.css";

type BadgeVariant =
    | "accent"
    | "bull"
    | "bear"
    | "success"
    | "warning"
    | "danger"
    | "amber-subtle"
    | "blue-subtle"
    | "muted";

type Props = {
    variant?: BadgeVariant;
    children: ComponentChildren;
    className?: string;
};

export function Badge({ variant = "muted", children, className }: Props) {
    return (
        <span
            class={[styles.badge, styles[variant], className]
                .filter(Boolean)
                .join(" ")}
        >
            {children}
        </span>
    );
}

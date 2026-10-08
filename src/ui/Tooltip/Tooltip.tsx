import type { ComponentChildren } from "preact";
import { useMemo } from "preact/hooks";
import { Tooltip as ArkTooltip } from "@ark-ui/react/tooltip";
import { Portal } from "@ark-ui/react/portal";
import styles from "./Tooltip.module.css";

type Props = {
    content: ComponentChildren;
    variant?: "default" | "long" | "popover";
    children: ComponentChildren;
    getAnchorElement?: () => HTMLElement | null;
};

export function Tooltip({ content, children, variant, getAnchorElement }: Props) {
    const positioning = useMemo(() => ({
        placement: "top" as const,
        ...(getAnchorElement ? { getAnchorElement } : {}),
    }), [getAnchorElement]);
    const variantClass =
        variant === "long"
            ? styles.long
            : variant === "popover"
            ? styles.popover
            : "";

    const triggerElement =
        typeof children === "string" || typeof children === "number" ? (
            <span tabIndex={0}>{children}</span>
        ) : (
            children
        );

    return (
        <ArkTooltip.Root openDelay={400} closeDelay={0} positioning={positioning}>
            <ArkTooltip.Trigger className={styles.trigger} asChild>
                {triggerElement}
            </ArkTooltip.Trigger>
            <Portal>
                <ArkTooltip.Positioner>
                    <ArkTooltip.Content className={`${styles.content} ${variantClass}`}>
                        {content}
                    </ArkTooltip.Content>
                </ArkTooltip.Positioner>
            </Portal>
        </ArkTooltip.Root>
    );
}

import type { ComponentChildren } from "preact";
import { Tooltip as ArkTooltip } from "@ark-ui/react/tooltip";
import { Portal } from "@ark-ui/react/portal";
import styles from "./Tooltip.module.css";

type Props = {
    content: string;
    children: ComponentChildren;
};

export function Tooltip({ content, children }: Props) {
    return (
        <ArkTooltip.Root openDelay={400} closeDelay={0} positioning={{placement: 'top'}}>
            <ArkTooltip.Trigger asChild>
                <span>{children}</span>
            </ArkTooltip.Trigger>
            <Portal>
                <ArkTooltip.Positioner>
                    <ArkTooltip.Content className={styles.content}>
                        {content}
                    </ArkTooltip.Content>
                </ArkTooltip.Positioner>
            </Portal>
        </ArkTooltip.Root>
    );
}

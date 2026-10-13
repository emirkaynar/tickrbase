import type { ComponentChildren } from "preact";
import { useMemo } from "preact/hooks";

import { Tooltip as ArkTooltip } from "@ark-ui/react/tooltip";
import { Portal } from "@ark-ui/react/portal";
import styles from "../../../ui/Tooltip/Tooltip.module.css";

type Props = {
  id?: string;
  placement?: "bottom-end";
  content: ComponentChildren;
  children: ComponentChildren;
};

export function MarketPillTooltip({ id, placement, content, children }: Props) {
  const positioning = useMemo(
    () => (placement === undefined ? undefined : { placement }),
    [placement],
  );

  return (
    <ArkTooltip.Root
      {...(id === undefined ? {} : { id })}
      {...(positioning === undefined ? {} : { positioning })}
    >
      <>
        <ArkTooltip.Trigger asChild>{children}</ArkTooltip.Trigger>
        <Portal>
          <ArkTooltip.Positioner>
            <ArkTooltip.Content className={styles.content}>
              {content}
            </ArkTooltip.Content>
          </ArkTooltip.Positioner>
        </Portal>
      </>
    </ArkTooltip.Root>
  );
}

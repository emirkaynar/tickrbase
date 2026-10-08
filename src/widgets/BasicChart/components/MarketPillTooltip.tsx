import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Tooltip as ArkTooltip } from "@ark-ui/react/tooltip";
import { Portal } from "@ark-ui/react/portal";
import styles from "../../../ui/Tooltip/Tooltip.module.css";

type Props = { content: ComponentChildren; children: ComponentChildren };

export function MarketPillTooltip({ content, children }: Props) {
    const [open, setOpen] = useState(false);
    const [pinned, setPinned] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const positioning = useMemo(() => ({
        placement: "top" as const,
        strategy: "fixed" as const,
        getAnchorElement: () => triggerRef.current,
    }), []);

    useEffect(() => {
        if (!pinned) return;
        const dismiss = () => { setPinned(false); setOpen(false); };
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node) || triggerRef.current?.contains(target) || contentRef.current?.contains(target)) return;
            dismiss();
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") dismiss();
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown, true);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown, true);
        };
    }, [pinned]);

    return (
        <ArkTooltip.Root
            open={open}
            onOpenChange={details => { if (!pinned) setOpen(details.open); }}
            openDelay={400}
            closeDelay={0}
            closeOnClick={false}
            closeOnPointerDown={false}
            closeOnEscape={!pinned}
            closeOnScroll={!pinned}
            interactive
            positioning={positioning}
        >
            <>
                <ArkTooltip.Trigger
                    asChild
                    ref={triggerRef}
                    aria-pressed={pinned}
                    onClick={() => {
                        setPinned(!pinned);
                        setOpen(!pinned);
                    }}
                >
                    {children}
                </ArkTooltip.Trigger>
                <Portal>
                    <ArkTooltip.Positioner>
                        <ArkTooltip.Content ref={contentRef} className={styles.content}>
                            {content}
                        </ArkTooltip.Content>
                    </ArkTooltip.Positioner>
                </Portal>
            </>
        </ArkTooltip.Root>
    );
}

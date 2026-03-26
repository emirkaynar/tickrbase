import type { ComponentChildren } from "preact";
import { Dialog as ArkDialog } from "@ark-ui/react/dialog";
import { Portal } from "@ark-ui/react/portal";
import { XIcon } from "lucide-react";
import styles from "./Dialog.module.css";

type Props = {
    open: boolean;
    onClose: () => void;
    title: string;
    description?: string;
    showCloseButton?: boolean;
    children: ComponentChildren;
};

export function Dialog({
    open,
    onClose,
    title,
    description,
    showCloseButton = true,
    children,
}: Props) {
    return (
        <ArkDialog.Root
            open={open}
            onOpenChange={(d) => {
                if (!d.open) onClose();
            }}
        >
            <Portal>
                <ArkDialog.Backdrop className={styles.backdrop} />
                <ArkDialog.Positioner className={styles.positioner}>
                    <ArkDialog.Content className={styles.content}>
                        <div className={styles.header}>
                            <ArkDialog.Title className={styles.title}>
                                {title}
                            </ArkDialog.Title>
                            {showCloseButton && (
                                <ArkDialog.CloseTrigger asChild>
                                    <button
                                        type="button"
                                        class={styles.closeBtn}
                                        aria-label="Close dialog"
                                        onClick={onClose}
                                    >
                                        <XIcon />
                                    </button>
                                </ArkDialog.CloseTrigger>
                            )}
                        </div>
                        {description && (
                            <ArkDialog.Description
                                className={styles.description}
                            >
                                {description}
                            </ArkDialog.Description>
                        )}
                        <div className={styles.body}>{children}</div>
                    </ArkDialog.Content>
                </ArkDialog.Positioner>
            </Portal>
        </ArkDialog.Root>
    );
}

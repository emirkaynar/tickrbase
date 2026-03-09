import type { ComponentChildren } from "preact";
import { Dialog as ArkDialog } from "@ark-ui/react/dialog";
import { Portal } from "@ark-ui/react/portal";
import { XIcon } from "lucide-react";
import styles from "./Dialog.module.css";

type Props = {
    open: boolean;
    onClose: () => void;
    title: string;
    children: ComponentChildren;
};

export function Dialog({ open, onClose, title, children }: Props) {
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
                            <ArkDialog.CloseTrigger asChild>
                                <button
                                    type="button"
                                    class={styles.closeBtn}
                                    onClick={onClose}
                                >
                                    <XIcon />
                                </button>
                            </ArkDialog.CloseTrigger>
                        </div>
                        <div className={styles.body}>{children}</div>
                    </ArkDialog.Content>
                </ArkDialog.Positioner>
            </Portal>
        </ArkDialog.Root>
    );
}

import type { ComponentChildren } from "preact";
import { Portal } from "@ark-ui/react/portal";
import {
    Toast as ArkToast,
    Toaster,
    createToaster,
    type ToastActionOptions,
    type CreateToasterProps,
    type ToastOptions,
    type ToastType,
} from "@ark-ui/react/toast";
import {
    CircleAlertIcon,
    CircleCheckIcon,
    InfoIcon,
    Loader2Icon,
    TriangleAlertIcon,
    XIcon,
} from "lucide-react";
import styles from "./Toast.module.css";

const toasterConfig: CreateToasterProps = {
    overlap: true,
    placement: "bottom-end",
    gap: 12,
    max: 5,
    pauseOnPageIdle: true,
};

export const toaster = createToaster(toasterConfig);

type ToastPayload = Omit<ToastOptions, "type">;

export type AppToastInput = ToastPayload & {
    type?: ToastType;
};

type Props = {
    title: string;
    description?: string;
    type?: ToastType;
    duration?: number;
    action?: ToastActionOptions;
    closable?: boolean;
    children: ComponentChildren;
};

export const toast = {
    create: (options: AppToastInput) => toaster.create(options),
    success: (options: ToastPayload) => toaster.success(options),
    error: (options: ToastPayload) => toaster.error(options),
    warning: (options: ToastPayload) => toaster.warning(options),
    info: (options: ToastPayload) => toaster.info(options),
    loading: (options: ToastPayload) => toaster.loading(options),
    update: toaster.update,
    dismiss: toaster.dismiss,
};

const iconByType: Partial<Record<ToastType, typeof InfoIcon>> = {
    success: CircleCheckIcon,
    error: CircleAlertIcon,
    warning: TriangleAlertIcon,
    info: InfoIcon,
    loading: Loader2Icon,
};

export function Toast({
    title,
    description,
    type = "info",
    duration,
    action,
    closable = true,
    children,
}: Props) {
    return (
        <button
            type="button"
            className={styles.trigger}
            onClick={() =>
                toaster.create({
                    title,
                    description,
                    type,
                    duration,
                    action,
                    closable,
                })
            }
        >
            {children}
        </button>
    );
}

export function ToastViewport() {
    return (
        <Portal>
            <Toaster toaster={toaster}>
                {(item) => {
                    const Icon = item.type ? iconByType[item.type] : undefined;
                    return (
                        <ArkToast.Root key={item.id} className={styles.root}>
                            <ArkToast.Title className={styles.title}>
                                {Icon && <Icon className={styles.indicator} />}
                                {item.title}
                            </ArkToast.Title>
                            {item.description && (
                                <ArkToast.Description
                                    className={styles.description}
                                >
                                    {item.description}
                                </ArkToast.Description>
                            )}
                            {item.action?.label && (
                                <ArkToast.ActionTrigger
                                    className={styles.actionTrigger}
                                >
                                    {item.action.label}
                                </ArkToast.ActionTrigger>
                            )}
                            {item.closable !== false && (
                                <ArkToast.CloseTrigger
                                    className={styles.closeTrigger}
                                >
                                    <XIcon />
                                </ArkToast.CloseTrigger>
                            )}
                        </ArkToast.Root>
                    );
                }}
            </Toaster>
        </Portal>
    );
}

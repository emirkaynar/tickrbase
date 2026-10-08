import { Switch as ArkSwitch } from "@ark-ui/react/switch";
import styles from "./Switch.module.css";

type SwitchSize = "sm" | "md" | "lg";

export interface SwitchProps {
    id?: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
    size?: SwitchSize;
    className?: string;
    /** Provide an accessible name with aria-label or aria-labelledby. */
    "aria-label"?: string;
    "aria-labelledby"?: string;
    "aria-describedby"?: string;
}

export function Switch({
    id,
    checked,
    onChange,
    disabled,
    size = "md",
    className,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    "aria-describedby": ariaDescribedBy,
}: SwitchProps) {
    return (
        <ArkSwitch.Root
            {...(id ? { id } : {})}
            className={[styles.root, styles[size], className].filter(Boolean).join(" ")}
            checked={checked}
            disabled={disabled}
            onCheckedChange={(details) => onChange(details.checked)}
        >
            <ArkSwitch.HiddenInput
                className={styles.hiddenInput}
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledBy}
                aria-describedby={ariaDescribedBy}
            />
            <ArkSwitch.Control className={styles.control}>
                <ArkSwitch.Thumb className={styles.thumb} />
            </ArkSwitch.Control>
        </ArkSwitch.Root>
    );
}

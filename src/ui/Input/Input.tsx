import styles from "./Input.module.css";

type InputSize = "sm" | "md";

type Props = {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    size?: InputSize;
    error?: boolean;
    disabled?: boolean;
    autoFocus?: boolean;
    className?: string;
    id?: string;
    type?: "text" | "number" | "email";
};

export function Input({
    value,
    onChange,
    placeholder,
    size = "sm",
    error,
    disabled,
    autoFocus,
    className,
    id,
    type = "text",
}: Props) {
    return (
        <input
            id={id}
            type={type}
            value={value}
            onInput={(e) =>
                onChange((e.currentTarget as HTMLInputElement).value)
            }
            placeholder={placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            class={[
                styles.input,
                styles[size],
                error ? styles.error : "",
                className,
            ]
                .filter(Boolean)
                .join(" ")}
        />
    );
}

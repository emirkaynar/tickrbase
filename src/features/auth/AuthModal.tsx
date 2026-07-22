import { useState } from "preact/hooks";
import styles from "./AuthModal.module.css";

type Props = {
    onLogin: (email: string, pass: string) => Promise<boolean>;
    onRegister: (email: string, pass: string) => Promise<boolean>;
    loading: boolean;
    error: string | null;
};

export function AuthModal({ onLogin, onRegister, loading, error: externalError }: Props) {
    const [mode, setMode] = useState<"login" | "register">("login");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [localError, setLocalError] = useState<string | null>(null);

    const handleSubmit = async (e: Event) => {
        e.preventDefault();
        setLocalError(null);

        if (!email.trim() || !password) {
            setLocalError("Please fill in all fields.");
            return;
        }

        if (mode === "login") {
            await onLogin(email.trim(), password);
        } else {
            await onRegister(email.trim(), password);
        }
    };

    const activeError = localError || externalError;

    return (
        <div class={styles.overlay}>
            <div class={styles.modal}>
                <div class={styles.header}>
                    <div class={styles.logo}>lima</div>
                    <div class={styles.subtitle}>
                        {mode === "login"
                            ? "Sign in to access your investment dashboard"
                            : "Create an account to get started"}
                    </div>
                </div>

                <div class={styles.tabs}>
                    <button
                        type="button"
                        class={[styles.tab, mode === "login" ? styles.tabActive : ""].join(" ")}
                        onClick={() => {
                            setMode("login");
                            setLocalError(null);
                        }}
                    >
                        Sign In
                    </button>
                    <button
                        type="button"
                        class={[styles.tab, mode === "register" ? styles.tabActive : ""].join(" ")}
                        onClick={() => {
                            setMode("register");
                            setLocalError(null);
                        }}
                    >
                        Register
                    </button>
                </div>

                <form class={styles.form} onSubmit={handleSubmit}>
                    {activeError && (
                        <div class={styles.errorBanner}>
                            <span>⚠️</span>
                            <span>{activeError}</span>
                        </div>
                    )}

                    <div class={styles.field}>
                        <label class={styles.label}>Email Address</label>
                        <input
                            type="email"
                            class={styles.input}
                            placeholder="name@example.com"
                            value={email}
                            onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
                            required
                        />
                    </div>

                    <div class={styles.field}>
                        <label class={styles.label}>Password</label>
                        <input
                            type="password"
                            class={styles.input}
                            placeholder="••••••••"
                            value={password}
                            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
                            required
                        />
                    </div>

                    <button
                        type="submit"
                        class={styles.submitBtn}
                        disabled={loading}
                    >
                        {loading
                            ? "Processing..."
                            : mode === "login"
                            ? "Sign In"
                            : "Create Account"}
                    </button>
                </form>
            </div>
        </div>
    );
}

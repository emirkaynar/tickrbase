import styles from "./SettingsPage.module.css";

export function SettingsPage() {
    return (
        <div class={styles.root}>
            <div class={styles.header}>
                <h1 class={styles.title}>Settings</h1>
                <p class={styles.subtitle}>
                    Customize your experience — coming soon.
                </p>
            </div>
        </div>
    );
}

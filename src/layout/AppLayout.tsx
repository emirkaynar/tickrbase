import type { ComponentChildren } from "preact";
import styles from "./layout.module.css";

type Props = {
    topBar: ComponentChildren;
    children: ComponentChildren;
};

export function AppLayout({ topBar, children }: Props) {
    return (
        <div class={styles.shell}>
            {topBar}
            <main class={styles.main}>{children}</main>
        </div>
    );
}

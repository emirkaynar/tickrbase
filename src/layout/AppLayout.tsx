import type { ComponentChildren } from "preact";
import styles from "./layout.module.css";

type Props = {
    topBar: ComponentChildren;
    children: ComponentChildren;
    contentKey: string;
};

export function AppLayout({ topBar, children, contentKey }: Props) {
    return (
        <div class={styles.shell}>
            {topBar}
            <main key={contentKey} class={styles.main}>
                {children}
            </main>
        </div>
    );
}

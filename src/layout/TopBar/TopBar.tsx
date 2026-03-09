import { useEffect, useState } from "preact/hooks";
import { MoonIcon, PlusIcon, SunIcon, PencilIcon } from "lucide-react";
import { Button, Dialog, Input, Tabs } from "../../ui";
import type { TabItem } from "../../ui";
import type { Theme } from "../../hooks/useTheme";
import type { Route } from "../../router";
import styles from "./TopBar.module.css";

type Screen = { id: string; name: string };

type Props = {
    screens: Screen[];
    activeScreenId: string;
    onScreenChange: (id: string) => void;
    onCreateScreen: () => void;
    onRenameScreen: (name: string) => void;
    onAddWidget: () => void;
    route: Route;
    onNavigate: (r: Route) => void;
    theme: Theme;
    onToggleTheme: () => void;
};

function toIstanbul(date: Date, opts: Intl.DateTimeFormatOptions): string {
    return new Intl.DateTimeFormat("tr-TR", {
        timeZone: "Europe/Istanbul",
        ...opts,
    }).format(date);
}

function useClock() {
    const [time, setTime] = useState(() =>
        toIstanbul(new Date(), {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        }),
    );
    useEffect(() => {
        const id = setInterval(() => {
            setTime(
                toIstanbul(new Date(), {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false,
                }),
            );
        }, 1000);
        return () => clearInterval(id);
    }, []);
    return time;
}

export function TopBar({
    screens,
    activeScreenId,
    onScreenChange,
    onCreateScreen,
    onRenameScreen,
    onAddWidget,
    route,
    onNavigate,
    theme,
    onToggleTheme,
}: Props) {
    const clock = useClock();
    const [renameOpen, setRenameOpen] = useState(false);
    const [renameValue, setRenameValue] = useState("");

    const openRename = () => {
        const current = screens.find((s) => s.id === activeScreenId);
        setRenameValue(current?.name ?? "");
        setRenameOpen(true);
    };

    const submitRename = () => {
        const trimmed = renameValue.trim();
        if (trimmed) onRenameScreen(trimmed);
        setRenameOpen(false);
    };

    const tabItems: TabItem[] = screens.map((s) => ({
        value: s.id,
        label: s.name,
    }));

    const navLinks: { label: string; route: Route }[] = [
        { label: "Dashboard", route: "dashboard" },
        { label: "Portfolio", route: "portfolio" },
        { label: "Alerts", route: "alerts" },
    ];

    return (
        <>
            <header class={styles.topbar}>
                {/* Brand */}
                <span class={styles.brand}>lima</span>

                {/* Screen tabs — only visible on dashboard route */}
                {route === "dashboard" && (
                    <div class={styles.screenStrip}>
                        <Tabs
                            items={tabItems}
                            value={activeScreenId}
                            onChange={onScreenChange}
                        />
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onCreateScreen}
                            title="New screen"
                        >
                            <PlusIcon />
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={openRename}
                            title="Rename screen"
                        >
                            <PencilIcon />
                        </Button>
                    </div>
                )}

                {/* Add widget — only on dashboard */}
                {route === "dashboard" && (
                    <Button variant="outline" size="sm" onClick={onAddWidget}>
                        <PlusIcon /> Widget
                    </Button>
                )}

                <div class={styles.spacer} />

                {/* Nav */}
                <nav class={styles.nav}>
                    {navLinks.map((link) => (
                        <a
                            key={link.route}
                            href={`#${link.route}`}
                            class={[
                                styles.navLink,
                                route === link.route ? styles.navActive : "",
                            ].join(" ")}
                            onClick={(e) => {
                                e.preventDefault();
                                onNavigate(link.route);
                            }}
                        >
                            {link.label}
                        </a>
                    ))}
                </nav>

                {/* Theme toggle */}
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onToggleTheme}
                    title="Toggle theme"
                >
                    {theme === "dark" ? <SunIcon /> : <MoonIcon />}
                </Button>

                {/* Clock */}
                <span class={styles.clock}>{clock}</span>
            </header>

            {/* Rename dialog */}
            <Dialog
                open={renameOpen}
                onClose={() => setRenameOpen(false)}
                title="Rename screen"
            >
                <div class={styles.renameForm}>
                    <Input
                        value={renameValue}
                        onChange={setRenameValue}
                        placeholder="Screen name"
                        size="md"
                        autoFocus
                    />
                    <div class={styles.renameActions}>
                        <Button
                            variant="ghost"
                            size="md"
                            onClick={() => setRenameOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="solid"
                            size="md"
                            onClick={submitRename}
                        >
                            Rename
                        </Button>
                    </div>
                </div>
            </Dialog>
        </>
    );
}

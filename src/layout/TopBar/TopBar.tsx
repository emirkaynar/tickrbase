import { useEffect, useState } from "preact/hooks";
import { MoonIcon, PlusIcon, SunIcon, PencilIcon, Settings, LogOut, User as UserIcon } from "lucide-react";
import { Button, Tabs, Tooltip } from "../../ui";
import type { TabItem } from "../../ui";
import type { Theme } from "../../hooks/useTheme";
import type { Route } from "../../router";
import type { UserMe } from "../../services/api";
import styles from "./TopBar.module.css";

type Screen = { id: string; name: string };

type Props = {
    screens: Screen[];
    activeScreenId: string;
    onScreenChange: (id: string) => void;
    onManageScreens: () => void;
    onAddWidget: () => void;
    route: Route;
    onNavigate: (r: Route) => void;
    theme: Theme;
    onToggleTheme: () => void;
    user: UserMe | null;
    onLogout: () => void;
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
    onManageScreens,
    onAddWidget,
    route,
    onNavigate,
    theme,
    onToggleTheme,
    user,
    onLogout,
}: Props) {
    const clock = useClock();

    const tabItems: TabItem[] = screens.map((s) => ({
        value: s.id,
        label: s.name,
    }));

    const navLinks: { label: string; route: Route }[] = [
        { label: "Dashboard", route: "dashboard" },
        { label: "Portfolio", route: "portfolio" },
        { label: "Settings", route: "settings" },
    ];

    return (
        <>
            <header class={styles.topbar}>
                {/* Brand */}
                <span class={styles.brand}>tickrbase</span>

                {/* Screen tabs — only visible on dashboard route */}
                {route === "dashboard" && (
                    <div class={styles.screenStrip}>
                        <Tabs
                            items={tabItems}
                            value={activeScreenId}
                            onChange={onScreenChange}
                        />
                        <Tooltip content="Manage screens">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onManageScreens}
                                title="Manage screens"
                            >
                                <PencilIcon />
                            </Button>
                        </Tooltip>
                    </div>
                )}

                {/* Add widget — only on dashboard */}
                {route === "dashboard" && (
                    <Tooltip content="Add widget">
                    <Button variant="outline" size="sm" onClick={onAddWidget}>
                        <PlusIcon /> Widget
                    </Button>
                    </Tooltip>
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
                            {link.label === "Settings" ? (
                                <>
                                <Tooltip content="Settings">
                                    <span class={styles.navIcon}>
                                        <Settings size={14} />
                                    </span>
                                </Tooltip>
                                </>
                            ) : (
                                link.label
                            )}
                        </a>
                    ))}
                </nav>

                {/* User indicator & Logout */}
                {user && (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "12px", color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
                            <UserIcon size={13} /> {user.email}
                        </span>
                        <Tooltip content="Log out">
                            <Button variant="ghost" size="sm" onClick={onLogout} title="Log out">
                                <LogOut size={14} />
                            </Button>
                        </Tooltip>
                    </div>
                )}

                {/* Theme toggle */}
                <Tooltip content="Toggle theme">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onToggleTheme}
                        title="Toggle theme"
                    >
                        {theme === "dark" ? <SunIcon /> : <MoonIcon />}
                    </Button>
                </Tooltip>
                {/* Clock */}
                <span class={styles.clock}>{clock}</span>
            </header>
        </>
    );
}

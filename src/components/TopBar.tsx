import { useEffect, useState } from "preact/hooks";

type ScreenOption = {
    id: string;
    name: string;
};

type Props = {
    screens: ScreenOption[];
    activeScreenId: string;
    onScreenChange: (screenId: string) => void;
    onCreateScreen: () => void;
    onRenameScreen: (name: string) => void;
    onAddWidget: () => void;
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
}: Props) {
    const clock = useClock();

    const renameCurrent = () => {
        const current = screens.find((screen) => screen.id === activeScreenId);
        const nextName = window.prompt(
            "Screen name",
            current?.name ?? "New Screen",
        );
        if (!nextName) return;
        onRenameScreen(nextName);
    };

    return (
        <header class="topbar">
            <span class="topbar-brand">lima</span>
            <div class="topbar-actions">
                <button type="button" class="topbar-btn" onClick={onAddWidget}>
                    + Widget
                </button>
                <select
                    class="topbar-select"
                    value={activeScreenId}
                    onChange={(event) =>
                        onScreenChange(
                            (event.currentTarget as HTMLSelectElement).value,
                        )
                    }
                >
                    {screens.map((screen) => (
                        <option value={screen.id} key={screen.id}>
                            {screen.name}
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    class="topbar-btn"
                    onClick={onCreateScreen}
                >
                    + Screen
                </button>
                <button
                    type="button"
                    class="topbar-btn"
                    onClick={renameCurrent}
                >
                    Rename
                </button>
            </div>
            <span class="topbar-clock">{clock}</span>
        </header>
    );
}

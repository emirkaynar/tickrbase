import { useEffect, useState } from "preact/hooks";

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

export function TopBar() {
    const clock = useClock();
    return (
        <header class="topbar">
            <span class="topbar-brand">lima</span>
            <span class="topbar-clock">{clock}</span>
        </header>
    );
}

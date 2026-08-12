import { useState, useEffect } from "preact/hooks";

export type Route = "dashboard" | "portfolio" | "settings";

const ROUTES: Route[] = ["dashboard", "portfolio", "settings"];

export interface RouterState {
    route: Route;
    subRoute: string;
}

function readHash(): RouterState {
    const raw = window.location.hash.replace(/^#\/?/, "");
    const parts = raw.split("/");
    const mainRoute = parts[0] as Route;

    if (ROUTES.includes(mainRoute)) {
        return {
            route: mainRoute,
            subRoute: parts.slice(1).join("/"),
        };
    }

    return {
        route: "dashboard",
        subRoute: "",
    };
}

export function useRouter(): {
    route: Route;
    subRoute: string;
    navigate: (r: Route, sub?: string) => void;
} {
    const [state, setState] = useState<RouterState>(readHash);

    useEffect(() => {
        const handler = () => setState(readHash());
        window.addEventListener("hashchange", handler);
        return () => window.removeEventListener("hashchange", handler);
    }, []);

    const navigate = (r: Route, sub?: string) => {
        const hash = sub ? `${r}/${sub}` : r;
        window.location.hash = hash;
    };

    return { route: state.route, subRoute: state.subRoute, navigate };
}

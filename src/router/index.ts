import { useState, useEffect } from "preact/hooks";

export type Route = "dashboard" | "portfolio" | "alerts";

const ROUTES: Route[] = ["dashboard", "portfolio", "alerts"];

function readHash(): Route {
    const hash = window.location.hash.replace("#", "") as Route;
    return ROUTES.includes(hash) ? hash : "dashboard";
}

export function useRouter(): { route: Route; navigate: (r: Route) => void } {
    const [route, setRoute] = useState<Route>(readHash);

    useEffect(() => {
        const handler = () => setRoute(readHash());
        window.addEventListener("hashchange", handler);
        return () => window.removeEventListener("hashchange", handler);
    }, []);

    const navigate = (r: Route) => {
        window.location.hash = r;
    };

    return { route, navigate };
}

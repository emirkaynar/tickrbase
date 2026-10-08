import { useEffect, useState } from "preact/hooks";
import { getSettingValue, subscribeSetting, isValidTimezone } from "./settings";

export function useUserTimezone(): string {
    const [timezone, setTimezone] = useState("UTC");
    useEffect(() => {
        let cancelled = false;
        let changed = false;
        const unsubscribe = subscribeSetting("general.timezone", value => {
            changed = true;
            if (typeof value === "string" && isValidTimezone(value)) setTimezone(value);
        });
        void getSettingValue<string>("general.timezone").then(value => {
            if (!cancelled && !changed && isValidTimezone(value)) setTimezone(value);
        });
        return () => { cancelled = true; unsubscribe(); };
    }, []);
    return timezone;
}

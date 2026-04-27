import { useEffect, useState } from "preact/hooks";
import { getAllSettings, type SettingDefinition } from "../../settings/registry";
import { getSettingValue, setSettingValue } from "../../services/settings";
import styles from "./SettingsPage.module.css";

export function SettingsPage() {
    const [settings, setSettings] = useState<SettingDefinition[]>([]);
    const [values, setValues] = useState<Record<string, any>>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            const allDefs = getAllSettings();
            setSettings(allDefs);

            const nextValues: Record<string, any> = {};
            for (const def of allDefs) {
                nextValues[def.id] = await getSettingValue(def.id);
            }
            setValues(nextValues);
            setLoading(false);
        };
        void load();
    }, []);

    const handleToggle = async (id: string, currentValue: boolean) => {
        const nextValue = !currentValue;
        setValues((prev) => ({ ...prev, [id]: nextValue }));
        await setSettingValue(id, nextValue);
    };

    if (loading) {
        return <div class={styles.root}>Loading settings...</div>;
    }

    // Group settings by groupLabel
    const groups = settings.reduce((acc, def) => {
        if (!acc[def.groupLabel]) {
            acc[def.groupLabel] = [];
        }
        acc[def.groupLabel].push(def);
        return acc;
    }, {} as Record<string, SettingDefinition[]>);

    return (
        <div class={styles.root}>
            <div class={styles.header}>
                <h1 class={styles.title}>Settings</h1>
                <p class={styles.subtitle}>
                    Customize your experience.
                </p>
            </div>

            <div className={styles.content}>
                {Object.entries(groups).map(([groupLabel, defs]) => (
                    <section key={groupLabel} className={styles.section}>
                        <h2 className={styles.sectionTitle}>{groupLabel}</h2>
                        <div className={styles.settingsList}>
                            {defs.map((def) => (
                                <div key={def.id} className={styles.settingItem}>
                                    <div className={styles.settingInfo}>
                                        <div className={styles.settingLabel}>
                                            {def.label}
                                        </div>
                                        {def.description && (
                                            <div className={styles.settingDescription}>
                                                {def.description}
                                            </div>
                                        )}
                                    </div>
                                    <div className={styles.settingControl}>
                                        {def.type === "boolean" ? (
                                            <input
                                                type="checkbox"
                                                checked={!!values[def.id]}
                                                onChange={() => handleToggle(def.id, !!values[def.id])}
                                            />
                                        ) : (
                                            <span className={styles.readOnlyValue}>
                                                {String(values[def.id])} (Read-only)
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
}

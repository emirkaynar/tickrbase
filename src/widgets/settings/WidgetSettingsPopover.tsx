import { Popover as ArkPopover } from "@ark-ui/react/popover";
import { Portal } from "@ark-ui/react/portal";
import { Tabs as ArkTabs } from "@ark-ui/react/tabs";
import { useMemo, useRef, useState } from "preact/hooks";
import { Select } from "../../ui/Select/Select";
import { Switch } from "../../ui/Switch/Switch";
import { WidgetOptionsButton } from "../../ui/WidgetActions/WidgetActions";
import type { WidgetSettingsProps } from "./types";
import styles from "./WidgetSettingsPopover.module.css";

export function WidgetSettingsPopover({
    id, definition, values, onChange, onReset, ready, status, error, onRetry,
}: WidgetSettingsProps & { id: string }) {
    const [open, setOpen] = useState(false);
    const [activeTab, setActiveTab] = useState(definition.tabs[0]?.id);
    const optionsRef = useRef<HTMLButtonElement | null>(null);
    // Keep the real button anchor and positioning identity stable across lazy-mount/reopen.
    const positioning = useMemo(() => ({
        placement: "bottom-end" as const,
        strategy: "fixed" as const,
        gutter: 8,
        flip: true,
        hideWhenDetached: true,
        getAnchorElement: () => optionsRef.current,
    }), []);
    const returnFocusRef = useRef(false);
    const outsideTargetRef = useRef<EventTarget | null>(null);
    const popoverId = `widget-settings-${encodeURIComponent(id)}`;
    const tabValue = definition.tabs.some(tab => tab.id === activeTab) ? activeTab : definition.tabs[0]?.id;
    const failed = Boolean(error) || status === "error";
    const statusMessage = failed ? "" : !ready || status === "loading" ? "Loading settings…"
        : status === "saving" ? "Saving…" : status === "unsaved" ? "Changes not saved." : "";

    if (!definition.tabs.some(tab => tab.groups.some(group => group.settings.length > 0))) return null;

    return (
        <ArkPopover.Root
            id={`${popoverId}-popover`}
            open={open}
            onOpenChange={details => setOpen(details.open)}
            ids={{ content: popoverId }}
            positioning={positioning}
            onEscapeKeyDown={() => {
                outsideTargetRef.current = null;
                returnFocusRef.current = true;
            }}
            onInteractOutside={event => {
                outsideTargetRef.current = event.detail.target;
                returnFocusRef.current = true;
            }}
            onExitComplete={() => {
                if (!returnFocusRef.current) return;
                returnFocusRef.current = false;
                requestAnimationFrame(() => {
                    const target = outsideTargetRef.current;
                    outsideTargetRef.current = null;
                    // Preserve outside control focus; restore the header after blank-widget dismissal.
                    if (target instanceof Element && target.closest("button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1']), [contenteditable='true']")) return;
                    optionsRef.current?.focus();
                });
            }}
            lazyMount
        >
            <>
            <ArkPopover.Trigger asChild>
                <WidgetOptionsButton
                    ref={optionsRef}
                    title={definition.title}
                    onClick={() => {
                        outsideTargetRef.current = null;
                        returnFocusRef.current = false;
                    }}
                />
            </ArkPopover.Trigger>
            <Portal>
                <ArkPopover.Positioner className={styles.positioner}>
                    <ArkPopover.Content className={styles.content} onPointerDown={event => event.stopPropagation()}>
                        <div class={styles.header}>
                            <ArkPopover.Title className={styles.title}>{definition.title}</ArkPopover.Title>
                            <button type="button" class={styles.action} disabled={!ready} onClick={onReset}>Reset</button>
                        </div>
                        <ArkTabs.Root
                            id={`${popoverId}-tabs`}
                            value={tabValue}
                            onValueChange={details => setActiveTab(details.value)}
                            className={styles.tabs}
                        >
                            <ArkTabs.List className={styles.tabList} aria-label="Settings categories">
                                {definition.tabs.map(tab => (
                                    <ArkTabs.Trigger key={tab.id} value={tab.id} className={styles.tabTrigger}>
                                        {tab.label}
                                    </ArkTabs.Trigger>
                                ))}
                            </ArkTabs.List>
                            <div class={styles.scrollBody}>
                                {definition.tabs.map(tab => (
                                    <ArkTabs.Content key={tab.id} value={tab.id} className={styles.tabContent}>
                                        {tab.groups.map(group => {
                                            const groupId = `${popoverId}-${encodeURIComponent(tab.id)}-${encodeURIComponent(group.id)}`;
                                            return (
                                                <section key={group.id} class={styles.group} aria-labelledby={`${groupId}-heading`}>
                                                    <h3 id={`${groupId}-heading`} class={styles.groupHeading}>{group.label}</h3>
                                                    {group.settings.map(setting => {
                                                        const settingId = `${groupId}-${encodeURIComponent(setting.id)}`;
                                                        const labelId = `${settingId}-label`;
                                                        const descriptionId = setting.description ? `${settingId}-description` : undefined;
                                                        const value = values[setting.id];
                                                        return (
                                                            <div key={setting.id} class={styles.row}>
                                                                <div class={styles.labelBlock}>
                                                                    <span id={labelId} class={styles.label}>{setting.label}</span>
                                                                    {setting.description && <p id={descriptionId} class={styles.description}>{setting.description}</p>}
                                                                </div>
                                                                {setting.type === "boolean" ? (
                                                                    <Switch
                                                                        id={`${settingId}-switch`}
                                                                        checked={typeof value === "boolean" ? value : setting.defaultValue}
                                                                        onChange={checked => onChange(setting.id, checked)}
                                                                        size="sm"
                                                                        disabled={!ready}
                                                                        aria-labelledby={labelId}
                                                                        aria-describedby={descriptionId}
                                                                    />
                                                                ) : (
                                                                    <Select
                                                                        id={`${settingId}-select`}
                                                                        items={setting.options}
                                                                        value={typeof value === "string" ? value : setting.defaultValue}
                                                                        onChange={next => onChange(setting.id, next)}
                                                                        disabled={!ready}
                                                                        variant="preferences"
                                                                        placement="bottom-end"
                                                                        className={styles.preferencesSelect}
                                                                        aria-labelledby={labelId}
                                                                        aria-describedby={descriptionId}
                                                                    />
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </section>
                                            );
                                        })}
                                    </ArkTabs.Content>
                                ))}
                            </div>
                        </ArkTabs.Root>
                        <div class={styles.feedback}>
                            <div class={styles.status} role="status" aria-live="polite" aria-atomic="true">{statusMessage}</div>
                            {failed && (
                                <div class={styles.error} role="alert">
                                    <span>{error || "Unable to save settings."}</span>
                                    <button type="button" class={styles.action} onClick={onRetry}>Retry</button>
                                </div>
                            )}
                        </div>
                    </ArkPopover.Content>
                </ArkPopover.Positioner>
            </Portal>
            </>
        </ArkPopover.Root>
    );
}

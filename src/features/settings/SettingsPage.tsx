import { useEffect, useState } from "preact/hooks";
import { Tabs as ArkTabs } from "@ark-ui/react/tabs";
import { Switch as ArkSwitch } from "@ark-ui/react/switch";
import { Editable as ArkEditable } from "@ark-ui/react/editable";
import { ScrollArea as ArkScrollArea } from "@ark-ui/react";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  getAllSettings,
  type SettingDefinition,
  type SettingValue,
} from "../../settings/registry";
import { getSettingValue, setSettingValue } from "../../services/settings";
import styles from "./SettingsPage.module.css";

type LucideIconName = keyof typeof LucideIcons;

type SettingsSection = {
  key: string;
  category: string;
  subcategoryId: string;
  subcategoryLabel: string;
  subcategoryIcon?: string;
  defs: SettingDefinition[];
};

function getLucideIcon(iconName?: string): LucideIcon | null {
  if (!iconName) return null;
  const icon = LucideIcons[iconName as LucideIconName];
  return typeof icon === "function" ? (icon as LucideIcon) : null;
}

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingDefinition[]>([]);
  const [values, setValues] = useState<Record<string, SettingValue>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const allDefs = getAllSettings();
      setSettings(allDefs);

      const nextValues: Record<string, SettingValue> = {};
      for (const def of allDefs) {
        nextValues[def.id] = await getSettingValue(def.id);
      }
      setValues(nextValues);
      setLoading(false);
    };
    void load();
  }, []);

  const handleBooleanChange = async (id: string, nextValue: boolean) => {
    setValues((prev) => ({ ...prev, [id]: nextValue }));
    await setSettingValue(id, nextValue);
  };

  const renderSettingControl = (def: SettingDefinition) => {
    if (def.type === "boolean") {
      return (
        <ArkSwitch.Root
          className={styles.switchRoot}
          checked={values[def.id] === true}
          onCheckedChange={(details) => {
            void handleBooleanChange(def.id, details.checked);
          }}
        >
          <ArkSwitch.HiddenInput />
          <ArkSwitch.Control className={styles.switchControl}>
            <ArkSwitch.Thumb className={styles.switchThumb} />
          </ArkSwitch.Control>
        </ArkSwitch.Root>
      );
    }
    if (def.type === "string") {
      return (
        <ArkEditable.Root
          className={styles.editableRoot}
          placeholder="Enter a description..."
          value={values[def.id] == null ? "" : String(values[def.id])}
          onValueChange={(details) => {
            setValues((prev) => ({
              ...prev,
              [def.id]: details.value,
            }));
            setSettingValue(def.id, details.value);
          }}
          activationMode="focus"
          autoResize
          spellcheck={false}
        >
          <ArkEditable.Area className={styles.editableArea}>
            <ArkEditable.Input className={styles.editableTextarea} asChild>
              <textarea />
            </ArkEditable.Input>
            <ArkEditable.Preview className={styles.editableTextarea} />
          </ArkEditable.Area>
          <div className={styles.editableHelperText}>
            Click to edit / Ctrl + Enter to save
          </div>
        </ArkEditable.Root>
      );
    }
    if (def.type === "integer") {
      const integerValue = values[def.id];
      return (
        <input
          type="number"
          value={typeof integerValue === "number" ? integerValue : ""}
          onChange={(e) => {
            const nextValue = parseInt(e.currentTarget.value, 10);
            setValues((prev) => ({
              ...prev,
              [def.id]: nextValue,
            }));
            setSettingValue(def.id, nextValue);
          }}
        />
      );
    }
    return null;
  };

  const getSettingItemClass = (type: string) =>
    `${styles.settingItem} ${styles[`settingItem--${type}`]}`;
  const getSettingInfoClass = (type: string) =>
    `${styles.settingInfo} ${styles[`settingInfo--${type}`]}`;
  const getSettingLabelClass = (type: string) =>
    `${styles.settingLabel} ${styles[`settingLabel--${type}`]}`;
  const getSettingDescriptionClass = (type: string) =>
    `${styles.settingDescription} ${styles[`settingDescription--${type}`]}`;

  if (loading) {
    return <div class={styles.root}>Loading settings...</div>;
  }

  const groupedSettings = settings.reduce(
    (acc, def) => {
      const categoryId = def.category;
      const sectionKey = `${categoryId}:${def.subcategoryId}`;

      if (!acc[categoryId]) {
        acc[categoryId] = {};
      }
      if (!acc[categoryId][sectionKey]) {
        acc[categoryId][sectionKey] = {
          key: sectionKey,
          category: categoryId,
          subcategoryId: def.subcategoryId,
          subcategoryLabel: def.subcategoryLabel,
          subcategoryIcon: def.subcategoryIcon,
          defs: [],
        };
      }

      acc[categoryId][sectionKey].defs.push(def);
      return acc;
    },
    {} as Record<string, Record<string, SettingsSection>>,
  );

  const categoryIds = Object.keys(groupedSettings);
  const firstCategoryId = categoryIds[0];
  const defaultSectionKey = firstCategoryId
    ? Object.keys(groupedSettings[firstCategoryId])[0]
    : undefined;

  return (
    <div class={styles.root}>
      <div class={styles.header}>
        <h1>Settings</h1>
      </div>
      {categoryIds.length > 0 && defaultSectionKey ? (
        <ArkTabs.Root
          defaultValue={defaultSectionKey}
          lazyMount
          unmountOnExit
          className={styles.tabsRoot}
          orientation="vertical"
        >
          <ArkScrollArea.Root className={styles.scrollRoot}>
            <ArkScrollArea.Viewport className={styles.scrollViewport}>
              <ArkScrollArea.Content className={styles.scrollContent}>
                <ArkTabs.List className={styles.tabsList}>
                  {categoryIds.map((categoryId) => {
                    const sections = Object.values(groupedSettings[categoryId]);

                    return (
                      <div key={categoryId} className={styles.groupBlock}>
                        <div className={styles.groupTitle}>{categoryId}</div>
                        <div className={styles.groupTabs}>
                          {sections.map((section) => {
                            const Icon = getLucideIcon(section.subcategoryIcon);
                            return (
                              <ArkTabs.Trigger
                                key={section.key}
                                value={section.key}
                                className={styles.tabTrigger}
                              >
                                {Icon ? <Icon size={18} /> : null}
                                {section.subcategoryLabel}
                              </ArkTabs.Trigger>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  <ArkTabs.Indicator className={styles.tabIndicator} />
                </ArkTabs.List>
              </ArkScrollArea.Content>
            </ArkScrollArea.Viewport>
            <ArkScrollArea.Scrollbar
              className={styles.scrollbar}
              orientation="vertical"
            >
              <ArkScrollArea.Thumb className={styles.scrollThumb} />
            </ArkScrollArea.Scrollbar>
          </ArkScrollArea.Root>
          <ArkScrollArea.Root className={styles.scrollRoot} style={"flex-grow: 1;"}>
            <ArkScrollArea.Viewport className={styles.scrollViewport}>
              <ArkScrollArea.Content className={styles.scrollContent}>
                {categoryIds.map((categoryId) =>
                  Object.values(groupedSettings[categoryId]).map((section) => (
                    <ArkTabs.Content
                      key={section.key}
                      value={section.key}
                      className={styles.tabContent}
                    >
                      <div className={styles.settingsList}>
                        {section.defs.map((def) => (
                          <div
                            key={def.id}
                            className={getSettingItemClass(def.type)}
                          >
                            <div className={getSettingInfoClass(def.type)}>
                              <div className={getSettingLabelClass(def.type)}>
                                {def.label}
                              </div>
                              {def.description && (
                                <div
                                  className={getSettingDescriptionClass(
                                    def.type,
                                  )}
                                >
                                  {def.description}
                                </div>
                              )}
                            </div>
                            <div className={styles.settingControl}>
                              {renderSettingControl(def)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </ArkTabs.Content>
                  ))
                )}
              </ArkScrollArea.Content>
            </ArkScrollArea.Viewport>
            <ArkScrollArea.Scrollbar
              className={styles.scrollbar}
              orientation="vertical"
            >
              <ArkScrollArea.Thumb className={styles.scrollThumb} />
            </ArkScrollArea.Scrollbar>
          </ArkScrollArea.Root>
        </ArkTabs.Root>
      ) : (
        <div className={styles.emptyState}>No settings available.</div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "preact/hooks";
import { Dialog as ArkDialog } from "@ark-ui/react/dialog";
import { Portal } from "@ark-ui/react/portal";
import { ArrowLeftIcon, PlusIcon, SearchIcon } from "lucide-react";
import { type CommandItem, type CommandPalettePage } from "./model";
import { defaultCommandProviders, resolveCommands } from "./providers";
import styles from "./CommandPalette.module.css";

type Props = {
    open: boolean;
    initialPage: CommandPalettePage;
    onClose: () => void;
    onAddWidget: (type: "stock-chart") => void;
};

export function CommandPalette({
    open,
    initialPage,
    onClose,
    onAddWidget,
}: Props) {
    const [page, setPage] = useState<CommandPalettePage>(initialPage);
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);

    useEffect(() => {
        if (!open) return;
        setPage(initialPage);
        setQuery("");
        setActiveIndex(0);
    }, [open, initialPage]);

    const commandContext = useMemo(
        () => ({ availableWidgets: ["stock-chart"] as const }),
        [],
    );

    const { flat: commands, grouped } = useMemo(
        () =>
            resolveCommands(
                page,
                query,
                defaultCommandProviders,
                commandContext,
            ),
        [page, query, commandContext],
    );

    useEffect(() => {
        if (commands.length === 0) {
            setActiveIndex(0);
            return;
        }
        if (activeIndex >= commands.length) {
            setActiveIndex(commands.length - 1);
        }
    }, [commands, activeIndex]);

    const execute = (cmd: CommandItem | undefined) => {
        if (!cmd || !cmd.enabled) return;

        if (cmd.action.kind === "go-add-widget") {
            setPage("add-widget");
            setQuery("");
            setActiveIndex(0);
            return;
        }

        if (cmd.action.kind === "add-widget") {
            onAddWidget(cmd.action.widget);
            onClose();
        }
    };

    const handleBack = () => {
        if (page === "root") return;
        setPage("root");
        setQuery("");
        setActiveIndex(0);
    };

    const handleInputKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Backspace" && page !== "root" && query.length === 0) {
            e.preventDefault();
            handleBack();
            return;
        }

        if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((idx) => {
                if (commands.length === 0) return 0;
                return (idx + 1) % commands.length;
            });
            return;
        }

        if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((idx) => {
                if (commands.length === 0) return 0;
                return (idx - 1 + commands.length) % commands.length;
            });
            return;
        }

        if (e.key === "Enter") {
            e.preventDefault();
            execute(commands[activeIndex]);
        }
    };

    const title = page === "root" ? "" : "Add Widget";
    const inputPlaceholder =
        page === "root" ? "Search commands..." : "Search widgets...";

    return (
        <ArkDialog.Root
            open={open}
            onOpenChange={(d) => {
                if (!d.open) onClose();
            }}
        >
            <Portal>
                <ArkDialog.Backdrop className={styles.backdrop} />
                <ArkDialog.Positioner className={styles.positioner}>
                    <ArkDialog.Content className={styles.content}>
                        {page !== "root" && (
                            <div className={styles.header}>
                                <div className={styles.headerLeft}>
                                    <button
                                        type="button"
                                        className={styles.backButton}
                                        onClick={handleBack}
                                        aria-label="Back"
                                    >
                                        <ArrowLeftIcon />
                                    </button>
                                    {title && (
                                        <ArkDialog.Title
                                            className={styles.title}
                                        >
                                            {title}
                                        </ArkDialog.Title>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className={styles.searchRow}>
                            <SearchIcon className={styles.searchIcon} />
                            <input
                                type="text"
                                value={query}
                                onInput={(e) =>
                                    setQuery(
                                        (e.currentTarget as HTMLInputElement)
                                            .value,
                                    )
                                }
                                onKeyDown={(e) =>
                                    handleInputKeyDown(e as KeyboardEvent)
                                }
                                placeholder={inputPlaceholder}
                                className={styles.searchInput}
                                autoFocus
                            />
                            <span
                                className={`${styles.shortcutHint} ${styles.shortcutHintInline}`}
                            >
                                Esc
                            </span>
                        </div>

                        <div className={styles.list} role="listbox">
                            {commands.length === 0 ? (
                                <div className={styles.empty}>No results</div>
                            ) : (
                                (() => {
                                    let flatIndex = -1;
                                    return grouped.map((group) => (
                                        <div
                                            key={group.label}
                                            className={styles.group}
                                        >
                                            <div className={styles.groupLabel}>
                                                {group.label}
                                            </div>
                                            {group.items.map((cmd) => {
                                                flatIndex += 1;
                                                const index = flatIndex;
                                                return (
                                                    <button
                                                        key={cmd.id}
                                                        type="button"
                                                        className={styles.item}
                                                        data-active={
                                                            index ===
                                                            activeIndex
                                                        }
                                                        data-disabled={
                                                            !cmd.enabled
                                                        }
                                                        onMouseEnter={() =>
                                                            setActiveIndex(
                                                                index,
                                                            )
                                                        }
                                                        onClick={() =>
                                                            execute(cmd)
                                                        }
                                                        disabled={!cmd.enabled}
                                                    >
                                                        <span
                                                            className={
                                                                styles.itemMain
                                                            }
                                                        >
                                                            {cmd.label}
                                                        </span>
                                                        <span
                                                            className={
                                                                styles.itemMeta
                                                            }
                                                        >
                                                            {cmd.action.kind ===
                                                            "go-add-widget" ? (
                                                                <PlusIcon />
                                                            ) : (
                                                                cmd.hint
                                                            )}
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    ));
                                })()
                            )}
                        </div>
                    </ArkDialog.Content>
                </ArkDialog.Positioner>
            </Portal>
        </ArkDialog.Root>
    );
}

import {
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "preact/hooks";
import { Dialog as ArkDialog } from "@ark-ui/react/dialog";
import { Portal } from "@ark-ui/react/portal";
import { Badge } from "../Badge/Badge";
import {
    ArrowLeftIcon,
    GripVerticalIcon,
    PencilIcon,
    PlusIcon,
    SearchIcon,
    Trash2Icon,
} from "lucide-react";
import { Dialog } from "../Dialog/Dialog";
import { type CommandItem, type CommandPalettePage } from "./model";
import { defaultCommandProviders, resolveCommands } from "./providers";
import styles from "./CommandPalette.module.css";

type Props = {
    open: boolean;
    initialPage: CommandPalettePage;
    onClose: () => void;
    onAddWidget: (
        type:
            | "basic-chart"
            | "advanced-chart"
            | "economic-calendar"
            | "watchlist",
    ) => void;
    screens: Array<{ id: string; name: string }>;
    activeScreenId: string;
    onSetActiveScreen: (screenId: string) => void;
    onCreateScreen: (name?: string) => void;
    onRenameScreen: (screenId: string, name: string) => void;
    onDeleteScreen: (screenId: string) => Promise<boolean>;
    onReorderScreens: (nextIds: string[]) => void;
    onMoveScreen: (screenId: string, direction: -1 | 1) => void;
};

type ManageEntry =
    | { kind: "create"; id: "__create__" }
    | { kind: "screen"; id: string; name: string };

type ManageActionLane = "row" | "rename" | "delete";

function nextDefaultScreenName(records: Array<{ name: string }>): string {
    const max = records.reduce((acc, rec) => {
        const m = rec.name.match(/^Screen\s+(\d+)$/i);
        if (!m) return acc;
        return Math.max(acc, Number(m[1]));
    }, 0);
    return `Screen ${max + 1}`;
}

function reorderBefore(
    ids: string[],
    draggedId: string,
    targetId: string,
): string[] {
    if (draggedId === targetId) return ids;
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return ids;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
}

export function CommandPalette({
    open,
    initialPage,
    onClose,
    onAddWidget,
    screens,
    activeScreenId,
    onSetActiveScreen,
    onCreateScreen,
    onRenameScreen,
    onDeleteScreen,
    onReorderScreens,
    onMoveScreen,
}: Props) {
    const [page, setPage] = useState<CommandPalettePage>(initialPage);
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    const [targetScreenId, setTargetScreenId] = useState("");
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [draggedScreenId, setDraggedScreenId] = useState("");
    const [manageLane, setManageLane] = useState<ManageActionLane>("row");
    const cancelDeleteRef = useRef<HTMLButtonElement>(null);
    const confirmDeleteRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) return;
        setPage(initialPage);
        setQuery("");
        setActiveIndex(0);
        setTargetScreenId("");
        setDeleteConfirmOpen(false);
        setDraggedScreenId("");
        setManageLane("row");
    }, [open, initialPage]);

    useLayoutEffect(() => {
        if (!deleteConfirmOpen) return;
        cancelDeleteRef.current?.focus();
        const id = window.setTimeout(() => {
            cancelDeleteRef.current?.focus();
        }, 0);
        return () => window.clearTimeout(id);
    }, [deleteConfirmOpen]);

    const commandContext = useMemo(
        () => ({
            availableWidgets: [
                "basic-chart",
                "advanced-chart",
                "economic-calendar",
                "watchlist",
            ] as const,
            screens,
            activeScreenId,
        }),
        [screens, activeScreenId],
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
        if (!(page === "root" || page === "add-widget")) return;
        if (commands.length === 0) {
            setActiveIndex(0);
            return;
        }
        if (activeIndex >= commands.length) {
            setActiveIndex(commands.length - 1);
        }
    }, [page, commands, activeIndex]);

    const execute = (cmd: CommandItem | undefined) => {
        if (!cmd || !cmd.enabled) return;

        if (cmd.action.kind === "go-add-widget") {
            setPage("add-widget");
            setQuery("");
            setActiveIndex(0);
            return;
        }

        if (cmd.action.kind === "go-manage-screens") {
            setPage("manage-screens");
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

        if (["create-screen", "rename-screen"].includes(page)) {
            setPage("manage-screens");
            setQuery("");
            setActiveIndex(0);
            setTargetScreenId("");
            return;
        }

        setPage("root");
        setQuery("");
        setActiveIndex(0);
        setTargetScreenId("");
    };

    const selectedScreen = screens.find((s) => s.id === targetScreenId);

    const filteredScreens = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return screens;
        return screens.filter((s) => s.name.toLowerCase().includes(q));
    }, [screens, query]);

    const manageEntries = useMemo<ManageEntry[]>(() => {
        return [
            { kind: "create", id: "__create__" },
            ...filteredScreens.map((s) => ({
                kind: "screen" as const,
                id: s.id,
                name: s.name,
            })),
        ];
    }, [filteredScreens]);

    useEffect(() => {
        if (page !== "manage-screens") return;
        if (manageEntries.length === 0) {
            setActiveIndex(0);
            setManageLane("row");
            return;
        }
        if (activeIndex >= manageEntries.length) {
            setActiveIndex(manageEntries.length - 1);
        }
    }, [page, manageEntries, activeIndex]);

    const beginCreateScreen = () => {
        setPage("create-screen");
        setQuery(nextDefaultScreenName(screens));
        setActiveIndex(0);
        setManageLane("row");
    };

    const beginRenameScreen = (screenId?: string) => {
        const resolved = screenId || activeScreenId || "";
        if (!resolved) {
            setPage("manage-screens");
            return;
        }
        const target = screens.find((s) => s.id === resolved);
        setTargetScreenId(resolved);
        setPage("rename-screen");
        setQuery(target?.name ?? "");
        setActiveIndex(0);
        setManageLane("row");
    };

    const beginDeleteScreen = (screenId?: string) => {
        const resolved = screenId || activeScreenId || "";
        if (!resolved) {
            setPage("manage-screens");
            return;
        }
        (document.activeElement as HTMLElement | null)?.blur();
        setTargetScreenId(resolved);
        setDeleteConfirmOpen(true);
        setManageLane("row");
    };

    const submitCreateScreen = () => {
        const name = query.trim();
        onCreateScreen(name || undefined);
        setPage("manage-screens");
        setQuery("");
        setActiveIndex(0);
        setManageLane("row");
    };

    const submitRenameScreen = () => {
        if (!targetScreenId) return;
        const name = query.trim();
        if (!name) return;
        onRenameScreen(targetScreenId, name);
        setPage("manage-screens");
        setTargetScreenId("");
        setQuery("");
        setActiveIndex(0);
        setManageLane("row");
    };

    const confirmDeleteScreen = async () => {
        if (!targetScreenId) return;
        const ok = await onDeleteScreen(targetScreenId);
        if (ok) {
            setDeleteConfirmOpen(false);
            setTargetScreenId("");
            setManageLane("row");
        }
    };

    const handleDeleteDialogKeyDown = (e: KeyboardEvent) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            const active = document.activeElement;
            if (active === cancelDeleteRef.current) {
                confirmDeleteRef.current?.focus();
            } else {
                cancelDeleteRef.current?.focus();
            }
            return;
        }

        if (e.key === "Home") {
            e.preventDefault();
            cancelDeleteRef.current?.focus();
            return;
        }

        if (e.key === "End") {
            e.preventDefault();
            confirmDeleteRef.current?.focus();
        }
    };

    const handleDropOnScreen = (targetId: string) => {
        if (!draggedScreenId || draggedScreenId === targetId) return;
        const ids = screens.map((s) => s.id);
        const next = reorderBefore(ids, draggedScreenId, targetId);
        onReorderScreens(next);
        setDraggedScreenId("");
    };

    const handleInputKeyDown = (e: KeyboardEvent) => {
        if (page === "create-screen") {
            if (e.key === "Enter") {
                e.preventDefault();
                submitCreateScreen();
            }
            return;
        }

        if (page === "rename-screen") {
            if (e.key === "Enter") {
                e.preventDefault();
                submitRenameScreen();
            }
            return;
        }

        if (page === "manage-screens") {
            const entry = manageEntries[activeIndex];

            if (e.key === "Backspace" && query.length === 0) {
                e.preventDefault();
                handleBack();
                return;
            }

            if (
                (e.ctrlKey || e.metaKey) &&
                (e.key === "ArrowUp" || e.key === "ArrowDown")
            ) {
                e.preventDefault();
                if (entry?.kind === "screen") {
                    const direction = e.key === "ArrowUp" ? -1 : 1;

                    // Keep keyboard focus/index on the moved row so users can
                    // repeatedly press Ctrl/Cmd+Arrow to send a screen to top/bottom.
                    setActiveIndex((idx) => {
                        const next = idx + direction;
                        if (next < 1 || next >= manageEntries.length)
                            return idx;
                        return next;
                    });

                    onMoveScreen(entry.id, direction);
                }
                return;
            }

            if (e.key === "ArrowRight") {
                if (entry?.kind === "screen") {
                    e.preventDefault();
                    setManageLane((lane) => {
                        if (lane === "row") return "rename";
                        if (lane === "rename") return "delete";
                        return "delete";
                    });
                }
                return;
            }

            if (e.key === "ArrowLeft") {
                if (entry?.kind === "screen") {
                    e.preventDefault();
                    setManageLane((lane) => {
                        if (lane === "delete") return "rename";
                        if (lane === "rename") return "row";
                        return "row";
                    });
                }
                return;
            }

            if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex(
                    (idx) => (idx + 1) % Math.max(1, manageEntries.length),
                );
                setManageLane("row");
                return;
            }

            if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex(
                    (idx) =>
                        (idx - 1 + Math.max(1, manageEntries.length)) %
                        Math.max(1, manageEntries.length),
                );
                setManageLane("row");
                return;
            }

            if (e.key === "Enter") {
                e.preventDefault();
                if (!entry) return;
                if (entry.kind === "create") {
                    beginCreateScreen();
                } else {
                    if (manageLane === "rename") {
                        beginRenameScreen(entry.id);
                    } else if (manageLane === "delete") {
                        beginDeleteScreen(entry.id);
                    } else {
                        onSetActiveScreen(entry.id);
                    }
                }
            }
            return;
        }

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

    const title =
        page === "add-widget"
            ? "Add Widget"
            : page === "manage-screens"
              ? "Manage Screens"
              : page === "create-screen"
                ? "Create Screen"
                : page === "rename-screen"
                  ? "Rename Screen"
                  : "";
    const inputPlaceholder =
        page === "root"
            ? "Search commands..."
            : page === "add-widget"
              ? "Search widgets..."
              : page === "manage-screens"
                ? "Filter screens..."
                : page === "create-screen"
                  ? "Enter screen name"
                  : page === "rename-screen"
                    ? "Enter new screen name"
                    : "Search...";

    const showHeader = page !== "root";
    const showCommandList = page === "root" || page === "add-widget";
    const showManageScreens = page === "manage-screens";
    const deleteBlocked = screens.length <= 1;
    const paletteSuspended = deleteConfirmOpen;

    return (
        <ArkDialog.Root
            open={open && !paletteSuspended}
            onOpenChange={(d) => {
                if (!d.open && !paletteSuspended) onClose();
            }}
        >
            <Portal>
                <ArkDialog.Backdrop className={styles.backdrop} />
                <ArkDialog.Positioner className={styles.positioner}>
                    <ArkDialog.Content className={styles.content}>
                        {showHeader && (
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

                        {showManageScreens && (
                            <div className={styles.list} role="listbox">
                                {manageEntries.map((entry, index) => {
                                    if (entry.kind === "create") {
                                        return (
                                            <button
                                                key={entry.id}
                                                type="button"
                                                className={styles.item}
                                                data-active={
                                                    index === activeIndex
                                                }
                                                onMouseEnter={() =>
                                                    setActiveIndex(index)
                                                }
                                                onClick={beginCreateScreen}
                                            >
                                                <span
                                                    className={styles.itemMain}
                                                >
                                                    Create Screen
                                                </span>
                                                <span
                                                    className={styles.itemMeta}
                                                >
                                                    <PlusIcon />
                                                </span>
                                            </button>
                                        );
                                    }

                                    const isActive =
                                        entry.id === activeScreenId;
                                    const isDragged =
                                        entry.id === draggedScreenId;
                                    return (
                                        <div
                                            key={entry.id}
                                            className={styles.manageRow}
                                            data-active={index === activeIndex}
                                            onDragOver={(evt) =>
                                                evt.preventDefault()
                                            }
                                            onDrop={() =>
                                                handleDropOnScreen(entry.id)
                                            }
                                            onMouseEnter={() =>
                                                setActiveIndex(index)
                                            }
                                        >
                                            <button
                                                type="button"
                                                className={styles.dragHandle}
                                                aria-label={`Reorder ${entry.name}`}
                                                aria-grabbed={isDragged}
                                                draggable
                                                onDragStart={() =>
                                                    setDraggedScreenId(entry.id)
                                                }
                                                onDragEnd={() =>
                                                    setDraggedScreenId("")
                                                }
                                            >
                                                <GripVerticalIcon />
                                            </button>
                                            <button
                                                type="button"
                                                className={styles.manageName}
                                                data-lane-active={
                                                    index === activeIndex &&
                                                    manageLane === "row"
                                                }
                                                onClick={() =>
                                                    onSetActiveScreen(entry.id)
                                                }
                                            >
                                                <span>{entry.name}</span>
                                                {isActive && (
                                                    <span
                                                        className={
                                                            styles.activeChip
                                                        }
                                                    >
                                                        Active
                                                    </span>
                                                )}
                                            </button>
                                            <div
                                                className={styles.manageActions}
                                            >
                                                <button
                                                    type="button"
                                                    className={styles.rowAction}
                                                    data-lane-active={
                                                        index === activeIndex &&
                                                        manageLane === "rename"
                                                    }
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        beginRenameScreen(
                                                            entry.id,
                                                        );
                                                    }}
                                                    aria-label={`Rename ${entry.name}`}
                                                >
                                                    <PencilIcon />
                                                </button>
                                                <button
                                                    type="button"
                                                    className={styles.rowAction}
                                                    data-lane-active={
                                                        index === activeIndex &&
                                                        manageLane === "delete"
                                                    }
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        beginDeleteScreen(
                                                            entry.id,
                                                        );
                                                    }}
                                                    aria-label={`Delete ${entry.name}`}
                                                    disabled={deleteBlocked}
                                                >
                                                    <Trash2Icon />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {showCommandList && (
                            <div className={styles.list} role="listbox">
                                {commands.length === 0 ? (
                                    <div className={styles.empty}>
                                        No results
                                    </div>
                                ) : (
                                    (() => {
                                        let flatIndex = -1;
                                        return grouped.map((group) => (
                                            <div
                                                key={group.label}
                                                className={styles.group}
                                            >
                                                <div
                                                    className={
                                                        styles.groupLabel
                                                    }
                                                >
                                                    {group.label}
                                                </div>
                                                {group.items.map((cmd) => {
                                                    flatIndex += 1;
                                                    const index = flatIndex;
                                                    return (
                                                        <button
                                                            key={cmd.id}
                                                            type="button"
                                                            className={
                                                                styles.item
                                                            }
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
                                                            disabled={
                                                                !cmd.enabled
                                                            }
                                                        >
                                                            <span
                                                                className={
                                                                    styles.itemMain
                                                                }
                                                            >
                                                                <span
                                                                    className={
                                                                        styles.itemTitle
                                                                    }
                                                                >
                                                                    {cmd.label}
                                                                </span>
                                                                {cmd.badge && (
                                                                    <Badge
                                                                        variant={
                                                                            cmd.badge ===
                                                                            "LIMA Bridge"
                                                                                ? "accent"
                                                                                : cmd.badge ===
                                                                                    "TradingView"
                                                                                  ? "blue-subtle"
                                                                                  : "muted"
                                                                        }
                                                                        children={
                                                                            cmd.badge
                                                                        }
                                                                    ></Badge>
                                                                )}
                                                            </span>
                                                            <span
                                                                className={
                                                                    styles.itemMeta
                                                                }
                                                            >
                                                                {cmd.hint}
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        ));
                                    })()
                                )}
                            </div>
                        )}
                    </ArkDialog.Content>
                </ArkDialog.Positioner>
            </Portal>

            <Dialog
                open={deleteConfirmOpen}
                onClose={() => setDeleteConfirmOpen(false)}
                title="Delete screen?"
                description="Use Left/Right arrows to switch actions, then press Enter to confirm."
                showCloseButton={false}
            >
                <div
                    className={styles.confirmBody}
                    role="group"
                    aria-label="Delete screen confirmation"
                    onKeyDown={(e) =>
                        handleDeleteDialogKeyDown(e as KeyboardEvent)
                    }
                >
                    <p className={styles.confirmText}>
                        This will permanently remove
                        {selectedScreen
                            ? ` ${selectedScreen.name}`
                            : " this screen"}
                        .
                    </p>
                    <div className={styles.confirmActions}>
                        <button
                            type="button"
                            className={styles.secondaryBtn}
                            autoFocus
                            ref={cancelDeleteRef}
                            onClick={() => setDeleteConfirmOpen(false)}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            className={styles.dangerBtn}
                            ref={confirmDeleteRef}
                            onClick={() => void confirmDeleteScreen()}
                        >
                            Delete
                        </button>
                    </div>
                </div>
            </Dialog>
        </ArkDialog.Root>
    );
}

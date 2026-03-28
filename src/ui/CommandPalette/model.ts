export type CommandPalettePage =
    | "root"
    | "add-widget"
    | "manage-screens"
    | "create-screen"
    | "rename-screen";

export type CommandAction =
    | { kind: "go-add-widget" }
    | { kind: "go-manage-screens" }
    | { kind: "add-widget"; widget: "stock-chart" }
    | { kind: "placeholder" };

export type CommandItem = {
    id: string;
    label: string;
    badge?: string;
    hint?: string;
    keywords: string[];
    enabled: boolean;
    section?: string;
    action: CommandAction;
};

export type CommandContext = {
    availableWidgets: ReadonlyArray<"stock-chart">;
    screens: ReadonlyArray<{ id: string; name: string }>;
    activeScreenId: string;
};

export type GroupedCommands = {
    label: string;
    items: CommandItem[];
};

export type CommandProvider = {
    id: string;
    getCommands: (
        page: CommandPalettePage,
        ctx: CommandContext,
    ) => CommandItem[];
};

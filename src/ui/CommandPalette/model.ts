export type CommandPalettePage = "root" | "add-widget";

export type CommandAction =
    | { kind: "go-add-widget" }
    | { kind: "add-widget"; widget: "stock-chart" }
    | { kind: "placeholder" };

export type CommandItem = {
    id: string;
    label: string;
    hint?: string;
    keywords: string[];
    enabled: boolean;
    section?: string;
    action: CommandAction;
};

export type CommandContext = {
    availableWidgets: ReadonlyArray<"stock-chart">;
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

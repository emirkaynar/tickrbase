import type {
    CommandContext,
    CommandItem,
    CommandPalettePage,
    CommandProvider,
    GroupedCommands,
} from "./model";

export const coreProvider: CommandProvider = {
    id: "core",
    getCommands(page) {
        if (page !== "root") return [];
        return [
            {
                id: "root-add-widget",
                label: "Add Widget",
                hint: "Add new widget to the screen",
                keywords: ["add", "widget", "chart"],
                enabled: true,
                section: "Actions",
                action: { kind: "go-add-widget" },
            },
            {
                id: "root-manage-screens",
                label: "Manage Screens",
                hint: "Create, rename, reorder and delete screens",
                keywords: ["manage", "screen", "rename", "delete", "order"],
                enabled: true,
                section: "Actions",
                action: { kind: "go-manage-screens" },
            },
        ];
    },
};

export const widgetProvider: CommandProvider = {
    id: "widgets",
    getCommands(page) {
        if (page !== "add-widget") return [];
        return [
            {
                id: "widget-stock-chart",
                label: "Stock Chart",
                hint: "Add market chart widget",
                keywords: ["stock", "chart", "widget", "candlestick"],
                enabled: true,
                section: "Widgets",
                action: { kind: "add-widget", widget: "stock-chart" },
            },
        ];
    },
};

export const defaultCommandProviders: CommandProvider[] = [
    coreProvider,
    widgetProvider,
];

function filterCommands(commands: CommandItem[], query: string): CommandItem[] {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((item) => {
        if (item.label.toLowerCase().includes(q)) return true;
        if ((item.hint ?? "").toLowerCase().includes(q)) return true;
        return item.keywords.some((k) => k.includes(q));
    });
}

export function resolveCommands(
    page: CommandPalettePage,
    query: string,
    providers: CommandProvider[],
    ctx: CommandContext,
): { flat: CommandItem[]; grouped: GroupedCommands[] } {
    const merged = providers.flatMap((provider) =>
        provider.getCommands(page, ctx),
    );
    const filtered = filterCommands(merged, query);

    const sectionMap = new Map<string, CommandItem[]>();
    for (const command of filtered) {
        const key = command.section || "General";
        if (!sectionMap.has(key)) sectionMap.set(key, []);
        sectionMap.get(key)!.push(command);
    }

    const grouped: GroupedCommands[] = [...sectionMap.entries()].map(
        ([label, items]) => ({ label, items }),
    );

    return { flat: filtered, grouped };
}

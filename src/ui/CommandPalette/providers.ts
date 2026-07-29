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
                id: "widget-symbol-overview",
                label: "Symbol Overview",
                badge: "Yahoo Finance",
                hint: "Overview of a specific stock symbol",
                keywords: ["symbol", "overview", "stock", "stats"],
                enabled: true,
                section: "Overview",
                action: { kind: "add-widget", widget: "symbol-overview" },
            },
            {
                id: "widget-basic-chart",
                label: "Basic Chart",
                badge: "Yahoo Finance",
                hint: "Basic stock chart",
                keywords: ["stock", "chart", "widget", "candlestick"],
                enabled: true,
                section: "Charts",
                action: { kind: "add-widget", widget: "basic-chart" },
            },
            {
                id: "widget-advanced-chart",
                label: "Advanced Chart",
                badge: "TradingView",
                hint: "Advanced chart widget with more features",
                keywords: ["advanced", "chart", "widget", "tradingview"],
                enabled: true,
                section: "Charts",
                action: { kind: "add-widget", widget: "advanced-chart" },
            },
            {
                id: "widget-economic-calendar",
                label: "Economic Calendar",
                badge: "TradingView",
                hint: "Economic calendar with upcoming events and news",
                keywords: ["economic", "calendar", "widget", "tradingview"],
                enabled: true,
                section: "Economic",
                action: { kind: "add-widget", widget: "economic-calendar" },
            },
            {
                id: "widget-watchlist",
                label: "Lists",
                badge: "Yahoo Finance",
                hint: "Track symbols in named lists with groups",
                keywords: ["lists", "watchlist", "symbols", "table"],
                enabled: true,
                section: "Watch",
                action: { kind: "add-widget", widget: "watchlist" },
            },
            {
                id: "widget-technical-analysis",
                label: "Technical Analysis",
                badge: "TradingView",
                hint: "Technical analysis tools and indicators",
                keywords: ["technical", "analysis", "widget", "tradingview"],
                enabled: false,
                section: "Technical",
                action: { kind: "placeholder" },
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

export function DividendsTab() {
    return (
        <div
            style={{
                padding: "32px 24px",
                textAlign: "center",
                background: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: "var(--radius-md)",
            }}
        >
            <h3 style={{ margin: "0 0 8px 0", color: "var(--color-text)" }}>
                📅 Dividend Tracker & Income Calendar
            </h3>
            <p style={{ color: "var(--color-text-muted)", fontSize: "14px", margin: 0 }}>
                Upcoming ex-dividend dates, payment schedule, and projected annual cash flow coming in Phase 4.
            </p>
        </div>
    );
}

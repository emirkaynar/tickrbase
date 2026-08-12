import { useState } from "preact/hooks";
import { Button, Dialog, Input, Select } from "../../../ui";
import { createPortfolio } from "../../../services/portfolio";
import type { PortfolioSummary } from "../../../services/types";
import { ALL_CURRENCY_OPTIONS } from "../../../utils/currency";

interface Props {
    open: boolean;
    onClose: () => void;
    onCreated: (portfolio: PortfolioSummary) => void;
}

export function CreatePortfolioModal({ open, onClose, onCreated }: Props) {
    const [name, setName] = useState("");
    const [baseCurrency, setBaseCurrency] = useState("TRY");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (e: Event) => {
        e.preventDefault();
        if (!name.trim()) {
            setError("Portfolio name is required.");
            return;
        }

        try {
            setLoading(true);
            setError("");
            const created = await createPortfolio({
                name: name.trim(),
                base_currency: baseCurrency,
                is_default: false,
            });
            setName("");
            onCreated(created);
            onClose();
        } catch (err: any) {
            setError(err?.message || "Failed to create portfolio.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title="Create New Portfolio"
            description="Add a new portfolio to separate your investments (e.g. BIST Growth, US Tech, Dividend Core)."
        >
            <form
                onSubmit={handleSubmit}
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "16px",
                }}
            >
                {error && (
                    <div
                        style={{ color: "var(--color-bear)", fontSize: "13px" }}
                    >
                        {error}
                    </div>
                )}

                <div>
                    <label
                        style={{
                            display: "block",
                            marginBottom: "6px",
                            fontSize: "13px",
                            fontWeight: 500,
                        }}
                    >
                        Portfolio Name
                    </label>
                    <Input
                        placeholder="e.g. BIST Growth"
                        value={name}
                        onChange={setName}
                    />
                </div>

                <div>
                    <label
                        style={{
                            display: "block",
                            marginBottom: "6px",
                            fontSize: "13px",
                            fontWeight: 500,
                        }}
                    >
                        Base Currency
                    </label>
                    <Select
                        items={ALL_CURRENCY_OPTIONS}
                        value={baseCurrency}
                        onChange={setBaseCurrency}
                    />
                </div>

                <div
                    style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: "8px",
                        marginTop: "8px",
                    }}
                >
                    <Button variant="ghost" onClick={onClose} type="button">
                        Cancel
                    </Button>
                    <Button variant="ghost" type="submit" disabled={loading}>
                        {loading ? "Creating..." : "Create Portfolio"}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
}

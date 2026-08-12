import { useEffect, useMemo, useState } from "preact/hooks";
import { Button, DateTimeInput, Dialog, Input, Select, TickerSelector } from "../../../ui";
import { addTransaction, updateTransaction } from "../../../services/portfolio";
import { fetchQuotes } from "../../../services/quotes";
import type {
    PortfolioSummary,
    TransactionResponse,
    TransactionType,
} from "../../../services/types";
import { resolveCurrency } from "../../../utils";

interface Props {
    open: boolean;
    onClose: () => void;
    portfolios: PortfolioSummary[];
    activePortfolioId: string;
    /** When provided, the modal operates in edit mode and calls PUT instead of POST. */
    initialTransaction?: TransactionResponse | null;
    onSaved: (tx: TransactionResponse) => void;
}


function round4(val: number): number {
    return Math.round((val + Number.EPSILON) * 10000) / 10000;
}

export function TradeTransactionModal({
    open,
    onClose,
    portfolios,
    activePortfolioId,
    initialTransaction,
    onSaved,
}: Props) {
    const isEditMode = !!initialTransaction;

    const defaultPortId =
        activePortfolioId !== "all"
            ? activePortfolioId
            : portfolios[0]?.id || "";

    const [portfolioId, setPortfolioId] = useState(
        initialTransaction?.portfolio_id ?? defaultPortId,
    );

    // Sync portfolioId when modal opens or portfolios array populates asynchronously
    useEffect(() => {
        if (open) {
            if (initialTransaction) {
                setPortfolioId(initialTransaction.portfolio_id);
            } else if (!portfolioId || !portfolios.some((p) => p.id === portfolioId)) {
                const fallback = activePortfolioId !== "all" && activePortfolioId ? activePortfolioId : portfolios[0]?.id || "";
                setPortfolioId(fallback);
            }
        }
    }, [open, portfolios, activePortfolioId, initialTransaction?.id]);

    const [txType, setTxType] = useState<TransactionType>(
        initialTransaction?.type ?? "BUY",
    );
    const [ticker, setTicker] = useState(initialTransaction?.ticker ?? "");
    const [quantity, setQuantity] = useState(
        initialTransaction ? String(round4(initialTransaction.quantity)) : "",
    );
    const [unitPrice, setUnitPrice] = useState(
        initialTransaction ? String(round4(initialTransaction.unit_price)) : "",
    );
    const [fee, setFee] = useState(
        initialTransaction ? String(round4(initialTransaction.fee)) : "",
    );
    const [executedAt, setExecutedAt] = useState<number>(
        initialTransaction?.executed_at
            ? (initialTransaction.executed_at > 1e11
                  ? initialTransaction.executed_at
                  : initialTransaction.executed_at * 1000)
            : Date.now(),
    );
    const [notes, setNotes] = useState(initialTransaction?.notes ?? "");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const [fetchedCurrency, setFetchedCurrency] = useState<string | null>(null);

    const detectedCurrencyConfig = useMemo(
        () => resolveCurrency(fetchedCurrency || initialTransaction?.currency, ticker),
        [ticker, fetchedCurrency, initialTransaction?.currency],
    );

    // Fetch official native currency & current price directly from yfinance quote API
    useEffect(() => {
        if (!ticker || ticker.trim().length < 2) return;
        const controller = new AbortController();
        const cleaned = ticker.trim().toUpperCase();

        fetchQuotes([cleaned], ["session"], controller.signal)
            .then((res) => {
                if (res.quotes && res.quotes.length > 0) {
                    const q = res.quotes[0];
                    if (q.currency) {
                        setFetchedCurrency(q.currency);
                    }
                    if (q.current_price != null && !isEditMode) {
                        setUnitPrice(String(round4(q.current_price)));
                    }
                }
            })
            .catch(() => {
                // Ignore abort or network errors
            });

        return () => controller.abort();
    }, [ticker, isEditMode]);

    // Reset when a new initialTransaction is passed in
    useEffect(() => {
        if (initialTransaction) {
            setPortfolioId(initialTransaction.portfolio_id);
            setTxType(initialTransaction.type);
            setTicker(initialTransaction.ticker);
            setQuantity(String(round4(initialTransaction.quantity)));
            setUnitPrice(String(round4(initialTransaction.unit_price)));
            setFee(String(round4(initialTransaction.fee)));
            setFetchedCurrency(initialTransaction.currency);
            setExecutedAt(
                initialTransaction.executed_at > 1e11
                    ? initialTransaction.executed_at
                    : initialTransaction.executed_at * 1000,
            );
            setNotes(initialTransaction.notes ?? "");
        }
    }, [initialTransaction?.id]);

    const portfolioOptions = portfolios.map((p) => ({
        label: p.name,
        value: p.id,
    }));

    const handleSubmit = async (e: Event) => {
        e.preventDefault();
        setError("");

        if (!portfolioId || !portfolioId.trim()) {
            setError("Please select a target portfolio.");
            return;
        }

        if (!ticker.trim()) {
            setError("Symbol / Ticker is required.");
            return;
        }

        const qtyParsed = parseFloat(quantity);
        if (isNaN(qtyParsed) || qtyParsed <= 0) {
            setError("Quantity must be greater than zero.");
            return;
        }
        const qtyNum = round4(qtyParsed);

        const priceParsed = parseFloat(unitPrice);
        if (isNaN(priceParsed) || priceParsed < 0) {
            setError("Unit price cannot be negative.");
            return;
        }
        const priceNum = round4(priceParsed);

        const feeParsed = parseFloat(fee) || 0;
        if (feeParsed < 0) {
            setError("Fee cannot be negative.");
            return;
        }
        const feeNum = round4(feeParsed);

        if (executedAt > Date.now() + 300000) {
            setError("Execution date cannot be in the future.");
            return;
        }

        // Convert ms → seconds for backend
        const executedAtSec = executedAt > 1e11 ? Math.floor(executedAt / 1000) : executedAt;

        const payload = {
            portfolio_id: portfolioId,
            ticker: ticker.trim().toUpperCase(),
            type: txType,
            quantity: qtyNum,
            unit_price: priceNum,
            fee: feeNum,
            currency: detectedCurrencyConfig.code,
            executed_at: executedAtSec,
            notes: notes.trim() || undefined,
        };

        try {
            setLoading(true);
            setError("");
            let res: TransactionResponse;
            if (isEditMode && initialTransaction) {
                res = await updateTransaction(initialTransaction.id, payload);
            } else {
                res = await addTransaction(payload);
            }
            onSaved(res);
            onClose();
        } catch (err: any) {
            const detailMsg = err?.response?.data?.detail || err?.detail || err?.message || "Failed to record transaction.";
            setError(detailMsg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={isEditMode ? "Edit Transaction" : "Record Trade / Transaction"}
            description={
                isEditMode
                    ? "Update the details of this transaction."
                    : "Add an order execution (Buy, Sell, Dividend, Fee) to your portfolio ledger."
            }
        >
            <form
                onSubmit={handleSubmit}
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "14px",
                }}
            >
                {error && (
                    <div
                        style={{
                            padding: "8px 12px",
                            borderRadius: "var(--radius-sm)",
                            background: "color-mix(in srgb, var(--color-bear) 12%, transparent)",
                            border: "1px solid var(--color-bear)",
                            color: "var(--color-bear)",
                            fontSize: "13px",
                            fontWeight: 500,
                        }}
                    >
                        ⚠️ {error}
                    </div>
                )}

                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "12px",
                    }}
                >
                    <div>
                        <label
                            style={{
                                display: "block",
                                marginBottom: "6px",
                                fontSize: "13px",
                                fontWeight: 500,
                            }}
                        >
                            Transaction Type
                        </label>
                        <Select
                            items={[
                                { label: "🟢 BUY", value: "BUY" },
                                { label: "🔴 SELL", value: "SELL" },
                                { label: "💵 DIVIDEND", value: "DIVIDEND" },
                                { label: "📥 DEPOSIT", value: "DEPOSIT" },
                                { label: "📤 WITHDRAWAL", value: "WITHDRAWAL" },
                                { label: "💸 FEE / TAX", value: "FEE" },
                            ]}
                            value={txType}
                            onChange={(val) =>
                                setTxType(val as TransactionType)
                            }
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
                            Portfolio
                        </label>
                        <Select
                            items={portfolioOptions}
                            value={portfolioId}
                            onChange={setPortfolioId}
                        />
                    </div>
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
                        Symbol / Ticker
                    </label>
                    <TickerSelector
                        value={ticker}
                        onChange={(val) => {
                            setTicker(val);
                            setError("");
                        }}
                        placeholder="Search e.g. THYAO.IS, AAPL..."
                    />
                </div>

                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr 1fr",
                        gap: "12px",
                    }}
                >
                    <div>
                        <label
                            style={{
                                display: "block",
                                marginBottom: "6px",
                                fontSize: "13px",
                                fontWeight: 500,
                            }}
                        >
                            Quantity
                        </label>
                        <Input
                            type="number"
                            step="any"
                            placeholder="e.g. 100 or 12.5"
                            value={quantity}
                            onChange={setQuantity}
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
                            Unit Price ({detectedCurrencyConfig.symbol})
                        </label>
                        <Input
                            type="number"
                            step="any"
                            placeholder={`e.g. 329.87 ${detectedCurrencyConfig.symbol}`}
                            value={unitPrice}
                            onChange={setUnitPrice}
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
                            Fee ({detectedCurrencyConfig.symbol})
                        </label>
                        <Input
                            type="number"
                            step="any"
                            placeholder="e.g. 5.00"
                            value={fee}
                            onChange={setFee}
                        />
                    </div>
                </div>

                <div>
                    <DateTimeInput
                        label="Execution Date & Time"
                        value={executedAt}
                        onChange={setExecutedAt}
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
                        Notes / Strategy Memo (Optional)
                    </label>
                    <Input
                        placeholder="e.g. Bought after strong Q2 earnings report"
                        value={notes}
                        onChange={setNotes}
                    />
                </div>

                <div
                    style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: "8px",
                        marginTop: "12px",
                    }}
                >
                    <Button variant="ghost" onClick={onClose} type="button">
                        Cancel
                    </Button>
                    <Button variant="solid" type="submit" disabled={loading}>
                        {loading
                            ? isEditMode
                                ? "Saving..."
                                : "Recording..."
                            : isEditMode
                              ? "Save Changes"
                              : "Record Transaction"}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
}

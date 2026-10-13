import { Loader2Icon, RefreshCw, X } from "lucide-react";
import { Tooltip } from "../Tooltip/Tooltip";
import styles from "./AsyncStatusIndicator.module.css";

export type AsyncStatusIndicatorState = "idle" | "pending" | "busy" | "error";

export type AsyncStatusIndicatorProps = {
  state: AsyncStatusIndicatorState;
  message: string;
  retryLabel?: string;
  onRetry?: () => void;
  className?: string;
};

export function AsyncStatusIndicator({
  state,
  message,
  retryLabel = "Retry",
  onRetry,
  className,
}: AsyncStatusIndicatorProps) {
  const canRetry = state === "error" && Boolean(onRetry);
  const description = canRetry ? `${message} ${retryLabel}.` : message;

  return (
    <span
      className={`${styles.slot}${className ? ` ${className}` : ""}`}
      data-state={state}
      data-retry={canRetry}
      aria-hidden={state === "idle" ? true : undefined}
    >
      <span className={styles.icons} aria-hidden="true">
        <span className={`${styles.layer} ${styles.loading}`}>
          <Loader2Icon size={14} className={styles.spinner} />
        </span>
        <span className={`${styles.layer} ${styles.error}`}>
          <X size={14} />
        </span>
        <span className={`${styles.layer} ${styles.retryIcon}`}>
          <RefreshCw size={14} />
        </span>
      </span>
      {state !== "idle" && (
        <Tooltip
          content={<span className={styles.tooltipMessage}>{description}</span>}
          variant="long"
        >
          {canRetry ? (
            <button
              type="button"
              className={`${styles.trigger} ${styles.retry}`}
              aria-label={description}
              onClick={() => {
                if (state === "error") onRetry?.();
              }}
            />
          ) : (
            <span
              className={styles.trigger}
              role="img"
              aria-label={message}
              tabIndex={state === "error" ? 0 : undefined}
            />
          )}
        </Tooltip>
      )}
    </span>
  );
}

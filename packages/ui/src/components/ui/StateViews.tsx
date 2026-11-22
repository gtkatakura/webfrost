import { RefreshCcw, TriangleAlert } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { errorMessage } from "../../lib/errors";
import { Mascot } from "../Logo";
import { Button } from "./Button";

/** A failed query: say so, say why, offer Retry. Never confuse it with an empty result. */
export function ErrorState({
  title = "Something went wrong",
  error,
  onRetry,
  compact = false,
}: {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center text-center gap-3 ${compact ? "py-8" : "py-16"} px-4`}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger">
        <TriangleAlert size={22} aria-hidden="true" />
      </span>
      <div>
        <p className="text-ui-base font-semibold text-high m-0">{title}</p>
        {error !== undefined && (
          <p className="text-ui-sm text-mid mt-1 mb-0 max-w-md break-words">
            {errorMessage(error)}
          </p>
        )}
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCcw size={12} aria-hidden="true" />
          Retry
        </Button>
      )}
    </div>
  );
}

/** Inline banner for a failure that sits next to other content. */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="m-0 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-ui-base text-danger"
    >
      {message}
    </p>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  mascot = false,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  /** Show the fox instead of an icon: for the "nothing archived yet" moments. */
  mascot?: boolean;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-4 py-16 px-4">
      {mascot ? (
        <Mascot width={260} />
      ) : (
        icon && (
          <span className="flex size-14 items-center justify-center rounded-full bg-overlay text-low">
            {icon}
          </span>
        )
      )}
      <div>
        <p className="text-ui-base font-semibold text-high m-0">{title}</p>
        {children && <div className="text-ui-sm text-mid mt-1 max-w-sm">{children}</div>}
      </div>
    </div>
  );
}

export function Skeleton({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded bg-overlay ${className}`}
      style={style}
    />
  );
}

/** Spinner-free loading placeholder: a few pulsing rows. */
export function LoadingRows({ rows = 3, rowClass = "h-14" }: { rows?: number; rowClass?: string }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
        <Skeleton key={i} className={`${rowClass} w-full rounded-lg`} />
      ))}
    </div>
  );
}

/** The one page title: h1, an optional line of description, and actions aligned to the right. */
export function PageHeader({
  title,
  description,
  badge,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** A small count or state next to the title. */
  badge?: ReactNode;
  /** Actions (buttons, links) on the right; they wrap under the title on narrow screens. */
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="m-0 text-ui-2xl font-semibold text-high">{title}</h1>
          {badge}
        </div>
        {description && <p className="mb-0 mt-1 text-ui-base text-mid">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

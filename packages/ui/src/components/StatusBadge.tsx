const TONE: Record<string, string> = {
  done: "bg-success/10 text-success border-success/25",
  failed: "bg-danger/10 text-danger border-danger/25",
};
const PENDING_TONE = "bg-warning/10 text-warning border-warning/25";

/** A snapshot's status. Renders nothing when the server reports none (search results can). */
export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-ui-xs font-semibold ${TONE[status] ?? PENDING_TONE}`}
    >
      {status}
    </span>
  );
}

/**
 * Three-letter chip for one extractor: tinted when it produced output, quiet and dashed when it
 * did not. Not captured is not a failure (a page without video has no media), so it is never red.
 */
export function ExtractorChip({ name, active }: { name: string; active: boolean }) {
  return (
    <span
      title={`${name}: ${active ? "captured" : "not captured"}`}
      className={`inline-flex items-center rounded border px-1.5 font-mono text-ui-xs font-medium ${
        active
          ? "border-success/25 bg-success/10 text-success"
          : "border-dashed border-border-strong bg-transparent text-low"
      }`}
    >
      {name.slice(0, 3).toUpperCase()}
    </span>
  );
}

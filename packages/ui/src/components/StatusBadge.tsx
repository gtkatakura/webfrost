const TONE: Record<string, string> = {
  done: "bg-success/10 text-success border-success/25",
  failed: "bg-danger/10 text-danger border-danger/25",
};
const PENDING_TONE = "bg-warning/10 text-warning border-warning/25";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-ui-xs font-semibold ${TONE[status] ?? PENDING_TONE}`}
    >
      {status}
    </span>
  );
}

/** Three-letter chip for one extractor: green when it produced output, red when it did not. */
export function ExtractorChip({ name, active }: { name: string; active: boolean }) {
  return (
    <span
      title={`${name}: ${active ? "captured" : "missing"}`}
      className={`inline-flex items-center rounded border px-1.5 font-mono text-ui-xs font-medium ${
        active
          ? "bg-success/10 text-success border-success/25"
          : "bg-danger/10 text-danger border-danger/20"
      }`}
    >
      {name.slice(0, 3).toUpperCase()}
    </span>
  );
}

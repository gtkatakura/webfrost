export function StatusBadge({ status }: { status: string }) {
  const isDone = status === "done";
  const isFailed = status === "failed";

  const color = isDone
    ? "var(--status-success)"
    : isFailed
      ? "var(--status-danger)"
      : "var(--status-warning)";

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-ui-xs font-semibold border"
      style={{
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        color,
        borderColor: `color-mix(in srgb, ${color} 25%, transparent)`,
      }}
    >
      {status}
    </span>
  );
}

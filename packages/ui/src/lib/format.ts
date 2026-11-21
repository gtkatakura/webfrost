export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

/** "5m ago" / "in 3h" style label; past dates older than a week fall back to a short date. */
export function relativeTime(value: string | null): string {
  if (!value) return "—";
  const diff = Date.now() - new Date(value).getTime();
  const abs = Math.abs(diff);
  const future = diff < 0;
  if (!future && abs >= 7 * 86_400_000) {
    return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  if (abs < 60_000) return future ? "soon" : "just now";
  const prefix = future ? "in " : "";
  const suffix = future ? "" : " ago";
  if (abs < 3_600_000) return `${prefix}${Math.round(abs / 60_000)}m${suffix}`;
  if (abs < 86_400_000) return `${prefix}${Math.round(abs / 3_600_000)}h${suffix}`;
  return `${prefix}${Math.round(abs / 86_400_000)}d${suffix}`;
}

export function shortDateTime(value: string, withYear = false): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: withYear ? "numeric" : undefined,
    hour: "2-digit",
    minute: "2-digit",
  });
}

import type { Tag } from "@webfrost/sdk";

/** Pick black or white text for a hex background by its luminance. */
function readableOn(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return "#111111";
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? "#111111" : "#ffffff";
}

export function TagChip({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
  // User-chosen tag colors are data, not theme: they stay as inline hex. Untinted tags use tokens.
  const custom = tag.color ? { background: tag.color, color: readableOn(tag.color) } : undefined;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[0.7rem] font-semibold ${
        custom ? "" : "bg-overlay text-high border border-border"
      }`}
      style={custom}
    >
      {tag.name}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="border-0 bg-transparent p-0 text-[0.75rem] leading-none text-inherit"
          aria-label={`Remove tag ${tag.name}`}
        >
          ×
        </button>
      )}
    </span>
  );
}

import type { Tag } from "@webfrost/sdk";
import { X } from "lucide-react";

const NEAR_BLACK = "#111111";

/** WCAG relative luminance of a #rrggbb color, or null for anything else. */
function luminance(hex: string): number | null {
  const h = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map((i) => {
    const c = Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Near-black or white text for a hex background: whichever has the higher contrast ratio. */
export function readableOn(hex: string): string {
  const bg = luminance(hex);
  if (bg === null) return NEAR_BLACK;
  const dark = luminance(NEAR_BLACK) ?? 0;
  const withWhite = 1.05 / (bg + 0.05);
  const withDark = (bg + 0.05) / (dark + 0.05);
  return withDark >= withWhite ? NEAR_BLACK : "#ffffff";
}

export function TagChip({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
  // User-chosen tag colors are data, not theme: they stay as inline hex. Untinted tags use tokens.
  const custom = tag.color ? { background: tag.color, color: readableOn(tag.color) } : undefined;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-ui-xs font-semibold ${
        custom ? "" : "border border-border bg-overlay text-high"
      }`}
      style={custom}
    >
      {tag.name}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="-mr-1 inline-flex size-4 items-center justify-center rounded-full border-0 bg-transparent p-0 text-inherit opacity-80 hover:opacity-100"
          aria-label={`Remove tag ${tag.name}`}
        >
          <X size={10} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

import type { Tag } from "@webfrost/sdk";

export function TagChip({
  tag,
  onRemove,
}: {
  tag: Tag;
  onRemove?: () => void;
}) {
  const bg = tag.color ?? "#e5e7eb";
  const hex = bg.replace("#", "");
  let textColor = "#111";
  if (hex.length === 6) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    textColor = lum > 0.55 ? "#111" : "#fff";
  }
  return (
    <span
      className="inline-flex items-center gap-0.5 py-0.5 px-[0.45rem] rounded-full text-[0.7rem] font-semibold mr-0.5"
      style={{ background: bg, color: textColor }}
    >
      {tag.name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          className="bg-transparent border-0 cursor-pointer p-0 leading-none text-[0.75rem]"
          style={{ color: textColor }}
          aria-label={`Remove tag ${tag.name}`}
        >
          ×
        </button>
      )}
    </span>
  );
}

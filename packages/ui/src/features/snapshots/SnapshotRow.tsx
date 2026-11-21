import type { Snapshot } from "@webfrost/sdk";
import { Camera, Clock } from "lucide-react";
import { Link } from "react-router-dom";
import { ExtractorChip, StatusBadge } from "../../components/StatusBadge";
import { shortDateTime } from "../../lib/format";

export type Density = "comfortable" | "compact";

/** Extractors worth a chip in the list (screenshot and html are implied by the thumbnail/title). */
const LIST_EXTRACTORS = ["warc", "pdf", "readability", "dom-snapshot", "singlefile", "media"];

interface SnapshotRowProps {
  snapshot: Snapshot;
  selected: boolean;
  /** Omitted for read-only guests: no checkbox is rendered. */
  onToggle?: ((id: number) => void) | undefined;
  density: Density;
  /** Where the row opens the detail panel. */
  to: string;
}

export function SnapshotRow({ snapshot, selected, onToggle, density, to }: SnapshotRowProps) {
  const extractors = new Set(snapshot.extractors);
  const comfortable = density === "comfortable";
  const captured = shortDateTime(snapshot.createdAt);
  const capturedShort = new Date(snapshot.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return (
    <li
      className={`flex list-none items-center border-b border-border transition-colors ${
        selected ? "bg-accent/10" : "hover:bg-subtle"
      } ${comfortable ? "min-h-14 py-1.5" : "min-h-9 py-1"}`}
    >
      {onToggle ? (
        <label className="flex w-10 shrink-0 items-center justify-center self-stretch">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(snapshot.id)}
            className="accent-accent"
            aria-label={`Select ${snapshot.url}`}
          />
        </label>
      ) : (
        <div className="w-5 shrink-0" />
      )}

      {comfortable && (
        <div className="mr-3 hidden h-10 w-14 shrink-0 overflow-hidden rounded border border-border bg-overlay sm:block">
          {snapshot.screenshotUrl ? (
            <img
              src={snapshot.screenshotUrl}
              alt=""
              loading="lazy"
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-low">
              <Camera size={14} aria-hidden="true" />
            </div>
          )}
        </div>
      )}

      {/* Main content: a real link so it works with middle-click, keyboard and screen readers. */}
      <Link
        to={to}
        className="flex min-w-0 flex-1 flex-col justify-center self-stretch pr-3 text-left text-inherit no-underline hover:no-underline"
      >
        {comfortable && snapshot.title ? (
          <>
            <span className="truncate text-ui-sm font-medium text-high">{snapshot.title}</span>
            <span className="truncate font-mono text-ui-xs text-mid">{snapshot.url}</span>
          </>
        ) : (
          <span className="truncate font-mono text-ui-sm text-high">{snapshot.url}</span>
        )}
      </Link>

      <div className="mr-3 hidden w-60 shrink-0 items-center gap-1 md:flex">
        {LIST_EXTRACTORS.map((ext) => (
          <ExtractorChip key={ext} name={ext} active={extractors.has(ext)} />
        ))}
      </div>

      {comfortable && snapshot.tags.length > 0 && (
        <div className="mr-3 hidden max-w-32 shrink-0 items-center gap-1 overflow-hidden lg:flex">
          {snapshot.tags.slice(0, 2).map((tag) => (
            <span
              key={tag.id}
              className="truncate rounded border border-border bg-overlay px-1.5 py-0.5 text-ui-xs text-mid"
              style={
                tag.color ? { borderColor: `${tag.color}66`, color: "var(--text-high)" } : undefined
              }
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}

      <div className="mr-3 flex w-20 shrink-0 flex-col items-end gap-0.5 md:w-[4.5rem] md:items-start">
        <StatusBadge status={snapshot.status} />
        <span className="whitespace-nowrap text-ui-xs text-low md:hidden">{capturedShort}</span>
      </div>

      <div className="mr-3 hidden w-28 shrink-0 items-center justify-end gap-1 text-ui-xs text-low md:flex">
        <Clock size={10} aria-hidden="true" />
        <span className="truncate">{captured}</span>
      </div>
    </li>
  );
}

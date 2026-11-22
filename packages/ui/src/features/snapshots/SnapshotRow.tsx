import type { Snapshot } from "@webfrost/sdk";
import { Camera, Clock } from "lucide-react";
import { Link } from "react-router-dom";
import { ExtractorChip, StatusBadge } from "../../components/StatusBadge";
import { Skeleton } from "../../components/ui/StateViews";
import { shortDateTime } from "../../lib/format";

export type Density = "comfortable" | "compact" | "grid";

/** Extractors worth a chip in the list (screenshot and html are implied by the thumbnail/title). */
const LIST_EXTRACTORS = ["warc", "pdf", "readability", "dom-snapshot", "singlefile", "media"];

interface SnapshotRowProps {
  snapshot: Snapshot;
  selected: boolean;
  /** Omitted for read-only guests: no checkbox is rendered. */
  onToggle?: ((id: number) => void) | undefined;
  density: Exclude<Density, "grid">;
  /** Where the row opens the snapshot viewer. */
  to: string;
  /** Router state for the viewer (where its Back returns). */
  state?: unknown;
}

export function SnapshotRow({
  snapshot,
  selected,
  onToggle,
  density,
  to,
  state,
}: SnapshotRowProps) {
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
        <Link
          to={to}
          state={state}
          tabIndex={-1}
          aria-hidden="true"
          className="mr-3 hidden h-10 w-14 shrink-0 overflow-hidden rounded border border-border bg-overlay transition-colors hover:border-accent sm:block"
        >
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
        </Link>
      )}

      {/* Main content: a real link so it works with middle-click, keyboard and screen readers. */}
      <Link
        to={to}
        state={state}
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

/** One snapshot as a card: a large screenshot first, for browsing an archive by sight. */
export function SnapshotCard({
  snapshot,
  selected,
  onToggle,
  to,
  state,
}: Omit<SnapshotRowProps, "density">) {
  const label = snapshot.title || snapshot.url;
  return (
    <li
      className={`group relative flex list-none flex-col overflow-hidden rounded-xl border bg-surface transition-colors ${
        selected ? "border-accent ring-1 ring-accent" : "border-border hover:border-border-strong"
      }`}
    >
      <Link
        to={to}
        state={state}
        className="flex flex-1 flex-col text-inherit no-underline hover:no-underline"
      >
        <div className="aspect-[16/10] overflow-hidden border-b border-border bg-overlay">
          {snapshot.screenshotUrl ? (
            <img
              src={snapshot.screenshotUrl}
              alt=""
              loading="lazy"
              className="size-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-low">
              <Camera size={28} aria-hidden="true" />
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
          {/* Fixed height (two title lines, one address line) so every card, and its skeleton, is the
              same size: nothing moves when the page loads. */}
          <span className="line-clamp-2 min-h-[2lh] text-ui-sm font-medium leading-snug text-high">
            {label}
          </span>
          <span className="truncate font-mono text-ui-xs text-mid">
            {snapshot.title ? snapshot.url : "\u00a0"}
          </span>
          <div className="mt-auto flex items-center justify-between gap-2 pt-2">
            <StatusBadge status={snapshot.status} />
            <span className="flex items-center gap-1 text-ui-xs text-low">
              <Clock size={10} aria-hidden="true" />
              {shortDateTime(snapshot.createdAt)}
            </span>
          </div>
        </div>
      </Link>
      {onToggle && (
        <label
          className={`absolute left-2 top-2 flex size-7 items-center justify-center rounded-md bg-surface/90 shadow transition-opacity ${
            selected ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100"
          }`}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(snapshot.id)}
            className="accent-accent"
            aria-label={`Select ${snapshot.url}`}
          />
        </label>
      )}
    </li>
  );
}

/** A card while the list loads: the same box as {@link SnapshotCard}, so nothing shifts when data arrives. */
export function SnapshotCardSkeleton() {
  return (
    <li className="flex list-none flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <Skeleton className="aspect-[16/10] rounded-none border-b border-border" />
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex min-h-[2lh] flex-col justify-center gap-1.5 text-ui-sm leading-snug">
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-2/3" />
        </div>
        <div className="flex h-[1lh] items-center text-ui-xs">
          <Skeleton className="h-2.5 w-1/2" />
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <Skeleton className="h-5 w-12 rounded-full" />
          <Skeleton className="h-2.5 w-24" />
        </div>
      </div>
    </li>
  );
}

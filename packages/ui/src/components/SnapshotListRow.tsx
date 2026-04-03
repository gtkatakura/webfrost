import type { Snapshot } from "@webfrost/sdk";
import { Link } from "react-router-dom";
import { ExtractorBadge } from "./ExtractorBadge";
import { StatusBadge } from "./StatusBadge";
import { TagChip } from "./TagChip";

export function SnapshotListRow({
  snapshot,
  selected,
  onToggle,
}: {
  snapshot: Snapshot;
  selected?: boolean;
  onToggle?: (id: number) => void;
}) {
  const ts = new Date(snapshot.createdAt).toLocaleString();
  return (
    <li className="border border-gray-200 rounded-md overflow-hidden flex items-stretch">
      {onToggle && (
        <label className="flex items-center px-3 bg-white border-r border-gray-200 cursor-pointer">
          <input
            type="checkbox"
            checked={selected ?? false}
            onChange={() => onToggle(snapshot.id)}
            className="cursor-pointer"
            aria-label={`Select snapshot ${snapshot.url}`}
          />
        </label>
      )}
      <Link
        to={`/snapshots/${snapshot.id}`}
        className="flex flex-1 justify-between items-start py-3 px-4 bg-white gap-4 text-inherit no-underline hover:no-underline"
      >
        <div className="shrink min-w-0">
          <span className="text-primary break-all text-sm block">{snapshot.url}</span>
          {snapshot.tags.length > 0 && (
            <div className="mt-1">
              {snapshot.tags.map((tag) => (
                <TagChip key={tag.id} tag={tag} />
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusBadge status={snapshot.status} />
          <span className="text-[0.7rem] text-gray-400">{ts}</span>
          {snapshot.extractors.length > 0 && (
            <div>
              {snapshot.extractors.map((ext) => (
                <ExtractorBadge key={ext} extractor={ext} hasContent={true} />
              ))}
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}

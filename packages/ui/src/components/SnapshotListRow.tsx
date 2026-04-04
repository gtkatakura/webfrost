import type { Snapshot } from "@webfrost/sdk";
import { Clock } from "lucide-react";
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
    <li className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden flex items-stretch bg-white dark:bg-gray-800 shadow-sm hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600 transition-all">
      {onToggle && (
        <label className="flex items-center px-3 border-r border-gray-200 dark:border-gray-700 cursor-pointer bg-gray-50 dark:bg-gray-800/50">
          <input
            type="checkbox"
            checked={selected ?? false}
            onChange={() => onToggle(snapshot.id)}
            className="cursor-pointer rounded"
            aria-label={`Select snapshot ${snapshot.url}`}
          />
        </label>
      )}
      <Link
        to={`/snapshots/${snapshot.id}`}
        className="flex flex-1 flex-col py-3.5 px-4 gap-2 text-inherit no-underline hover:no-underline"
      >
        <div className="flex items-start justify-between gap-4">
          <span className="text-primary break-all text-sm font-medium leading-snug">
            {snapshot.url}
          </span>
          <StatusBadge status={snapshot.status} />
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {snapshot.tags.length > 0 &&
              snapshot.tags.map((tag) => <TagChip key={tag.id} tag={tag} />)}
            {snapshot.extractors.length > 0 && (
              <div className="flex gap-1">
                {snapshot.extractors.map((ext) => (
                  <ExtractorBadge key={ext} extractor={ext} hasContent={true} />
                ))}
              </div>
            )}
          </div>
          <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 shrink-0">
            <Clock size={11} />
            {ts}
          </span>
        </div>
      </Link>
    </li>
  );
}

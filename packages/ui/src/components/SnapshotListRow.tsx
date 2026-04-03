import type { Snapshot } from "@webfrost/sdk";
import { Link } from "react-router-dom";
import { ExtractorBadge } from "./ExtractorBadge";
import { StatusBadge } from "./StatusBadge";
import { TagChip } from "./TagChip";

export function SnapshotListRow({ snapshot }: { snapshot: Snapshot }) {
  const ts = new Date(snapshot.createdAt).toLocaleString();
  return (
    <li className="border border-gray-200 rounded-md overflow-hidden">
      <Link
        to={`/snapshots/${snapshot.id}`}
        className="flex justify-between items-start py-3 px-4 bg-white gap-4 text-inherit no-underline hover:no-underline"
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

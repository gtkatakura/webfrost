import type { SnapshotDetail } from "@webfrost/sdk";
import { Clock, Copy, Tag as TagIcon, Trash2 } from "lucide-react";
import { useRef } from "react";
import { StatusBadge } from "../../../components/StatusBadge";
import { useCopy } from "../../../lib/clipboard";
import { shortDateTime } from "../../../lib/format";
import { InlineTags } from "./InlineTags";

const labelCls = "mb-1 mt-0 text-ui-xs font-medium text-low";

export function MetadataSidebar({
  detail,
  onDelete,
}: {
  detail: SnapshotDetail;
  /** Omitted for read-only guests: no Delete control is rendered. */
  onDelete?: () => void;
}) {
  const { state: copyState, copy } = useCopy();
  const urlRef = useRef<HTMLAnchorElement>(null);

  async function copyUrl() {
    const ok = await copy(detail.url);
    // No clipboard on this origin: select the address so Ctrl/Cmd+C finishes the job.
    if (!ok && urlRef.current) window.getSelection()?.selectAllChildren(urlRef.current);
  }

  return (
    <div className="flex shrink-0 flex-col gap-4 border-t border-border bg-surface p-3 md:w-48 md:overflow-y-auto md:border-t-0 md:border-l">
      <div>
        <p className={labelCls}>URL</p>
        <div className="flex items-start gap-1">
          <a
            ref={urlRef}
            href={detail.url}
            target="_blank"
            rel="noreferrer"
            className="line-clamp-3 break-all font-mono text-ui-xs"
          >
            {detail.url}
          </a>
          <button
            type="button"
            onClick={copyUrl}
            className="shrink-0 rounded border-0 bg-transparent p-1 text-low hover:bg-subtle hover:text-high"
            aria-label="Copy URL"
            title="Copy URL"
          >
            <Copy size={12} aria-hidden="true" />
          </button>
        </div>
        <span role="status" className="text-ui-xs">
          {copyState === "copied" && <span className="text-success">Copied!</span>}
          {copyState === "failed" && (
            <span className="text-warning">Copy blocked here: press Ctrl+C</span>
          )}
        </span>
      </div>

      <div>
        <p className={labelCls}>Status</p>
        <StatusBadge status={detail.status} />
      </div>

      <div>
        <p className={labelCls}>Captured</p>
        <span className="flex items-center gap-1 text-ui-xs text-mid">
          <Clock size={10} aria-hidden="true" />
          {shortDateTime(detail.createdAt, true)}
        </span>
      </div>

      <div>
        <p className={`${labelCls} flex items-center gap-1`}>
          <TagIcon size={10} aria-hidden="true" />
          Tags
        </p>
        <InlineTags snapshotId={detail.id} />
      </div>

      <div>
        <p className={labelCls}>Extractors</p>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {detail.archiveResults.length === 0 ? (
            <li className="text-ui-xs text-low">None yet</li>
          ) : (
            detail.archiveResults.map((r) => (
              <li key={r.id} className="flex items-center gap-1.5">
                <span
                  className={`size-1.5 shrink-0 rounded-full ${r.content !== null ? "bg-success" : "bg-danger"}`}
                  role="img"
                  aria-label={r.content !== null ? "Captured" : "Failed"}
                />
                <span className="truncate font-mono text-ui-xs text-mid">{r.extractor}</span>
              </li>
            ))
          )}
        </ul>
      </div>

      {onDelete && (
        <div className="mt-auto border-t border-border pt-3">
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 rounded border-0 bg-transparent p-0 text-ui-xs text-danger hover:underline"
          >
            <Trash2 size={11} aria-hidden="true" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

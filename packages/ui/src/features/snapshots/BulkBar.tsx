import type { Tag } from "@webfrost/sdk";
import { Trash2, X } from "lucide-react";
import { Button } from "../../components/ui/Button";

/** Floating action bar for the rows selected on the current page. */
export function BulkBar({
  count,
  status,
  allTags,
  onDelete,
  onTag,
  onClear,
}: {
  count: number;
  status: string | null;
  allTags: Tag[];
  onDelete: () => void;
  onTag: (tagId: number) => void;
  onClear: () => void;
}) {
  const busy = status !== null;
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="fixed bottom-5 left-1/2 z-30 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-xl border border-border-strong bg-overlay px-4 py-2.5 text-ui-sm text-high shadow-2xl"
    >
      <span role="status" className="font-medium text-mid">
        {status ?? `${count} selected`}
      </span>
      <Button variant="danger" size="sm" onClick={onDelete} disabled={busy}>
        <Trash2 size={12} aria-hidden="true" />
        Delete
      </Button>
      {allTags.length > 0 && (
        <select
          disabled={busy}
          aria-label="Add a tag to the selected snapshots"
          className="field !w-auto !py-1 text-ui-sm"
          value=""
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id) onTag(id);
          }}
        >
          <option value="">Tag…</option>
          {allTags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={onClear}
        className="inline-flex size-8 items-center justify-center rounded-md border-0 bg-transparent text-mid transition-colors hover:bg-subtle hover:text-high"
        aria-label="Clear selection"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

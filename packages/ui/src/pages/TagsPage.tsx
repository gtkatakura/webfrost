import { Plus, Tag, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { TagChip } from "../components/TagChip";
import { Button } from "../components/ui/Button";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "../components/ui/StateViews";
import { useAuth } from "../context/auth";
import { useTags } from "../hooks/useTags";

export function TagsPage() {
  const { canWrite } = useAuth();
  const { tags, loading, isError, error, refetch, createTag, deleteTag } = useTags();
  const colorId = useId();

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3d8bff");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!canWrite || !name) return;
    createTag.mutate({ name, color: newColor }, { onSuccess: () => setNewName("") });
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Tags"
        badge={
          !loading &&
          tags.length > 0 && (
            <span className="rounded-full bg-overlay px-2 py-0.5 text-ui-xs font-semibold tabular-nums text-mid">
              {tags.length}
            </span>
          )
        }
      />

      {canWrite && (
        <form
          onSubmit={handleCreate}
          className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3"
        >
          <input
            type="text"
            aria-label="New tag name"
            placeholder="New tag name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
            className="field min-w-40 flex-1"
          />
          <label
            htmlFor={colorId}
            className="flex h-8 items-center gap-2 rounded-md border border-border bg-surface pl-2.5 pr-1 text-ui-sm text-mid hover:border-border-strong"
          >
            Color
            <input
              id={colorId}
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="h-6 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
            />
          </label>
          <Button type="submit" disabled={createTag.isPending}>
            <Plus size={14} aria-hidden="true" />
            {createTag.isPending ? "Creating…" : "Create"}
          </Button>
        </form>
      )}

      {loading ? (
        <LoadingRows rows={3} rowClass="h-12" />
      ) : isError ? (
        <ErrorState title="Could not load tags" error={error} onRetry={() => refetch()} />
      ) : tags.length === 0 ? (
        <EmptyState icon={<Tag size={26} />} title="No tags yet">
          {canWrite
            ? "Create a tag above to organize your snapshots."
            : "No tags have been created."}
        </EmptyState>
      ) : (
        <ul className="m-0 list-none overflow-hidden rounded-xl border border-border bg-surface p-0">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 py-2 last:border-b-0"
            >
              <TagChip tag={tag} />
              {canWrite && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="hover:!bg-danger/10 hover:!text-danger"
                  disabled={deleteTag.isPending}
                  onClick={() => deleteTag.mutate({ id: tag.id, name: tag.name })}
                  aria-label={`Delete tag ${tag.name}`}
                >
                  <Trash2 size={13} aria-hidden="true" />
                  Delete
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

import { ArrowLeft, Tag } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { TagChip } from "../components/TagChip";
import { Button } from "../components/ui/Button";
import { EmptyState, ErrorState, LoadingRows } from "../components/ui/StateViews";
import { useAuth } from "../context/auth";
import { useTags } from "../hooks/useTags";

export function TagsPage() {
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  const { tags, loading, isError, error, refetch, createTag, deleteTag } = useTags();

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3d8bff");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!canWrite || !name) return;
    createTag.mutate({ name, color: newColor }, { onSuccess: () => setNewName("") });
  }

  return (
    <main className="mx-auto max-w-[760px] px-4 py-8">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-6 inline-flex items-center gap-1.5 border-0 bg-transparent p-0 text-ui-base text-accent hover:underline"
      >
        <ArrowLeft size={14} aria-hidden="true" /> Back
      </button>

      <h1 className="mb-6 mt-0 text-2xl font-bold text-high">Tags</h1>

      {canWrite && (
        <form onSubmit={handleCreate} className="mb-6 flex flex-wrap items-center gap-2">
          <input
            type="text"
            aria-label="New tag name"
            placeholder="New tag name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
            className="field min-w-40 flex-1"
          />
          <label className="flex items-center gap-1.5 text-ui-base text-mid">
            Color
            <input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="h-8 w-9 rounded border border-border bg-transparent p-0.5"
            />
          </label>
          <Button type="submit" disabled={createTag.isPending}>
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
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-2.5"
            >
              <TagChip tag={tag} />
              {canWrite && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="!border-danger/40 !text-danger hover:!bg-danger/10"
                  disabled={deleteTag.isPending}
                  onClick={() => deleteTag.mutate({ id: tag.id, name: tag.name })}
                  aria-label={`Delete tag ${tag.name}`}
                >
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

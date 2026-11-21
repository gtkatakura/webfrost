import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Tag } from "@webfrost/sdk";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useClient } from "../../../context";
import { useAuth } from "../../../context/auth";
import { tagKeys } from "../../../hooks/useTags";
import { errorMessage } from "../../../lib/errors";

const snapshotTagKey = (snapshotId: number) => ["snapshot-tags", snapshotId] as const;

/** The tags of one snapshot, with add/remove for people who can write. */
export function InlineTags({ snapshotId }: { snapshotId: number }) {
  const client = useClient();
  const { canWrite } = useAuth();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);

  const { data: tags = [] } = useQuery<Tag[]>({
    queryKey: snapshotTagKey(snapshotId),
    queryFn: () => client.listSnapshotTags(snapshotId),
  });

  const { data: allTags = [] } = useQuery<Tag[]>({
    queryKey: tagKeys.list(),
    queryFn: () => client.listTags(),
    // Only needed for the add-tag picker.
    enabled: canWrite,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: snapshotTagKey(snapshotId) });
    queryClient.invalidateQueries({ queryKey: ["snapshots", "list"] });
  };

  const removeTag = useMutation({
    mutationFn: (tagId: number) => client.removeTagFromSnapshot(snapshotId, tagId),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });

  const addTag = useMutation({
    mutationFn: (tagId: number) => client.addTagToSnapshot(snapshotId, tagId),
    onSuccess: () => {
      refresh();
      setShowAdd(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const available = allTags.filter((t) => !tags.some((st) => st.id === t.id));

  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-1 rounded border border-border bg-overlay px-1.5 py-0.5 text-ui-xs text-high"
          style={tag.color ? { borderColor: `${tag.color}88` } : undefined}
        >
          {tag.color && (
            <span
              className="size-1.5 rounded-full"
              style={{ background: tag.color }}
              aria-hidden="true"
            />
          )}
          {tag.name}
          {canWrite && (
            <button
              type="button"
              onClick={() => removeTag.mutate(tag.id)}
              className="border-0 bg-transparent p-0 leading-none text-low hover:text-danger"
              aria-label={`Remove tag ${tag.name}`}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {canWrite &&
        available.length > 0 &&
        (showAdd ? (
          <select
            className="field !w-auto !px-1.5 !py-0.5 text-ui-xs"
            aria-label="Pick a tag to add"
            value=""
            // biome-ignore lint/a11y/noAutofocus: opened on demand by the Add tag button
            autoFocus
            onChange={(e) => {
              const id = Number(e.target.value);
              if (id) addTag.mutate(id);
            }}
            onBlur={() => setShowAdd(false)}
          >
            <option value="">Pick tag…</option>
            {available.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="inline-flex rounded border-0 bg-transparent p-0.5 text-low hover:bg-subtle hover:text-high"
            aria-label="Add tag"
          >
            <Plus size={12} aria-hidden="true" />
          </button>
        ))}
      {tags.length === 0 && !showAdd && <span className="text-ui-xs text-low">No tags</span>}
    </div>
  );
}

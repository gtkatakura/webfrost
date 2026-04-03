import { WebFrostError } from "@webfrost/sdk";
import type { Tag } from "@webfrost/sdk";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useClient } from "../context";
import { TagChip } from "./TagChip";

export function SnapshotTagSection({ snapshotId }: { snapshotId: number }) {
  const client = useClient();
  const [snapshotTags, setSnapshotTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);

  useEffect(() => {
    Promise.all([client.listSnapshotTags(snapshotId), client.listTags()])
      .then(([st, all]) => {
        setSnapshotTags(st);
        setAllTags(all);
      })
      .catch((e: unknown) => {
        toast.error(e instanceof WebFrostError ? e.message : String(e));
      });
  }, [snapshotId, client]);

  async function handleRemove(tagId: number) {
    // Optimistic update
    setSnapshotTags((prev) => prev.filter((t) => t.id !== tagId));
    try {
      await client.removeTagFromSnapshot(snapshotId, tagId);
    } catch (e: unknown) {
      toast.error(e instanceof WebFrostError ? e.message : String(e));
      // Revert on error
      const st = await client.listSnapshotTags(snapshotId);
      setSnapshotTags(st);
    }
  }

  async function handleAdd(tagId: number) {
    const tag = allTags.find((t) => t.id === tagId);
    if (!tag) return;
    // Optimistic update
    setSnapshotTags((prev) => [...prev, tag]);
    try {
      await client.addTagToSnapshot(snapshotId, tagId);
    } catch (e: unknown) {
      toast.error(e instanceof WebFrostError ? e.message : String(e));
      // Revert on error
      const st = await client.listSnapshotTags(snapshotId);
      setSnapshotTags(st);
    }
  }

  const availableTags = allTags.filter((t) => !snapshotTags.some((st) => st.id === t.id));

  return (
    <div className="mb-7">
      <h2 className="text-[0.95rem] font-semibold mb-3 text-gray-900 dark:text-gray-100">Tags</h2>
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {snapshotTags.length === 0 && (
          <span className="text-gray-400 dark:text-gray-500 text-sm">No tags assigned.</span>
        )}
        {snapshotTags.map((tag) => (
          <TagChip key={tag.id} tag={tag} onRemove={() => handleRemove(tag.id)} />
        ))}
      </div>
      {availableTags.length > 0 && (
        <select
          className="border border-gray-300 dark:border-gray-600 rounded-md text-sm py-1 px-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 cursor-pointer"
          value=""
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id) handleAdd(id);
          }}
        >
          <option value="">+ Add tag…</option>
          {availableTags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

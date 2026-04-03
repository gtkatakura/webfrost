import { WebFrostError } from "@webfrost/sdk";
import { useState } from "react";
import { useClient } from "../context";

export function useBulkSnapshots(visibleIds: number[], refetch: () => Promise<void>) {
  const client = useClient();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === visibleIds.length && visibleIds.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleIds));
    }
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function bulkDelete() {
    const ids = [...selectedIds];
    if (!window.confirm(`Delete ${ids.length} snapshot(s)? This cannot be undone.`)) return;
    setError(null);
    let done = 0;
    try {
      for (const id of ids) {
        setStatus(`Deleting ${done + 1}/${ids.length}…`);
        await client.deleteSnapshot(id);
        done++;
      }
      clearSelection();
      await refetch();
    } catch (e) {
      setError(e instanceof WebFrostError ? e.message : String(e));
    } finally {
      setStatus(null);
    }
  }

  async function bulkTag(tagId: number) {
    const ids = [...selectedIds];
    setError(null);
    let done = 0;
    try {
      for (const id of ids) {
        setStatus(`Tagging ${done + 1}/${ids.length}…`);
        await client.addTagToSnapshot(id, tagId);
        done++;
      }
      clearSelection();
      await refetch();
    } catch (e) {
      setError(e instanceof WebFrostError ? e.message : String(e));
    } finally {
      setStatus(null);
    }
  }

  return {
    selectedIds,
    status,
    error,
    setError,
    toggle,
    toggleAll,
    clearSelection,
    bulkDelete,
    bulkTag,
    allSelected: visibleIds.length > 0 && selectedIds.size === visibleIds.length,
    someSelected: selectedIds.size > 0,
  };
}

import { useQueryClient } from "@tanstack/react-query";
import { WebFrostError } from "@webfrost/sdk";
import { useState } from "react";
import { toast } from "sonner";
import { useClient } from "../context";
import { snapshotKeys } from "./useSnapshots";

export function useBulkSnapshots(visibleIds: number[]) {
  const client = useClient();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<string | null>(null);

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
    let done = 0;
    const toastId = toast.loading(`Deleting 1/${ids.length}…`);
    try {
      for (const id of ids) {
        setStatus(`Deleting ${done + 1}/${ids.length}…`);
        await client.deleteSnapshot(id);
        done++;
        if (done < ids.length) {
          toast.loading(`Deleting ${done + 1}/${ids.length}…`, { id: toastId });
        }
      }
      clearSelection();
      await queryClient.invalidateQueries({ queryKey: snapshotKeys.all });
      toast.success(`Deleted ${ids.length} snapshot(s)`, { id: toastId });
    } catch (e) {
      toast.error(e instanceof WebFrostError ? e.message : String(e), {
        id: toastId,
      });
    } finally {
      setStatus(null);
    }
  }

  async function bulkTag(tagId: number) {
    const ids = [...selectedIds];
    let done = 0;
    const toastId = toast.loading(`Tagging 1/${ids.length}…`);
    try {
      for (const id of ids) {
        setStatus(`Tagging ${done + 1}/${ids.length}…`);
        await client.addTagToSnapshot(id, tagId);
        done++;
        if (done < ids.length) {
          toast.loading(`Tagging ${done + 1}/${ids.length}…`, { id: toastId });
        }
      }
      clearSelection();
      await queryClient.invalidateQueries({ queryKey: snapshotKeys.all });
      toast.success(`Tagged ${ids.length} snapshot(s)`, { id: toastId });
    } catch (e) {
      toast.error(e instanceof WebFrostError ? e.message : String(e), {
        id: toastId,
      });
    } finally {
      setStatus(null);
    }
  }

  return {
    selectedIds,
    status,
    toggle,
    toggleAll,
    clearSelection,
    bulkDelete,
    bulkTag,
    allSelected: visibleIds.length > 0 && selectedIds.size === visibleIds.length,
    someSelected: selectedIds.size > 0,
  };
}

import { useQueryClient } from "@tanstack/react-query";
import { WebFrostError } from "@webfrost/sdk";
import { useState } from "react";
import { toast } from "sonner";
import { useClient } from "../context";
import { snapshotKeys } from "./useSnapshots";

export interface BulkOutcome {
  succeeded: number[];
  /** Ids the server reported as missing (op returned `false`). */
  notFound: number[];
  /** Ids whose operation threw. */
  failed: number[];
  firstError: string | null;
}

/**
 * Run `op` for each id independently: a failure never aborts the remaining ids.
 * An op resolving to `false` is treated as "not found" and not counted as success.
 */
export async function runBulk(
  ids: number[],
  op: (id: number) => Promise<boolean | undefined>,
  onProgress?: (index: number) => void,
): Promise<BulkOutcome> {
  const outcome: BulkOutcome = { succeeded: [], notFound: [], failed: [], firstError: null };
  for (const [i, id] of ids.entries()) {
    onProgress?.(i);
    try {
      const ok = await op(id);
      if (ok === false) outcome.notFound.push(id);
      else outcome.succeeded.push(id);
    } catch (e) {
      outcome.failed.push(id);
      outcome.firstError ??= e instanceof WebFrostError ? e.message : String(e);
    }
  }
  return outcome;
}

export function formatBulkSummary(doneVerb: string, o: BulkOutcome): string {
  const parts = [`${doneVerb} ${o.succeeded.length}`];
  if (o.failed.length > 0) parts.push(`${o.failed.length} failed`);
  if (o.notFound.length > 0) parts.push(`${o.notFound.length} not found`);
  return parts.join(", ");
}

/**
 * `canWrite` is the page's auth state: when false (read-only guest) selection and every
 * bulk operation are no-ops, so nothing can reach the server even if a handler is invoked.
 */
export function useBulkSnapshots(visibleIds: number[], canWrite = true) {
  const client = useClient();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<string | null>(null);

  function toggle(id: number) {
    if (!canWrite) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (!canWrite) return;
    if (selectedIds.size === visibleIds.length && visibleIds.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleIds));
    }
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function runAndReport(
    verb: { progress: string; done: string },
    op: (id: number) => Promise<boolean | undefined>,
    ids: number[],
  ) {
    const toastId = toast.loading(`${verb.progress} 1/${ids.length}…`);
    let outcome: BulkOutcome = { succeeded: [], notFound: [], failed: [], firstError: null };
    try {
      outcome = await runBulk(ids, op, (i) => {
        setStatus(`${verb.progress} ${i + 1}/${ids.length}…`);
        toast.loading(`${verb.progress} ${i + 1}/${ids.length}…`, { id: toastId });
      });
    } finally {
      setStatus(null);
      // Keep only the ids that failed selected so the user can retry them.
      setSelectedIds(new Set(outcome.failed));
      await queryClient.invalidateQueries({ queryKey: snapshotKeys.all });
    }
    const summary = formatBulkSummary(verb.done, outcome);
    if (outcome.failed.length > 0 || outcome.notFound.length > 0) {
      const reason = outcome.firstError ? ` (${outcome.firstError})` : "";
      if (outcome.succeeded.length > 0) toast.warning(`${summary}${reason}`, { id: toastId });
      else toast.error(`${summary}${reason}`, { id: toastId });
    } else {
      toast.success(summary, { id: toastId });
    }
  }

  async function bulkDelete() {
    if (!canWrite) return;
    const ids = [...selectedIds];
    if (!window.confirm(`Delete ${ids.length} snapshot(s)? This cannot be undone.`)) return;
    await runAndReport(
      { progress: "Deleting", done: "Deleted" },
      (id) => client.deleteSnapshot(id),
      ids,
    );
  }

  async function bulkTag(tagId: number) {
    if (!canWrite) return;
    const ids = [...selectedIds];
    await runAndReport(
      { progress: "Tagging", done: "Tagged" },
      async (id) => {
        await client.addTagToSnapshot(id, tagId);
        return true;
      },
      ids,
    );
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

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SnapshotPage } from "@webfrost/sdk";
import { toast } from "sonner";
import { useClient } from "../context";
import { useThemeContext } from "../context/theme";
import { errorMessage } from "../lib/errors";

export const snapshotKeys = {
  all: ["snapshots"] as const,
  list: (page: number, limit: number) => ["snapshots", "list", page, limit] as const,
  detail: (id: number) => ["snapshots", "detail", id] as const,
};

/** Poll interval while any snapshot in view is still pending. */
export const PENDING_POLL_MS = 5000;

export function useSnapshots(page = 1, limit = 20) {
  const client = useClient();
  const query = useQuery<SnapshotPage>({
    queryKey: snapshotKeys.list(page, limit),
    queryFn: () => client.listSnapshots({ page, limit }),
    refetchInterval: (q) =>
      q.state.data?.items.some((s) => s.status === "pending") ? PENDING_POLL_MS : false,
  });

  return {
    snapshots: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    loading: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/** Queue a snapshot for archiving; shared by the dashboard and the list's New Snapshot menu. */
export function useCreateSnapshot(onCreated?: () => void) {
  const client = useClient();
  const queryClient = useQueryClient();
  // The page is archived the way the person archiving it sees the web: in their theme.
  const { theme } = useThemeContext();
  return useMutation({
    mutationFn: (url: string) => client.createSnapshot(url, { colorScheme: theme }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: snapshotKeys.all });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      toast.success("Snapshot queued");
      onCreated?.();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

/**
 * The one delete mutation. `silent` is for bulk runs that report one summary toast themselves
 * and refresh the lists once at the end.
 */
export function useDeleteSnapshot(
  opts: { silent?: boolean; onDeleted?: (id: number) => void | Promise<void> } = {},
) {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => client.deleteSnapshot(id),
    onSuccess: async (_ok, id) => {
      if (!opts.silent) {
        queryClient.invalidateQueries({ queryKey: snapshotKeys.all });
        queryClient.invalidateQueries({ queryKey: ["stats"] });
        toast.success("Snapshot deleted");
      }
      await opts.onDeleted?.(id);
    },
    onError: (e) => {
      if (!opts.silent) toast.error(errorMessage(e));
    },
  });
}

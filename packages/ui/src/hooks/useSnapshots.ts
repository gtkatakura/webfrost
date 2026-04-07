import { useQuery } from "@tanstack/react-query";
import type { SnapshotPage } from "@webfrost/sdk";
import { useClient } from "../context";

export const snapshotKeys = {
  all: ["snapshots"] as const,
  list: (page: number, limit: number) => ["snapshots", "list", page, limit] as const,
  detail: (id: number) => ["snapshots", "detail", id] as const,
};

export function useSnapshots(page = 1, limit = 20) {
  const client = useClient();
  const query = useQuery<SnapshotPage>({
    queryKey: snapshotKeys.list(page, limit),
    queryFn: () => client.listSnapshots({ page, limit }),
  });

  return {
    snapshots: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    loading: query.isPending,
    error: query.error ? String(query.error) : null,
    refetch: query.refetch,
  };
}

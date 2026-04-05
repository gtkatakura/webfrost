import { WebFrostError } from "@webfrost/sdk";
import type { Snapshot } from "@webfrost/sdk";
import { useCallback, useEffect, useState } from "react";
import { useClient } from "../context";

export function useSnapshots(page = 1, limit = 20) {
  const client = useClient();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const result = await client.listSnapshots({ page, limit });
      setSnapshots(result.items);
      setTotal(result.total);
    } catch (e) {
      setError(e instanceof WebFrostError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [client, page, limit]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { snapshots, total, loading, error, setError, refetch };
}

import { WebFrostError } from "@webfrost/sdk";
import type { Snapshot } from "@webfrost/sdk";
import { useCallback, useEffect, useState } from "react";
import { useClient } from "../context";

export function useSnapshots() {
  const client = useClient();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const result = await client.listSnapshots();
      setSnapshots(result.items);
    } catch (e) {
      setError(e instanceof WebFrostError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { snapshots, loading, error, setError, refetch };
}

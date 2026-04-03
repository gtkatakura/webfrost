import { WebFrostError } from "@webfrost/sdk";
import type { Tag } from "@webfrost/sdk";
import { useCallback, useEffect, useState } from "react";
import { useClient } from "../context";

export function useTags() {
  const client = useClient();
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const data = await client.listTags();
      setTags(data);
    } catch (e) {
      setError(e instanceof WebFrostError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { tags, setTags, loading, error, setError, refetch };
}

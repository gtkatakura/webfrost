import type { SearchResult } from "@webfrost/sdk";
import { useEffect, useState } from "react";
import { useClient } from "../context";

export function useSearch(query: string) {
  const client = useClient();
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      client
        .searchSnapshots(query)
        .then((res) => setResults(res))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [query, client]);

  return { results, loading };
}

import { useQuery } from "@tanstack/react-query";
import type { SearchResult } from "@webfrost/sdk";
import { useClient } from "../context";

export const searchKeys = {
  results: (query: string) => ["search", query] as const,
};

export function useSearch(query: string) {
  const client = useClient();
  const trimmed = query.trim();
  const result = useQuery<SearchResult[]>({
    queryKey: searchKeys.results(trimmed),
    queryFn: () => client.searchSnapshots(trimmed),
    enabled: trimmed.length > 0,
    staleTime: 60_000,
  });

  return {
    results: result.data ?? [],
    loading: result.isFetching,
  };
}

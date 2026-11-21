import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { SearchPage, SearchResult } from "@webfrost/sdk";
import { useClient } from "../context";

export const searchKeys = {
  results: (query: string) => ["search", query] as const,
  page: (query: string, page: number, limit: number) =>
    ["search", "page", query, page, limit] as const,
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
    error: result.error,
  };
}

export function useSearchPage(query: string, page: number, limit: number) {
  const client = useClient();
  const trimmed = query.trim();
  const result = useQuery<SearchPage>({
    queryKey: searchKeys.page(trimmed, page, limit),
    queryFn: () => client.searchSnapshotsPage(trimmed, { page, limit }),
    enabled: trimmed.length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  return {
    results: result.data?.items ?? [],
    total: result.data?.total ?? 0,
    loading: result.isFetching,
    error: result.error,
    refetch: result.refetch,
  };
}

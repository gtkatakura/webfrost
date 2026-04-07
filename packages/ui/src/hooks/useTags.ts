import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Tag } from "@webfrost/sdk";
import { useClient } from "../context";

export const tagKeys = {
  all: ["tags"] as const,
  list: () => ["tags", "list"] as const,
};

export function useTags() {
  const client = useClient();
  const queryClient = useQueryClient();
  const query = useQuery<Tag[]>({
    queryKey: tagKeys.list(),
    queryFn: () => client.listTags(),
  });

  const createTag = useMutation({
    mutationFn: ({ name, color }: { name: string; color?: string }) =>
      client.createTag(name, color),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tagKeys.all }),
  });

  const deleteTag = useMutation({
    mutationFn: (id: number) => client.deleteTag(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tagKeys.all }),
  });

  return {
    tags: query.data ?? [],
    loading: query.isPending,
    error: query.error ? String(query.error) : null,
    refetch: query.refetch,
    createTag: createTag.mutateAsync,
    deleteTag: deleteTag.mutateAsync,
  };
}

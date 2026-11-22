import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Tag } from "@webfrost/sdk";
import { toast } from "sonner";
import { useClient } from "../context";
import { collect } from "../lib/collect";
import { errorMessage } from "../lib/errors";

export const tagKeys = {
  all: ["tags"] as const,
  list: () => ["tags", "list"] as const,
};

export function useTags() {
  const client = useClient();
  const queryClient = useQueryClient();
  const query = useQuery<Tag[]>({
    queryKey: tagKeys.list(),
    queryFn: () => collect(client.iterateTags()),
  });

  const createTag = useMutation({
    mutationFn: ({ name, color }: { name: string; color?: string }) =>
      client.createTag(name, color),
    onSuccess: (_tag, { name }) => {
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
      toast.success(`Tag "${name}" created`);
    },
    onError: (e) => toast.error(`Could not create the tag: ${errorMessage(e)}`),
  });

  const deleteTag = useMutation({
    mutationFn: ({ id }: { id: number; name: string }) => client.deleteTag(id),
    onSuccess: (_r, { name }) => {
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
      queryClient.invalidateQueries({ queryKey: ["snapshots"] });
      toast.success(`Tag "${name}" deleted`);
    },
    onError: (e) => toast.error(`Could not delete the tag: ${errorMessage(e)}`),
  });

  return {
    tags: query.data ?? [],
    loading: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    createTag,
    deleteTag,
  };
}

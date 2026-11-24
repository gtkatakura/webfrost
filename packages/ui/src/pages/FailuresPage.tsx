import { useQuery } from "@tanstack/react-query";
import type { FailureGroupSummary } from "@webfrost/sdk";
import { ChevronRight, CircleCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "../components/ui/StateViews";
import { useClient } from "../context";
import { FAILURE_KEYS, GROUP_INFO, plural } from "../features/failures/shared";

export { FAILURE_KEYS };

export function FailuresPage() {
  const client = useClient();
  const { data, isPending, isError, error, refetch } = useQuery<FailureGroupSummary[]>({
    queryKey: FAILURE_KEYS.groups(),
    queryFn: () => client.listFailureGroups(),
  });
  const groups = (data ?? []).filter((g) => g.count > 0);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Review failures"
        description="Snapshots that could not be archived, grouped by why. Decide about many at once."
      />
      {isPending ? (
        <LoadingRows rows={4} />
      ) : isError ? (
        <ErrorState title="Could not load the failures" error={error} onRetry={() => refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState icon={<CircleCheck size={24} />} title="Nothing failed">
          Every snapshot was archived, or you already dealt with the ones that were not.
        </EmptyState>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
          {groups.map((g) => (
            <li key={g.id}>
              <Link
                to={`/failures/${g.id}`}
                className="flex h-full flex-col gap-1.5 rounded-xl border border-border bg-surface p-4 no-underline transition-colors hover:border-border-strong hover:bg-subtle hover:no-underline"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-ui-base font-semibold text-high">{g.label}</span>
                  <ChevronRight size={16} aria-hidden className="shrink-0 text-low" />
                </span>
                <span className="text-ui-sm tabular-nums text-high">
                  {plural(g.count, "snapshot")} · {plural(g.domains, "domain")}
                </span>
                <span className="text-ui-sm text-mid">{GROUP_INFO[g.id].summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

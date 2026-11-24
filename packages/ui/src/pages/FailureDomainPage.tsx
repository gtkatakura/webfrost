import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { FailureGroupId, FailureGroupSummary, FailureSelection } from "@webfrost/sdk";
import { CircleCheck, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { ConfirmDeleteModal } from "../components/ui/ConfirmDeleteModal";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "../components/ui/StateViews";
import { useClient } from "../context";
import {
  Breadcrumb,
  FAILURE_KEYS,
  FailedOnlyNote,
  LoadMore,
  OpenCell,
  OriginalLink,
  PAGE_SIZE,
  SelectAllBanner,
  SelectCell,
  SelectRow,
  SelectionToolbar,
  flatten,
  formatDate,
  nextPageParam,
  plural,
  useListSelection,
  useRowSelect,
} from "../features/failures/shared";
import { useFailureActions } from "../features/failures/useFailureActions";

export function FailureDomainPage() {
  const params = useParams<{ group: string; host: string }>();
  const id = params.group as FailureGroupId;
  const host = params.host ?? "";
  const client = useClient();
  // null: closed; "ids": the selection; "domain": every failed snapshot of the domain.
  const [confirming, setConfirming] = useState<null | "ids" | "domain">(null);

  const { data: groups } = useQuery<FailureGroupSummary[]>({
    queryKey: FAILURE_KEYS.groups(),
    queryFn: () => client.listFailureGroups(),
  });
  const label = groups?.find((g) => g.id === id)?.label ?? id;

  const list = useInfiniteQuery({
    queryKey: FAILURE_KEYS.snapshots(id, host),
    queryFn: ({ pageParam }) =>
      client.listFailedSnapshots(id, host, { page: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
  });
  const items = flatten(list.data);
  const total = list.data?.pages[0]?.total ?? 0;

  const actions = useFailureActions(id, () => {
    sel.clear();
    setConfirming(null);
  });

  const sel = useListSelection<number>();
  const count = sel.all ? total - sel.size : sel.size;
  const allLoadedSelected = items.length > 0 && items.every((s) => sel.isSelected(s.id));
  const selection: FailureSelection = sel.all
    ? { all: true, host, excludeIds: sel.keys }
    : { ids: sel.keys };

  const select = useRowSelect(
    items.map((s) => s.id),
    sel.isSelected,
    sel.apply,
  );

  const retryLabel = id === "domain-gone" ? "Check again" : "Retry";
  const whole = { hosts: [host] };

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <Breadcrumb
        items={[
          { label: "Review failures", to: "/failures" },
          { label, to: `/failures/${id}` },
          { label: host },
        ]}
      />
      <PageHeader
        title={host}
        description={list.data ? `${plural(total, "failed snapshot")} in “${label}”` : undefined}
      >
        <Button
          variant="secondary"
          size="sm"
          disabled={actions.busy}
          onClick={() => actions.retry.mutate(whole)}
        >
          <RefreshCw size={13} aria-hidden /> {retryLabel} (whole domain)
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={actions.busy}
          onClick={() => actions.trash.mutate(whole)}
        >
          <Trash2 size={13} aria-hidden /> Move all to trash
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={actions.busy}
          onClick={() => setConfirming("domain")}
        >
          Delete all permanently
        </Button>
      </PageHeader>
      <FailedOnlyNote />

      <SelectAllBanner
        noun="snapshots"
        loaded={items.length}
        total={total}
        selectedCount={count}
        allMode={sel.all}
        allLoadedSelected={allLoadedSelected}
        onSelectAll={sel.enterAll}
        onClear={sel.clear}
      />

      {count > 0 && (
        <SelectionToolbar summary={`${plural(count, "snapshot")} selected`}>
          <Button
            variant="secondary"
            size="sm"
            disabled={actions.busy}
            onClick={() => actions.retry.mutate(selection)}
          >
            <RefreshCw size={13} aria-hidden /> {retryLabel}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={actions.busy}
            onClick={() => actions.trash.mutate(selection)}
          >
            <Trash2 size={13} aria-hidden /> Move to trash
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={actions.busy}
            onClick={() => setConfirming("ids")}
          >
            Delete permanently
          </Button>
        </SelectionToolbar>
      )}

      {list.isPending ? (
        <LoadingRows rows={4} />
      ) : list.isError ? (
        <ErrorState
          title="Could not load the snapshots"
          error={list.error}
          onRetry={() => list.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState icon={<CircleCheck size={24} />} title="Nothing here">
          No failed snapshots of this domain in this group.
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border bg-overlay">
                  <th className="w-12 py-2 pl-4 text-left">
                    <input
                      type="checkbox"
                      aria-label="Select all loaded"
                      checked={allLoadedSelected}
                      onChange={() =>
                        allLoadedSelected && sel.all
                          ? sel.clear()
                          : sel.apply(
                              items.map((s) => s.id),
                              !allLoadedSelected,
                            )
                      }
                    />
                  </th>
                  <th className="label-caps whitespace-nowrap py-2 pr-3 text-left">Snapshot</th>
                  <th className="label-caps whitespace-nowrap hidden py-2 pr-4 text-left sm:table-cell">
                    Created
                  </th>
                  <th className="w-10" aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <SelectRow
                    key={s.id}
                    selected={sel.isSelected(s.id)}
                    onSelect={(shift) => select(s.id, shift)}
                  >
                    <SelectCell selected={sel.isSelected(s.id)} label={`Select snapshot ${s.id}`} />
                    <td className="w-full max-w-0 py-2.5 pr-3 align-top">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-high" title={s.url}>
                          {s.url}
                        </span>
                        <OriginalLink url={s.url} />
                      </div>
                      {s.failure && (
                        <div className="truncate text-ui-xs text-mid">
                          {s.failure.label}
                          {s.failure.detail && (
                            <span className="ml-1.5 text-low" title={s.failure.detail}>
                              {s.failure.detail}
                            </span>
                          )}
                        </div>
                      )}
                      {s.workingSnapshotId !== null && (
                        <Link
                          to={`/snapshots/${s.workingSnapshotId}`}
                          className="text-ui-xs text-accent-text"
                        >
                          Earlier archive
                        </Link>
                      )}
                      <div className="text-ui-xs text-low sm:hidden">{formatDate(s.createdAt)}</div>
                    </td>
                    <td className="hidden py-2.5 pr-4 align-top whitespace-nowrap text-ui-sm text-mid sm:table-cell">
                      {formatDate(s.createdAt)}
                    </td>
                    <OpenCell to={`/snapshots/${s.id}`} label="Open snapshot" />
                  </SelectRow>
                ))}
              </tbody>
            </table>
          </div>
          <LoadMore
            hasNext={!!list.hasNextPage}
            loading={list.isFetchingNextPage}
            onLoad={() => list.fetchNextPage()}
          />
        </div>
      )}

      {confirming && (
        <ConfirmDeleteModal
          title="Delete failed snapshots permanently"
          phrase={host}
          pending={actions.remove.isPending}
          onClose={() => setConfirming(null)}
          onConfirm={() => actions.remove.mutate(confirming === "ids" ? selection : whole)}
        >
          {confirming === "ids"
            ? plural(count, "failed snapshot")
            : `All ${plural(total, "failed snapshot")}`}{" "}
          of {host} and their files will be deleted for good. Earlier snapshots that worked are
          kept.
        </ConfirmDeleteModal>
      )}
    </main>
  );
}

/** The route element: a new page instance per group and domain (see FailureGroupRoute). */
export function FailureDomainRoute() {
  const { group, host } = useParams<{ group: string; host: string }>();
  return <FailureDomainPage key={`${group}/${host}`} />;
}

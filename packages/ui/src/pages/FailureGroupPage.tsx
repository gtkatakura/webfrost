import { useInfiniteQuery } from "@tanstack/react-query";
import type { FailureDomainPage, FailureGroupId, FailureSelection } from "@webfrost/sdk";
import { CircleCheck, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { ConfirmDeleteModal } from "../components/ui/ConfirmDeleteModal";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "../components/ui/StateViews";
import { useClient } from "../context";
import {
  Breadcrumb,
  FAILURE_KEYS,
  FailedOnlyNote,
  GROUP_INFO,
  LoadMore,
  OpenCell,
  PAGE_SIZE,
  SelectAllBanner,
  SelectCell,
  SelectRow,
  SelectionToolbar,
  flatten,
  formatDate,
  nextPageParam,
  plural,
  useDebounced,
  useGroupLabel,
  useListSelection,
  useRowSelect,
} from "../features/failures/shared";
import { useFailureActions } from "../features/failures/useFailureActions";

export function FailureGroupPage() {
  const { group } = useParams<{ group: string }>();
  const id = group as FailureGroupId;
  const client = useClient();
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim());
  const [confirming, setConfirming] = useState(false);

  const label = useGroupLabel(id);
  const info = GROUP_INFO[id];

  const list = useInfiniteQuery({
    queryKey: FAILURE_KEYS.domains(id, q),
    queryFn: ({ pageParam }): Promise<FailureDomainPage> =>
      client.listFailureDomains(id, { q, page: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
  });
  const domains = flatten(list.data);
  const total = list.data?.pages[0]?.total ?? 0;

  const actions = useFailureActions(id, () => {
    sel.clear();
    setConfirming(false);
  });

  const sel = useListSelection<string>((host) => domains.find((d) => d.host === host)?.count ?? 0);
  // A new search is a different list: all mode does not carry over.
  const { exitAll } = sel;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the applied filter changes
  useEffect(() => exitAll(), [q, exitAll]);
  const totalSnapshots = list.data?.pages[0]?.snapshots ?? 0;
  const domainCount = sel.all ? total - sel.size : sel.size;
  const snapshotCount = sel.all ? totalSnapshots - sel.weight : sel.weight;
  const allLoadedSelected = domains.length > 0 && domains.every((d) => sel.isSelected(d.host));
  const selection: FailureSelection = sel.all
    ? { all: true, q, excludeHosts: sel.keys }
    : { hosts: sel.keys };

  const select = useRowSelect(
    domains.map((d) => d.host),
    sel.isSelected,
    sel.apply,
  );

  function toggleAll() {
    const keys = domains.map((d) => d.host);
    if (allLoadedSelected && sel.all) sel.clear();
    else sel.apply(keys, !allLoadedSelected);
  }

  if (!info) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <Breadcrumb items={[{ label: "Review failures", to: "/failures" }, { label: "Unknown" }]} />
        <EmptyState title="Unknown group">
          <Link to="/failures">Back to Review failures</Link>
        </EmptyState>
      </main>
    );
  }

  const onlyHost =
    domainCount === 1
      ? sel.all
        ? domains.find((d) => sel.isSelected(d.host))?.host
        : sel.keys[0]
      : undefined;
  const deletePhrase = onlyHost ?? `delete ${snapshotCount} snapshots`;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <Breadcrumb items={[{ label: "Review failures", to: "/failures" }, { label }]} />
      <PageHeader title={label} />

      <section
        aria-label="About this group"
        className="mb-3 rounded-xl border border-border bg-surface px-4 py-3 text-ui-sm text-mid"
      >
        {info.details ?? info.summary}
      </section>
      <FailedOnlyNote />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-ui-sm text-mid" aria-live="polite">
          {list.data
            ? `${plural(list.data.pages[0]?.snapshots ?? 0, "snapshot")} across ${plural(total, "domain")}`
            : ""}
        </p>
        <label className="relative block w-full sm:w-72">
          <span className="sr-only">Filter domains</span>
          <Search
            size={14}
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-low"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter domains, e.g. mirrorsite"
            className="field w-full pl-8"
          />
        </label>
      </div>

      <SelectAllBanner
        noun="domains"
        loaded={domains.length}
        total={total}
        selectedCount={domainCount}
        allMode={sel.all}
        allLoadedSelected={allLoadedSelected}
        onSelectAll={sel.enterAll}
        onClear={sel.clear}
      />

      {domainCount > 0 && (
        <SelectionToolbar
          summary={`${plural(domainCount, "domain")} · ${plural(snapshotCount, "snapshot")} selected`}
        >
          <Button
            variant="secondary"
            size="sm"
            disabled={actions.busy}
            onClick={() => actions.retry.mutate(selection)}
          >
            <RefreshCw size={13} aria-hidden /> {id === "domain-gone" ? "Check again" : "Retry"}
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
            onClick={() => setConfirming(true)}
          >
            Delete permanently
          </Button>
        </SelectionToolbar>
      )}

      {list.isPending ? (
        <LoadingRows rows={4} />
      ) : list.isError ? (
        <ErrorState
          title="Could not load the domains"
          error={list.error}
          onRetry={() => list.refetch()}
        />
      ) : domains.length === 0 ? (
        <EmptyState
          icon={<CircleCheck size={24} />}
          title={q ? "No domain matches" : "Nothing here"}
        >
          {q ? `No domain in this group contains “${q}”.` : "No failed snapshots in this group."}
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
                      onChange={toggleAll}
                    />
                  </th>
                  <th className="label-caps whitespace-nowrap py-2 pr-3 text-left">Domain</th>
                  <th className="label-caps whitespace-nowrap py-2 pr-3 text-right">Snapshots</th>
                  <th className="label-caps whitespace-nowrap hidden py-2 pr-3 text-left md:table-cell">
                    Worked before
                  </th>
                  <th className="label-caps whitespace-nowrap hidden py-2 pr-4 text-left sm:table-cell">
                    Last failed
                  </th>
                  <th className="w-10" aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {domains.map((d) => (
                  <SelectRow
                    key={d.host}
                    selected={sel.isSelected(d.host)}
                    onSelect={(shift) => select(d.host, shift)}
                  >
                    <SelectCell selected={sel.isSelected(d.host)} label={`Select ${d.host}`} />
                    {/* w-full + max-w-0: the column takes what is left and its text truncates,
                        so a long URL never pushes the table wider than a phone. */}
                    <td className="w-full max-w-0 py-2.5 pr-3 align-top">
                      <div className="truncate font-medium text-high" title={d.host}>
                        {d.host}
                      </div>
                      <div className="truncate text-ui-xs text-low" title={d.example.url}>
                        {d.example.url}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-right align-top tabular-nums text-high">
                      {d.count.toLocaleString()}
                    </td>
                    <td className="hidden py-2.5 pr-3 align-top whitespace-nowrap text-ui-sm text-mid md:table-cell">
                      {d.withWorkingSnapshot > 0
                        ? `${plural(d.withWorkingSnapshot, "page")} ${d.withWorkingSnapshot === 1 ? "has" : "have"} an earlier archive`
                        : "—"}
                    </td>
                    <td className="hidden py-2.5 pr-4 align-top whitespace-nowrap text-ui-sm text-mid sm:table-cell">
                      {formatDate(d.lastFailedAt)}
                    </td>
                    <OpenCell
                      to={`/failures/${id}/${encodeURIComponent(d.host)}`}
                      label={`Open ${d.host}`}
                    />
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
          phrase={deletePhrase}
          pending={actions.remove.isPending}
          onClose={() => setConfirming(false)}
          onConfirm={() => actions.remove.mutate(selection)}
        >
          {plural(snapshotCount, "failed snapshot")} of {plural(domainCount, "domain")} ({label})
          and their files will be deleted for good. Earlier snapshots that worked are kept.
        </ConfirmDeleteModal>
      )}
    </main>
  );
}

/**
 * The route element: a new page instance per group. React Router keeps the same component when only a
 * URL parameter changes (back/forward, an edited address), which would carry a selection made in one
 * group, even "all N", into another, where a bulk action would hit snapshots nobody chose.
 */
export function FailureGroupRoute() {
  const { group } = useParams<{ group: string }>();
  return <FailureGroupPage key={group} />;
}
